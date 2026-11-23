import test from "node:test";
import assert from "node:assert/strict";
import {collectArchiveFilesFromDirectory, MAX_DIRECTORY_ENTRIES} from "../follow-manager/directory-import.js";
import {groupArchiveFiles} from "../follow-manager/file-selection.js";

function fakeFile(kind, part=0) {
  const header = `window.YTD.${kind}.part${part} = [];`;
  return {name:kind + (part ? "-part" + part : "") + ".js", size:header.length,
    slice(){return {text:async()=>header}}, text:async()=>header};
}
function modernFile(file) { return {name:file.name,kind:"file",async getFile(){return file}}; }
function modernDirectory(name, entries, metrics={}) {
  return {name,kind:"directory",
    async getDirectoryHandle(target) {
      metrics.lookups = (metrics.lookups || 0) + 1;
      const found=entries.find(e=>e.kind==="directory"&&e.name===target);
      if (!found) throw Object.assign(new Error("Missing"),{name:"NotFoundError"});
      return found;
    },
    async *values(){metrics.enumerated = (metrics.enumerated || 0)+1; yield* entries;}
  };
}
function legacyFile(file) {
  return {name:file.name,isFile:true,file(resolve){resolve(file)}};
}
function legacyDirectory(name, entries) {
  return {name,isDirectory:true,createReader(){
    let index=0;
    return {readEntries(resolve) { const batch=entries.slice(index,index+100);index+=batch.length;resolve(batch); }};
  }};
}

test("modern folder picker jumps directly to data and skips all media and unrelated content", async()=>{
  const follower=fakeFile("follower"), following=fakeFile("following");
  const data=modernDirectory("data",[
    modernFile(follower),modernFile({name:"direct-messages.js",getFile(){throw Error("sensitive")}}),
    modernDirectory("media",[]),modernFile(following)
  ]);
  const stats={};
  const media=modernDirectory("media",[],{});
  const root=modernDirectory("twitter-archive",[media,data],stats);
  const files=await collectArchiveFilesFromDirectory(root);
  assert.deepEqual(files,[follower,following]);
  assert.equal(stats.lookups,1);
  assert.equal(stats.enumerated || 0,0,"archive root must not be enumerated");
  assert.deepEqual((await groupArchiveFiles(files)).follower,[follower]);
});

test("legacy folder drop reads 100-entry batches and descends only into data",async()=>{
  const ignored=Array.from({length:137},(_,i)=>({isFile:true,name:"image-"+i+".jpg",file(){throw Error("unrelated file touched")}}));
  const follower=fakeFile("follower"), following=fakeFile("following",1);
  const data=legacyDirectory("data",[...ignored,legacyFile(follower),legacyFile(following)]);
  const root=legacyDirectory("archive",[...ignored,data]);
  const found=await collectArchiveFilesFromDirectory(root);
  assert.deepEqual(found,[follower,following]);
});

test("selecting data folder itself works and respects partN candidate naming",async()=>{
  const f0=fakeFile("follower"),f1=fakeFile("follower",1),g0=fakeFile("following");
  const data=modernDirectory("data",[modernFile(f0),modernFile(f1),modernFile(g0)]);
  const got=await collectArchiveFilesFromDirectory(data);
  assert.deepEqual(got,[f0,f1,g0]);
  const grouped=await groupArchiveFiles(got);
  assert.equal(grouped.follower.length,2);
});

test("directory scanning can be canceled without partial imported state",async()=>{
  const controller=new AbortController();
  const data=modernDirectory("data",[modernFile(fakeFile("follower")),modernFile(fakeFile("following"))]);
  await assert.rejects(()=>collectArchiveFilesFromDirectory(data,{
    signal:controller.signal,onProgress:()=>controller.abort()
  }),/取消/);
});

test("directory traversal has an entry limit and rejects ZIP/non-folders",async()=>{
  await assert.rejects(()=>collectArchiveFilesFromDirectory({name:"archive.zip",kind:"file"}),/文件夹/);
  const many=modernDirectory("data",Array.from({length:MAX_DIRECTORY_ENTRIES+1},(_,i)=>({
    name:"ignore-"+i+".jpg",kind:"file"
  })));
  await assert.rejects(()=>collectArchiveFilesFromDirectory(many),/项目过多/);
});

test("sensitive non-target files are never opened, even when named JS",async()=>{
  const target=fakeFile("follower");
  const unexpected={
    name:"direct-messages.js",kind:"file",
    async getFile(){throw new Error("must not read private data")}
  };
  const data=modernDirectory("data",[unexpected,modernFile(target)]);
  assert.deepEqual(await collectArchiveFilesFromDirectory(data),[target]);
});
