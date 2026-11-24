import test from "node:test";
import assert from "node:assert/strict";
import {verificationFor,filterAccounts,mergeVerification,parseVerificationCSV} from "../follow-manager/verification.js";
const a="1234567890123456789",b="2234567890123456789",c="3234567890123456789";
test("unknown never matches confirmed blue or non-blue",()=>{
 const s={verification:{[a]:true,[b]:false}};
 assert.deepEqual(filterAccounts([a,b,c],"","blue",s),[a]);
 assert.deepEqual(filterAccounts([a,b,c],"","not-blue",s),[b]);
 assert.deepEqual(filterAccounts([a,b,c],"","unknown",s),[c]);
 assert.deepEqual(filterAccounts([a,b,c],"223","all",s),[b]);
 assert.equal(verificationFor(s,c),null);
});
test("new archives keep only labels for current IDs, explicit null removes",()=>{
 const s={followers:[a],following:[b],verification:{[a]:true,[c]:true}};
 assert.deepEqual({...mergeVerification(s,{[b]:false,[c]:true})},{[a]:true,[b]:false});
 assert.deepEqual({...mergeVerification(s,{[a]:null})},{});
});
test("local CSV preserves large string IDs and rejects conflicting or malformed data",()=>{
 assert.deepEqual({...parseVerificationCSV("account_id,blue_verified\r\n"+a+",true\r\n"+b+",false\r\n"+c+",unknown")},{[a]:true,[b]:false});
 assert.throws(()=>parseVerificationCSV("account_id,blue_verified\n"+a+",true\n"+a+",false"),/冲突/);
 assert.throws(()=>parseVerificationCSV("account_id,blue_verified\n1.23E18,true"),/无效/);
});
