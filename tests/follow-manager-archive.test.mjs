import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHandle, parseArchiveText, mergeArchiveParts, classifyRelationships,
  profileUrl, MAX_ARCHIVE_USERS, readArchiveGroup, MAX_ARCHIVE_BYTES
} from "../follow-manager/archive.js";

const wrap = (kind, part, ids) => "window.YTD." + kind + ".part" + part + " = " +
  JSON.stringify(ids.map(accountId => ({[kind]:{accountId, userLink:"https://x.com/i/user/" + accountId}}))) + ";\n";
const one = (kind, part, ids) => parseArchiveText(wrap(kind, part, ids), kind);

test("offline archive parser preserves large snowflake IDs as exact strings", () => {
  const id = "18765432109876543210";
  const result = one("follower", 0, [id, "1", id]);
  assert.deepEqual(result, {kind:"follower", partNumber:0, ids:[id,"1"], duplicates:1});
  assert.equal(profileUrl(id), "https://x.com/i/user/" + id);
  assert.throws(() => profileUrl("../../other"));
});

test("parses followers and following separately without executing archive JavaScript", () => {
  assert.deepEqual(one("following", 0, ["10"]).ids, ["10"]);
  assert.throws(() => parseArchiveText(wrap("following", 0, ["10"]), "follower"), /归档格式不匹配/);
  assert.throws(() => parseArchiveText('window.YTD.follower.part0 = [{"follower":{"accountId":"8"}}];globalThis.pwned=true;', "follower"), /格式不匹配/);
  assert.throws(() => parseArchiveText('window.YTD.follower.part0 = [{follower:{accountId:"8"}}]', "follower"), /JSON/);
  assert.throws(() => parseArchiveText('window.YTD.follower.part0 = [{"follower":{"accountId":10000000000000000001}}]', "follower"), /账号 ID 无效/);
  assert.throws(() => parseArchiveText('window.YTD.follower.part0 = [{"follower":{"accountId":"javascript:alert(1)"}}]', "follower"), /账号 ID 无效/);
  assert.throws(() => parseArchiveText("", "follower"));
  assert.throws(() => parseArchiveText("[]", "follower"));
  assert.deepEqual(parseArchiveText("\uFEFF" + wrap("follower", 0, []), "follower").ids, []);
});

test("all selected part files must be complete and contiguous; dedupes across parts", () => {
  const merged = mergeArchiveParts([one("following", 1, ["2","3"]), one("following", 0, ["1","2"])], "following");
  assert.deepEqual(merged, {ids:["1","2","3"], duplicates:1, partCount:2});
  assert.throws(() => mergeArchiveParts([one("following", 1, ["4"])], "following"), /分片缺失/);
  assert.throws(() => mergeArchiveParts([one("following", 0, ["4"]),one("following", 0, ["5"])], "following"), /分片缺失/);
  assert.throws(() => mergeArchiveParts([one("following", 0, ["4"]),one("follower", 1, ["5"])], "following"), /分片缺失/);
  assert.throws(() => mergeArchiveParts([], "following"));
  assert.ok(MAX_ARCHIVE_USERS >= 50_000);
});

test("mutual, no-followback, and not-followed-back partition both sides exactly", () => {
  const followers = ["1","2","3","4"], following = ["3","4","5","6"];
  const result = classifyRelationships(followers, following);
  assert.deepEqual(result, {mutual:["3","4"], notFollowingBack:["5","6"], iHaveNotFollowedBack:["1","2"]});
  assert.equal(result.mutual.length + result.notFollowingBack.length, following.length);
  assert.equal(result.mutual.length + result.iHaveNotFollowedBack.length, followers.length);
  assert.deepEqual(classifyRelationships([],[]), {mutual:[],notFollowingBack:[],iHaveNotFollowedBack:[]});
  assert.deepEqual(classifyRelationships(["7"],[]).iHaveNotFollowedBack, ["7"]);
  assert.deepEqual(classifyRelationships([],["8"]).notFollowingBack, ["8"]);
});

test("snapshots are namespaced by validated handle, not by current X session", () => {
  assert.equal(normalizeHandle(" @Zane_123  "), "zane_123");
  for (const invalid of ["", "@@", "../other", "1234567890123456", "a.b", "你好", "a@b"]) {
    assert.throws(() => normalizeHandle(invalid));
  }
});


test("archive group reads only one target part at a time and keeps exact IDs",async()=>{
  let active=0,maxActive=0;
  const reads=[],progress=[];
  const make=(part,ids)=>({name:"following-"+part+".js",size:1024,
    async text(){
      reads.push(part);active++;maxActive=Math.max(maxActive,active);
      await new Promise(resolve=>setTimeout(resolve,1));
      active--;return wrap("following",part,ids);
    }
  });
  const merged=await readArchiveGroup([make(1,["2","3"]),make(0,["1","2"])],"following",p=>progress.push(p.completed));
  assert.deepEqual(merged,{ids:["1","2","3"],duplicates:1,partCount:2});
  assert.deepEqual(reads,[1,0]);assert.equal(maxActive,1);
  assert.deepEqual(progress,[0,1,2]);
});
test("target-file limits checked before reading any selected content",async()=>{
  let read=false;
  const f={name:"follower.js",size:1024,async text(){read=true;return wrap("follower",0,[]);}};
  await assert.rejects(()=>readArchiveGroup([f,{...f,size:MAX_ARCHIVE_BYTES+1}],"follower"),/32 MB/);
  await assert.rejects(()=>readArchiveGroup(Array.from({length:5},()=>({...f,size:MAX_ARCHIVE_BYTES})),"follower"),/总体积/);
  assert.equal(read,false);
});
