import test from "node:test";
import assert from "node:assert/strict";
import {deflateRawSync} from "node:zlib";
import {indexArchiveZip} from "../follow-manager/zip-import.js";
import {readArchiveGroup,classifyRelationships,MAX_ARCHIVE_BYTES} from "../follow-manager/archive.js";

const enc=new TextEncoder();
const wrap=(kind,part,ids)=>"window.YTD."+kind+".part"+part+" = "+JSON.stringify(ids.map(accountId=>({[kind]:{accountId}})))+";";
const crc32=bytes=>{
  let c=0xffffffff;
  for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}
  return (c^0xffffffff)>>>0;
};
function buildZip(items,{base=0,zip64=false}={}){
  const chunks=[],central=[],positions=[];
  let at=base;
  for(const item of items){
    const name=Buffer.from(item.name),plain=Buffer.from(item.text??"ignored"),method=item.method??8;
    const data=method===8?deflateRawSync(plain):plain;
    const crc=(crc32(plain)+(item.badCRC?1:0))>>>0;
    const size=item.claimedSize??plain.length,flags=item.flags??0;
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);
    if(!(flags&8)){local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(size,22);}
    local.writeUInt16LE(name.length,26);
    const actualName=Buffer.from(item.localName??item.name);
    assert.equal(actualName.length,name.length);
    positions.push({name:item.name,offset:at+30+name.length,size:data.length});
    const localChunk=Buffer.concat([local,actualName,data]);
    chunks.push(localChunk);
    const c=Buffer.alloc(46),extra=zip64?Buffer.alloc(12):Buffer.alloc(0);
    c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(zip64?45:20,6);c.writeUInt16LE(flags,8);
    c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(size,24);
    c.writeUInt16LE(name.length,28);c.writeUInt16LE(extra.length,30);
    c.writeUInt32LE(zip64?0xffffffff:at,42);
    if(zip64){extra.writeUInt16LE(1,0);extra.writeUInt16LE(8,2);extra.writeBigUInt64LE(BigInt(at),4);}
    central.push(Buffer.concat([c,name,extra]));at+=localChunk.length;
  }
  const index=Buffer.concat(central),indexAt=at;
  chunks.push(index);at+=index.length;
  if(zip64){
    const z=Buffer.alloc(56),loc=Buffer.alloc(20);
    z.writeUInt32LE(0x06064b50,0);z.writeBigUInt64LE(44n,4);z.writeUInt16LE(45,12);z.writeUInt16LE(45,14);
    z.writeBigUInt64LE(BigInt(items.length),24);z.writeBigUInt64LE(BigInt(items.length),32);
    z.writeBigUInt64LE(BigInt(index.length),40);z.writeBigUInt64LE(BigInt(indexAt),48);
    loc.writeUInt32LE(0x07064b50,0);loc.writeBigUInt64LE(BigInt(at),8);loc.writeUInt32LE(1,16);
    chunks.push(z,loc);
  }
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(zip64?0xffff:items.length,8);end.writeUInt16LE(zip64?0xffff:items.length,10);
  end.writeUInt32LE(zip64?0xffffffff:index.length,12);end.writeUInt32LE(zip64?0xffffffff:indexAt,16);
  chunks.push(end);
  const real=new Blob(chunks),reads=[];
  // Sparse file emulates huge offsets without allocating GB of RAM or disk.
  const blob={size:base+real.size,slice(start,end){
    assert.ok(start>=0&&end<=this.size&&start<=end);
    reads.push([start,end]);
    assert.ok(end-start<=MAX_ARCHIVE_BYTES+1024*1024,"never read an entire large ZIP");
    if(start>=base)return real.slice(start-base,end-base);
    const n=Math.min(end,base)-start;
    return new Blob([new Uint8Array(n),...(end>base?[real.slice(0,end-base)]:[])]);
  }};
  return {blob,reads,positions,indexAt};
}
const standard=[
  {name:"archive/data/follower.js",text:wrap("follower",0,["1234567890123456789","3"]),method:0},
  {name:"archive/data/following.js",text:wrap("following",0,["3","4"])},
  {name:"archive/data/following-part1.js",text:wrap("following",1,["4","5"])},
  {name:"archive/data/direct-messages.js",text:"private content"},
  {name:"archive/data/tweets_media/video.mp4",text:"not read"}
];
test("ZIP index is lazy and stored/deflate targets use existing exact-ID analysis",async()=>{
  const {blob,reads,indexAt,positions}=buildZip(standard);
  const groups=await indexArchiveZip(blob);
  assert.equal(groups.follower.length,1);assert.equal(groups.following.length,2);
  // A small ZIP tail may include its data; no separate payload reads during indexing.
  assert.equal(reads.length,2);
  const start=reads.length;
  const followers=await readArchiveGroup(groups.follower,"follower");
  const following=await readArchiveGroup(groups.following,"following");
  assert.deepEqual(classifyRelationships(followers.ids,following.ids),
    {mutual:["3"],notFollowingBack:["4","5"],iHaveNotFollowedBack:["1234567890123456789"]});
  assert.equal(following.duplicates,1);
  for(const privateEntry of positions.slice(3))
    assert.ok(reads.slice(start).every(([a,b])=>b<=privateEntry.offset||a>=privateEntry.offset+privateEntry.size));
});
test("1 GiB classic ZIP and >4 GiB ZIP64 use bounded random reads",async()=>{
  for(const [base,zip64] of [[1024**3,false],[5*1024**3,true]]){
    const {blob,reads}=buildZip(standard,{base,zip64});
    const groups=await indexArchiveZip(blob);
    assert.deepEqual((await readArchiveGroup(groups.following,"following")).ids,["3","4","5"]);
    assert.ok(reads.reduce((n,[a,b])=>n+b-a,0)<200000);
    assert.ok(reads.some(([a])=>a>=base));
  }
});
test("bad CRC, decompression overflow and mismatched local names fail before saving",async()=>{
  for(const variant of [{badCRC:true},{claimedSize:3},{localName:"archive/data/follower.tx"}]){
    const items=standard.map(x=>({...x}));
    Object.assign(items[0],{method:8},variant);
    if(variant.localName)items[0].localName="archive/data/follower.xx";
    const groups=await indexArchiveZip(buildZip(items).blob);
    await assert.rejects(()=>readArchiveGroup(groups.follower,"follower"));
  }
});
test("rejects missing lists, duplicate roots, encrypted targets and excessive sizes",async()=>{
  for(const items of [
    standard.filter(x=>!x.name.includes("/follower.js")),
    [...standard,{...standard[0],name:"other/data/follower.js"}],
    [...standard,standard[0]],
    standard.map((x,i)=>i?x:{...x,flags:1}),
    standard.map((x,i)=>i?x:{...x,claimedSize:MAX_ARCHIVE_BYTES+1})
  ])await assert.rejects(()=>indexArchiveZip(buildZip(items).blob));
  await assert.rejects(()=>indexArchiveZip(new Blob(["not a ZIP"])));
});
test("ZIP data descriptor flag is supported and missing parts are still rejected",async()=>{
  const items=standard.map(x=>({...x}));
  items[1].flags=8;
  items[2].text=wrap("following",2,["4"]);
  const groups=await indexArchiveZip(buildZip(items).blob);
  await assert.rejects(()=>readArchiveGroup(groups.following,"following"),/分片缺失/);
});
test("canceling ZIP indexing is atomic",async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>indexArchiveZip(buildZip(standard).blob,{signal:controller.signal}),/取消/);
});
