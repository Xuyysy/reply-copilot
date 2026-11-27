import test from "node:test";
import assert from "node:assert/strict";
import {buildReferralShareText} from "../src/lib/referral-share.mjs";
const origin="https://staging.example.test";
const link=origin+"/login/?mode=register&ref=0123456789abcdef";
test("shares the existing invite link in either language without promising cash",()=>{
  const zh=buildReferralShareText(link,origin,"zh"), en=buildReferralShareText(link,origin,"en");
  assert.ok(zh.endsWith(link));assert.ok(en.endsWith(link));
  assert.match(zh,/邀请链接/);assert.match(en,/invite link/);
  assert.doesNotMatch(zh,/现金|佣金|提现/);assert.doesNotMatch(en,/cash|commission|payout/i);
});
test("refuses invalid, foreign, non-registration or augmented URLs",()=>{
  for(const bad of ["", "javascript:alert(1)", link.replace(origin,"https://elsewhere.example.test"),
    link.replace("/login/","/account/"),link.replace("mode=register","mode=login"),link.replace("0123456789abcdef","bad"),
    link+"&ref=0123456789abcdef",link+"&next=https://example.test",link+"#fragment",
    link.replace("https://","https://someone@")]) assert.equal(buildReferralShareText(bad,origin,"zh"),"");
  assert.equal(buildReferralShareText(link,"","zh"),"");
});
