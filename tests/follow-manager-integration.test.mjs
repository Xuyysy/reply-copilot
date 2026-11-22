import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("offline follow manager ships inside every extension build and opens from native side panel", () => {
  const html = read("sidepanel/sidepanel.html");
  const js = read("sidepanel/sidepanel.js");
  const build = read("scripts/build.js");
  const page = read("follow-manager/manager.html");
  assert.match(html, /id="nav-follow-manager"/);
  assert.match(js, /chrome\.tabs\.create\(\{url:chrome\.runtime\.getURL\('follow-manager\/manager\.html'\)\}\)/);
  assert.match(build, /"follow-manager"/);
  assert.match(page, /content\/design-tokens\.css/);
  assert.match(page, /id="archive-dropzone"/);
  assert.match(page, /id="choose-files"/);
  assert.match(page, /id="archive-picker"[^>]+multiple/);
  assert.match(page, /id="clear-selection"/);
  assert.match(page, /id="selected-follower"/);
  assert.match(page, /id="selected-following"/);
  assert.doesNotMatch(page, /id="follower-files"|id="following-files"|class="file-grid"/);
  assert.match(page, /id="same-account"/);
  assert.match(page, /id="delete-saved"/);
  assert.match(page, /id="export-csv"/);
  assert.match(page, /script type="module" src="manager\.js"/);
});

test("the MVP never obtains X session secrets or sends followers to an API", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes("cookies"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.equal(manifest.host_permissions.some(p => /x\.com|twitter\.com/.test(p)), false);
  for (const path of [
    "follow-manager/archive.js", "follow-manager/store.js", "follow-manager/manager.js", "follow-manager/file-selection.js"
  ]) {
    const file = read(path);
    assert.doesNotMatch(file, /chrome\.cookies|document\.cookie|auth_token|x-csrf-token|graphql|XMLHttpRequest|fetch\s*\(|sendBeacon|eval\s*\(|new Function/);
  }
  const page = read("follow-manager/manager.html");
  assert.doesNotMatch(page, /<script[^>]+src="https?:\/\//);
  assert.doesNotMatch(read("follow-manager/manager.js"), /chrome\.runtime\.sendMessage|chrome\.storage/);
  assert.match(read("follow-manager/store.js"), /indexedDB\.open/);
});

test("follow manager does not touch existing AI, account, Worker, D1 or quota paths", () => {
  const js = read("follow-manager/manager.js");
  assert.doesNotMatch(js, /REPLY_COPILOT_|AccountClient|HostedAIClient|Quota|ReplyEngine|payment|subscription/);
  const html = read("sidepanel/sidepanel.html");
  assert.match(html, /id="momentum-control"/);
  assert.match(html, /id="subscription-quota"/);
  assert.match(html, /id="quick-style"/);
  assert.match(html, /id="account-name"/);
});


test("drag and browse share the same safe in-memory file selection pipeline", () => {
  const js = read("follow-manager/manager.js");
  const page = read("follow-manager/manager.html");
  assert.match(js, /dropzone\.addEventListener\("drop"/);
  assert.match(js, /dropzone\.addEventListener\("dragover"/);
  assert.match(js, /"archive-picker"\)\.addEventListener\("change"/);
  assert.doesNotMatch(js, /"follower-files"|"following-files"|expectedKind/);
  assert.match(js, /async function acceptFiles\(fileList\)/);
  assert.match(js, /const groups = await groupArchiveFiles\(fileList\)/);
  assert.match(js, /readGroup\(selectedFiles\.follower, "follower"\)/);
  assert.match(js, /readGroup\(selectedFiles\.following, "following"\)/);
  assert.doesNotMatch(js, /new DataTransfer|\.innerHTML\s*=|\.upload\(/);
  assert.match(page, /不支持直接导入 ZIP/);
});
