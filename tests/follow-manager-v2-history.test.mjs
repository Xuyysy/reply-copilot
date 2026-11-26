import test from "node:test";
import assert from "node:assert/strict";
import {analyzeHistory,filterChanges,historyCsv,snapshotMetrics} from "../follow-manager/v2/history.js";
import {relationshipById} from "../follow-manager/v2/model.js";
const time="2026-11-26T00:00:00Z";
const snapshot=(rows,extra={})=>({ownerUserId:"1",source:"fixture",capturedAt:time,completeness:"complete",users:rows,relationshipByUserId:relationshipById(rows,"complete"),...extra});
const row=(userId,kind,handle,isBlueVerified=null)=>({userId,kind,handle,displayName:handle,observedAt:time,isBlueVerified});
test("history includes all eight change types and accounts for unknown verification",()=>{
 const prior=snapshot([row("2","followers","old",true),row("2","following","old",true),row("3","followers","gone"),row("5","following","former"),row("6","following","back")]);
 const current=snapshot([row("2","followers","new",false),row("4","followers","fresh",true),row("4","following","fresh",true),row("6","following","back"),row("6","followers","back"),row("7","following","newfollow")]);
 const report=analyzeHistory(current,prior);
 assert.deepEqual(report.counts,{newFollowers:2,missingFollowers:1,newFollowing:2,missingFollowing:2,newMutuals:2,missingMutuals:1,renamed:1,verificationChanged:1});
 assert.equal(report.previous.unknownFollowers,1);assert.equal(report.next.unknownFollowers,1);assert.equal(report.next.blueFollowers,1);assert.equal(report.delta.blueFollowers,0);
 assert.equal(filterChanges(report.rows,"renamed","old")[0].userId,"2");
 assert.equal(filterChanges(report.rows,"missingFollowers","gone").length,1);
});
test("history refuses partial/cross-source/cross-owner; no division by zero",()=>{
 const s=snapshot([]);assert.equal(snapshotMetrics(s).mutualRate,null);assert.equal(analyzeHistory({...s,completeness:"unknown"},s),null);assert.equal(analyzeHistory({...s,source:"other"},s),null);assert.equal(analyzeHistory({...s,ownerUserId:"9"},s),null);
});
test("CSV preserves long IDs and neutralizes formulas and quotes",()=>{
 const csv=historyCsv([{kind:"renamed",userId:"9007199254740993123",handle:"=HYPERLINK(1)",displayName:'a"b',before:"\t=1",after:"@x"}]);assert.ok(csv.includes("'9007199254740993123"));assert.ok(csv.includes("'=HYPERLINK(1)"));assert.ok(csv.includes('a""b'));assert.ok(csv.includes("'@x"));assert.ok(csv.includes("'\t=1"));
});
