// Narrow, read-only ZIP / ZIP64 reader for official X archives.
// Only metadata and selected follower/following entries are read from the Blob.
// No extraction to disk, external dependencies, network, or execution of JS.
import {MAX_ARCHIVE_BYTES} from "./archive.js";

const MAX_INDEX_BYTES=32*1024*1024;
const MAX_ENTRIES=200000;
const MAX_PARTS=16;
const MAX_COMPRESSED=MAX_ARCHIVE_BYTES+1024*1024;
const TARGET=/^(follower|following)(?:[._-][a-z0-9._-]+)?\.js$/i;
const decoder=new TextDecoder("utf-8");
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const u16=(b,o)=>view(b).getUint16(o,true);
const u32=(b,o)=>view(b).getUint32(o,true);
function u64(b,o){
  const n=view(b).getBigUint64(o,true);
  if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("ZIP64 文件位置超出支持范围。");
  return Number(n);
}
const invalid=()=>new Error("ZIP 目录或文件结构无效，请重新下载或解压后导入。");
function range(start,size,limit){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||start>limit||size>limit-start)throw invalid();
}
function checkCanceled(signal){
  if(signal?.aborted)throw new Error("已取消 ZIP 扫描。");
}
async function read(blob,start,size,signal){
  checkCanceled(signal);range(start,size,blob.size);
  const b=new Uint8Array(await blob.slice(start,start+size).arrayBuffer());
  checkCanceled(signal);
  if(b.length!==size)throw invalid();
  return b;
}

async function centralDirectory(blob,signal){
  const tailSize=Math.min(blob.size,65557);
  const tailStart=blob.size-tailSize;
  const tail=await read(blob,tailStart,tailSize,signal);
  let e=-1;
  for(let i=tail.length-22;i>=0;i--){
    if(u32(tail,i)===0x06054b50&&i+22+u16(tail,i+20)===tail.length){e=i;break;}
  }
  if(e<0)throw invalid();
  if(u16(tail,e+4)!==0||u16(tail,e+6)!==0)throw new Error("暂不支持分卷 ZIP，请解压后导入。");
  let entries=u16(tail,e+10),size=u32(tail,e+12),offset=u32(tail,e+16);
  const eocd=tailStart+e;
  let directoryEnd=eocd;
  if(entries===0xffff||u16(tail,e+8)===0xffff||size===0xffffffff||offset===0xffffffff){
    const locator=await read(blob,eocd-20,20,signal);
    if(u32(locator,0)!==0x07064b50||u32(locator,4)!==0||u32(locator,16)!==1)throw invalid();
    const zpos=u64(locator,8);
    range(zpos,56,eocd-20);
    const z=await read(blob,zpos,56,signal);
    if(u32(z,0)!==0x06064b50||u64(z,4)<44||u64(z,4)!==eocd-20-zpos-12||
       u32(z,16)!==0||u32(z,20)!==0||u64(z,24)!==u64(z,32))throw invalid();
    entries=u64(z,32);size=u64(z,40);offset=u64(z,48);directoryEnd=zpos;
  }else if(u16(tail,e+8)!==entries)throw invalid();
  if(entries>MAX_ENTRIES||size>MAX_INDEX_BYTES)throw new Error("ZIP 文件目录过大，请解压后只选择关注关系文件。");
  range(offset,size,directoryEnd);
  if(offset+size!==directoryEnd||entries===0||size<entries*46)throw invalid();
  return {entries,offset,bytes:await read(blob,offset,size,signal)};
}
function zip64Values(extra,fields){
  const need=fields.map((x,i)=>x===(i===3?0xffff:0xffffffff));
  if(!need.some(Boolean))return fields;
  let pos=0;
  while(pos+4<=extra.length){
    const tag=u16(extra,pos),len=u16(extra,pos+2);pos+=4;
    if(pos+len>extra.length)throw invalid();
    if(tag===1){
      let at=pos;
      return fields.map((x,i)=>{
        if(!need[i])return x;
        const width=i===3?4:8;
        if(at+width>pos+len)throw invalid();
        const value=width===8?u64(extra,at):u32(extra,at);at+=width;
        return value;
      });
    }
    pos+=len;
  }
  throw invalid();
}
function targetPath(raw){
  const name=decoder.decode(raw);
  const pieces=name.split("/");
  const filename=pieces.at(-1),match=TARGET.exec(filename);
  if(!match||pieces.at(-2)?.toLowerCase()!=="data")return null;
  if(name.includes("\\")||name.includes("\0")||pieces.some(p=>!p||p==="."||p===".."||p.includes(":")||p.includes("\ufffd")))throw invalid();
  return {name,filename,kind:match[1].toLowerCase(),root:pieces.slice(0,-1).join("/")};
}
function matchesBytes(a,b){
  return a.length===b.length&&a.every((x,i)=>x===b[i]);
}
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{
  let c=i;for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crcUpdate(crc,bytes){
  for(const b of bytes)crc=CRC_TABLE[(crc^b)&255]^(crc>>>8);
  return crc>>>0;
}
async function entryText(blob,entry,indexOffset){
  range(entry.offset,30,indexOffset);
  const local=await read(blob,entry.offset,30);
  if(u32(local,0)!==0x04034b50||u16(local,6)!==entry.flags||u16(local,8)!==entry.method)throw invalid();
  const nameLength=u16(local,26),extraLength=u16(local,28);
  range(entry.offset+30,nameLength+extraLength,indexOffset);
  const raw=await read(blob,entry.offset+30,nameLength+extraLength);
  if(!matchesBytes(raw.subarray(0,nameLength),entry.rawName))throw invalid();
  if(!(entry.flags&8)){
    const [size,compressed]=zip64Values(raw.subarray(nameLength),[u32(local,22),u32(local,18)]);
    if(size!==entry.size||compressed!==entry.compressed||u32(local,14)!==entry.crc)throw invalid();
  }
  const start=entry.offset+30+nameLength+extraLength;
  range(start,entry.compressed,indexOffset);
  let stream=blob.slice(start,start+entry.compressed).stream();
  if(entry.method===8){
    try{stream=stream.pipeThrough(new DecompressionStream("deflate-raw"));}
    catch{throw new Error("当前浏览器不支持 ZIP 解压，请更新 Chrome 或解压后导入。");}
  }
  const reader=stream.getReader();
  // The directory's claimed size is bounded before allocation. Stop on overflow.
  const output=new Uint8Array(entry.size);
  let used=0,crc=0xffffffff;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      if(value.byteLength>output.length-used)throw new Error("ZIP 解压大小异常，已停止读取。");
      output.set(value,used);used+=value.byteLength;crc=crcUpdate(crc,value);
    }
  }catch(error){
    try{await reader.cancel();}catch{}
    throw error;
  }finally{reader.releaseLock();}
  if(used!==entry.size||((crc^0xffffffff)>>>0)!==entry.crc)throw new Error("ZIP 文件校验失败，可能已损坏。");
  return new TextDecoder("utf-8",{fatal:true}).decode(output);
}

