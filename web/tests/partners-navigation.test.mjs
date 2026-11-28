import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../src/"+p,import.meta.url),"utf8");
test("Partners is a fixed public route and login returns only to a fixed destination",()=>{
 const base=read("layouts/Base.astro"),login=read("components/auth/AuthPanel.tsx"),page=read("pages/partners.astro"),dashboard=read("components/account/PartnerDashboard.tsx");
 assert.match(base,/data-nav-id="partners"[^>]*href="\/partners"/);
 assert.match(base,/<a href="\/partners" data-zh="推广合伙人"/);
 assert.match(page,/<PartnerDashboard client:load/);
 assert.match(dashboard,/api<[^\n]+\("\/v1\/me"\)/);
 assert.match(dashboard,/state.kind==="ready"&&<ReferralAndPartnerCards/);
 assert.match(login,/deviceCode && \/\^\[A-F0-9\]\{8\}\$\/\.test\(deviceCode\)[^\n]+searchParams\.get\("next"\)==="partners" \? "\/partners" : "\/account"/);
});
