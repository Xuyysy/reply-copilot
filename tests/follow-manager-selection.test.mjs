import test from "node:test";
import assert from "node:assert/strict";
import {detectArchiveKind, groupArchiveFiles, appendArchiveFiles} from "../follow-manager/file-selection.js";
import {MAX_ARCHIVE_BYTES} from "../follow-manager/archive.js";

function fakeFile(name, content, size = Buffer.byteLength(content)) {
  return {
    name, size,
    slice(start, end) {
      return {text: async () => content.slice(start, end)};
    }
  };
}
function archive(kind, part = 0) {
  return fakeFile(kind + (part ? "-part" + part : "") + ".js",
    "window.YTD." + kind + ".part" + part + " = [];\n");
}

test("detects X archive file category from inert header, not just a filename", () => {
  assert.equal(detectArchiveKind("\uFEFF  window.YTD.follower.part0 = []"), "follower");
  assert.equal(detectArchiveKind("window.YTD.following.part12 = []"), "following");
  for (const invalid of [
    "", "window.YTD.directMessages.part0 = []",
    "window.YTD.follower.part1000 = []",
    "alert(1); window.YTD.follower.part0 = []",
    "window.YTD.follower.part0();"
  ]) assert.throws(() => detectArchiveKind(invalid), /无法识别/);
});

test("dragging both official files or selecting both at once creates matching groups", async () => {
  const follower = archive("follower");
  const following = archive("following");
  assert.deepEqual(await groupArchiveFiles([follower, following]), {
    follower:[follower],following:[following]
  });
});

test("accepts same-kind part files, sorted and validated later by the parser", async () => {
  const b = archive("follower", 1);
  const a = archive("follower");
  assert.deepEqual(await groupArchiveFiles([b, a]), {follower:[b,a],following:[]});
});

test("rejects ZIPs, non-official JS, large files, excessive files and empty selection", async () => {
  await assert.rejects(() => groupArchiveFiles([]), /先选择/);
  await assert.rejects(() => groupArchiveFiles([fakeFile("archive.zip", "ZIP")]), /只支持/);
  await assert.rejects(() => groupArchiveFiles([fakeFile("follower.js", "alert(1)")]), /无法识别/);
  await assert.rejects(() => groupArchiveFiles([fakeFile("follower.js", "")]), /只支持/);
  await assert.rejects(() => groupArchiveFiles([fakeFile("follower.js", "window.YTD.follower.part0 = []", MAX_ARCHIVE_BYTES+1)]), /只支持/);
  await assert.rejects(() => groupArchiveFiles(Array.from({length:17},() => archive("follower"))), /16/);
});

test("a mixed drop with bad files fails atomically instead of silently selecting a partial group", async () => {
  const valid=archive("follower"), invalid=fakeFile("following.js", "not an X archive");
  await assert.rejects(() => groupArchiveFiles([valid,invalid]), /无法识别/);
});

test("manual selection adds multiple parts across clicks without discarding earlier parts", async () => {
  const f0=archive("follower"),f1=archive("follower",1),g0=archive("following");
  const first=await appendArchiveFiles({follower:[],following:[]},[f0,g0]);
  const second=await appendArchiveFiles(first,[f1]);
  assert.deepEqual(second,{follower:[f0,f1],following:[g0]});
});

test("new part0 replaces only that category and retains the opposite category", async () => {
  const f0=archive("follower"),f1=archive("follower",1),g0=archive("following");
  const initial=await appendArchiveFiles({follower:[f0,f1],following:[g0]},[archive("follower")]);
  assert.equal(initial.follower.length,1);
  assert.deepEqual(initial.following,[g0]);
});

test("duplicate parts in one selection are rejected atomically", async () => {
  await assert.rejects(()=>groupArchiveFiles([archive("follower",1),archive("follower",1)]),/重复/);
  await assert.rejects(()=>appendArchiveFiles({follower:[],following:[]},[archive("follower",1),archive("follower",1)]),/重复/);
});
