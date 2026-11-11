import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const html=name=>readFileSync(path.join(root,"dist",name,"index.html"),"utf8");
const source=p=>readFileSync(path.join(root,p),"utf8");

test("routine announcements are located in the guide, not repeated on account, login, or every refresh",()=>{
 for(const route of ["account","login","pricing","faq"]){
  const rendered=html(route);
  assert.doesNotMatch(rendered,/data-site-text="announcement"/,route+" must not show the repetitive onboarding banner");
  assert.match(rendered,/data-site-text="maintenance"/,route+" must preserve important maintenance notices");
 }
 assert.match(html("guide"),/data-site-text="announcement"/);
 const base=source("src/layouts/Base.astro");
 assert.match(base,/isGuidePage/);
 assert.match(base,/isGuidePage && <div class="container notice" data-site-text="announcement"/);
});

test("account initial read is resilient: transient failures retry, optional history does not block identity",()=>{
 const account=source("src/components/account/AccountDashboard.tsx");
 const loader=source("src/lib/account-load.mjs");
 assert.match(account,/loadAccountSnapshot\(api\)/);
 assert.match(account,/languageRef\.current/);
 assert.match(account,/useCallback\(\(silent=false,fresh=false\)/);
 assert.match(account,/\},\s*\{fresh\}\), \[\]\)/);
 assert.match(account,/accountOwner\.current===null\)setState\("loading"\)/);
 assert.match(account,/activity:activity\?\?/);
 assert.match(loader,/retryAccountRead/);
 assert.match(loader,/Promise\.all/);
 assert.match(loader,/request\("\/v1\/activity"\)\.catch\(\(\) => null\)/);
 assert.match(account,/setState\("signed-out"\)/);
});

test("persistent read failures are neutral and accessible instead of an alarming red banner",()=>{
 const account=source("src/components/account/AccountDashboard.tsx");
 assert.match(account,/<Card data-account-recovery/);
 assert.match(account,/账户内容暂未加载/);
 assert.match(account,/重新加载/);
 assert.doesNotMatch(account,/账户暂时无法读取/);
 assert.doesNotMatch(account,/if \(state === "error" \|\| !data\) return <Alert variant="destructive"/);
 assert.match(account,/if \(code && !validCode\) return <Alert variant="destructive" role="alert">/);
 assert.doesNotMatch(account,/CreatorMomentumIntelligence/);
 const terminal=source("src/pages/momentum-terminal.astro");
 assert.match(terminal,/<CreatorMomentumIntelligence client:load \/>/);
});