// The returned file-like objects are lazy: .text() reads only their payload.
// The normal archive parser still validates each file's header, IDs and parts.
export async function indexArchiveZip(blob,{signal,onProgress}={}){
  if(!blob||!Number.isSafeInteger(blob.size)||typeof blob.slice!=="function"||blob.size<22)throw invalid();
  const {entries,offset,bytes}=await centralDirectory(blob,signal);
  const groups={follower:[],following:[]},sizes={follower:0,following:0};
  let at=0,root=null,count=0;
  const names=new Set(),offsets=new Set();
  for(let i=0;i<entries;i++){
    checkCanceled(signal);
    if(at+46>bytes.length||u32(bytes,at)!==0x02014b50)throw invalid();
    const nameLen=u16(bytes,at+28),extraLen=u16(bytes,at+30),commentLen=u16(bytes,at+32);
    const next=at+46+nameLen+extraLen+commentLen;
    if(!nameLen||next>bytes.length)throw invalid();
    const rawName=bytes.subarray(at+46,at+46+nameLen);
    const target=targetPath(rawName);
    if(target){
      const {kind,filename}=target;
      if(root!==null&&target.root!==root)throw new Error("ZIP 包含多份归档，请分别导入。");
      root=target.root;
      const flags=u16(bytes,at+8),method=u16(bytes,at+10);
      if((flags&~0x080e)!==0||![0,8].includes(method))throw new Error("关注文件使用了加密或不支持的压缩格式，请解压后导入。");
      const [size,compressed,localOffset,disk]=zip64Values(bytes.subarray(at+46+nameLen,at+46+nameLen+extraLen),
        [u32(bytes,at+24),u32(bytes,at+20),u32(bytes,at+42),u16(bytes,at+34)]);
      if(disk!==0)throw invalid();
      if(size<=0||size>MAX_ARCHIVE_BYTES||compressed<=0||compressed>MAX_COMPRESSED||
         (method===0&&size!==compressed))throw new Error("ZIP 内关注文件超过大小限制或压缩格式异常。");
      range(localOffset,30,offset);
      if(names.has(filename.toLowerCase())||offsets.has(localOffset))throw new Error("ZIP 中存在重复关注文件。");
      names.add(filename.toLowerCase());offsets.add(localOffset);
      if(++count>MAX_PARTS||(sizes[kind]+=size)>MAX_ARCHIVE_BYTES*4)throw new Error("ZIP 内关注文件分片或总大小超出限制。");
      const entry={size,compressed,offset:localOffset,rawName:rawName.slice(),flags,method,crc:u32(bytes,at+16)};
      groups[kind].push({name:filename,size,async text(){return entryText(blob,entry,offset);}});
    }
    at=next;
    // Bound responsiveness during large index scans; never touch entry payloads.
    if(i%2048===2047){onProgress?.({scanned:i+1,total:entries,found:count});await new Promise(resolve=>setTimeout(resolve,0));}
  }
  checkCanceled(signal);
  if(at!==bytes.length)throw invalid();
  if(!groups.follower.length||!groups.following.length)throw new Error("ZIP 缺少 data/follower.js 或 data/following.js，请选择完整的 X 归档。");
  onProgress?.({scanned:entries,total:entries,found:count});
  return groups;
}
