import test from "node:test";
import assert from "node:assert/strict";
import {mergeArchiveSnapshot} from "../follow-manager/archive-history.js";
const at = n => new Date(Date.UTC(2026,10,n)).toISOString();
const s = (followers,following,n=1,owner="alice")=>({owner,importedAt:at(n),followers,following});
test("stable string IDs, set-based comparison, archive order not chronology",()=>{
  const a=mergeArchiveSnapshot(null,s(["9007199254740993","2"],["2","3"]));
  const b=mergeArchiveSnapshot(a,s(["9007199254740993","3"],["3","4"],2));
  assert.deepEqual(b.history[0].followers,{added:1,removed:1});
  assert.deepEqual(b.history[0].following,{added:1,removed:1});
  assert.deepEqual(b.history[0].mutual,{added:1,removed:1});
  assert.equal(b.followers[0],"9007199254740993");
  assert.equal(b.source,"official_archive");
});
test("duplicates and identical reimport produce no change record",()=>{
  const a=mergeArchiveSnapshot(null,s(["1","1","2"],["2"]));
  assert.deepEqual(a.followers,["1","2"]);
  const b=mergeArchiveSnapshot(a,s(["2","1"],["2"],2));
  assert.deepEqual(b.history,[]);
});
test("owner isolation, malformed IDs, bounded history and legacy snapshot",()=>{
  assert.deepEqual(mergeArchiveSnapshot(s(["1"],[],1,"bob"),s(["2"],[],2)).history,[]);
  assert.throws(()=>mergeArchiveSnapshot(null,s([9007199254740993],[])));
  let prev=s(["1"],[]);
  for(let i=2;i<=9;i++)prev=mergeArchiveSnapshot(prev,s([String(i)],[],i));
  assert.equal(prev.history.length,5);
  assert.equal(prev.history[0].importedAt,at(9));
});
test("large exact IDs remain linear set comparisons",()=>{
  const ids=Array.from({length:30000},(_,i)=>String(100000+i));
  const a=mergeArchiveSnapshot(null,s(ids,ids));
  const b=mergeArchiveSnapshot(a,s(ids.slice(1),ids,2));
  assert.deepEqual(b.history[0].followers,{added:0,removed:1});
  assert.deepEqual(b.history[0].mutual,{added:0,removed:1});
});