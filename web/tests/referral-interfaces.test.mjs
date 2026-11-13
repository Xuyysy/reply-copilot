import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const account=read("../src/components/account/AccountDashboard.tsx");
const card=read("../src/components/account/ReferralInviteCard.tsx");
const login=read("../src/components/auth/AuthPanel.tsx");
const admin=read("../src/components/admin/AdminDashboard.tsx");
const adminPanel=read("../src/components/admin/ReferralAdminPanel.tsx");

test("My Account includes V1 referrals beside existing free and paid credit balances",()=>{
 assert.match(account,/import ReferralInviteCard from "\.\/ReferralInviteCard"/);
 assert.match(account,/<ReferralInviteCard language=\{language\}\/>/);
 assert.match(card,/account-referral-rewards/);
 assert.match(card,/\/v1\/referrals\/me/);
 assert.match(card,/\/v1\/referrals\/link/);
 assert.match(card,/method:"POST"/);
 assert.match(card,/navigator\.clipboard\.writeText/);
 assert.match(card,/免费额度/);
 assert.match(card,/50 次/);
 assert.doesNotMatch(card,/\/v1\/admin\/users.*\/credits/);
});
test("registration accepts a bounded link attribution, never a raw URL or existing account relink",()=>{
 assert.match(login,/searchParams\.get\("ref"\)/);
 assert.match(login,/\/\^\[0-9a-f\]\{16\}\$\//);
 assert.match(login,/referralCode:validReferralCode/);
 assert.match(login,/referral-signup-notice/);
 assert.match(login,/\/v1\/auth\/register/);
 assert.doesNotMatch(login,/\/v1\/referrals\/claim/);
});
test("Admin V2 has a read-only invitation rewards workspace",()=>{
 assert.match(admin,/ReferralAdminPanel/);
 assert.match(admin,/\["referrals",t\("邀请奖励","Referral rewards"\)\]/);
 assert.match(admin,/<TabsContent value="referrals">/);
 assert.match(adminPanel,/admin-referrals/);
 assert.match(adminPanel,/\/v1\/admin\/referrals/);
 assert.match(adminPanel,/发放次数/);
 assert.match(adminPanel,/测试账号/);
 assert.doesNotMatch(adminPanel,/method:"POST"|api\(.+method:/);
});
