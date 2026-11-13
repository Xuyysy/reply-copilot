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
 assert.match(card,/referral-ineligible-explanation/);
 assert.match(card,/免费额度/);
 assert.match(card,/50 次/);
 assert.match(card,/原有的 200 次新人免费额度/);
 assert.match(card,/双方各得 50 次，新人另领 200 次/);
 assert.match(card,/你和好友各额外获得 50 次/);
 assert.match(card,/both you and your friend earn 50 extra credits each/);
 assert.match(card,/合计 250 次/);
 assert.match(card,/30 天内最多奖励 20 位有效邀请/);
 assert.match(card,/Up to 20 rewarded referrals per rolling 30 days/);
 assert.doesNotMatch(card,/\/v1\/admin\/users.*\/credits/);
});
test("registration accepts a bounded link attribution, never a raw URL or existing account relink",()=>{
 assert.match(login,/searchParams\.get\("ref"\)/);
 assert.match(login,/\/\^\[0-9a-f\]\{16\}\$\//);
 assert.match(login,/referralCode:validReferralCode/);
 assert.match(login,/referral-signup-notice/);
 assert.match(login,/好友邀请福利：首次绑定插件领 200 次免费额度/);
 assert.match(login,/成功收到第一条 AI 回复再送 50 次，合计 250 次/);
 assert.doesNotMatch(login,/双方各可获得额外 50 次免费额度/);
 assert.doesNotMatch(login,/你正通过好友邀请注册：新人原有的 200 次免费额度照常发放/);
 assert.match(login,/\{!validReferralCode&&<p/);
 assert.match(login,/data-registration-email-tip/);
 assert.match(login,/请检查垃圾邮箱或广告邮件文件夹/);
 assert.match(login,/data-email-delivery-tip/);
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
