import {useEffect,useState} from "react";
import {Gift,Copy,CheckCircle2,Users,Share2} from "lucide-react";
import {buildReferralShareText} from "../../lib/referral-share.mjs";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";

type ReferralMine={
 enabled:boolean;canInvite?:boolean;link?:string|null;bonus?:number;
 registered?:number;rewarded?:number;pending?:number;earnedCredits?:number;
 invitedBy?:{status:string;registeredAt:number;rewardedAt:number|null}|null;
 invites?:{registeredAt:number;status:string;label:string}[];
};
export default function ReferralInviteCard({language,showRecruitment}:{language:Language;showRecruitment:boolean}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [data,setData]=useState<ReferralMine|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 useEffect(()=>{
  let mounted=true;
  void api<ReferralMine>("/v1/referrals/me").then(x=>{if(mounted){setData(x);setError("");}})
   .catch(()=>{if(mounted)setError(t("邀请数据暂时无法加载，请刷新重试。","Unable to load referral data. Try again."));})
   .finally(()=>{if(mounted)setLoading(false);});
  return()=>{mounted=false};
 // language only affects display text; avoid repeated API calls on locale change
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const create=async()=>{
  if(busy)return;
  setBusy(true);setError("");setMessage("");
  try{
   const link=await api<{enabled:boolean;link:string}>("/v1/referrals/link",{method:"POST",body:"{}"});
   setData(prev=>prev?{...prev,link:link.link}:prev);
  }catch{setError(t("邀请链接暂时无法创建。","Unable to create your invite link."));}
  finally{setBusy(false);}
 };
 const copy=async()=>{
  if(!data?.link)return;
  try{await navigator.clipboard.writeText(data.link);setMessage(t("链接已复制","Link copied"));}
  catch{setError(t("无法自动复制，可选中链接手动复制。","Select and copy the link manually."));}
 };
 const copyShare=async()=>{
  if(!data?.link)return;
  const text=buildReferralShareText(data.link,window.location.origin,language);
  if(!text){setError(t("邀请链接暂时无法生成分享文案，请直接复制链接。","Unable to prepare share text. Copy the link instead."));return;}
  try{await navigator.clipboard.writeText(text);setMessage(t("分享文案和邀请链接已复制","Share text and invite link copied"));setError("");}
  catch{setError(t("无法自动复制，请直接复制邀请链接。","Unable to copy. Copy the invite link instead."));}
 };
 const registered=data?.registered??0,rewarded=data?.rewarded??0,pending=data?.pending??Math.max(0,registered-rewarded),earned=data?.earnedCredits??0;
 const bonus=data?.bonus??50;
 const percent=registered>0?Math.min(100,Math.round(rewarded/registered*100)):0;
 if(loading)return <div data-testid="referral-user-loading" role="status" className="text-sm text-muted-foreground">{t("正在读取邀请奖励…","Loading referral rewards…")}</div>;
 if(!data?.enabled)return null;
 return <Card data-testid="account-referral-rewards" className="border-primary/25">
  <CardHeader><CardTitle className="flex items-center gap-2"><Gift size={20}/>{t("邀请好友 · 双方各得 50 次，新人另领 200 次","Invite friends · 50 bonus credits each + 200 welcome credits for newcomers")}</CardTitle></CardHeader>
  <CardContent className="space-y-4">
   <p className="text-sm text-muted-foreground">{t("好友通过你的邀请链接注册并验证邮箱后，首次绑定插件可领取原有的 200 次新人免费额度；成功接收第一条 AI 回复后，你和好友各额外获得 50 次。好友合计 250 次，邀请奖励不主动过期。","A friend who signs up through your link and verifies their email receives the usual 200 welcome credits after first connecting the extension. Once they successfully receive their first AI reply, both you and your friend earn 50 extra credits each. Your friend receives 250 credits in total, and the referral bonuses do not expire automatically.")}</p>
   <div className="rounded-xl border bg-muted/20 p-4 space-y-3" data-testid="referral-journey">
    <h3 className="flex items-center gap-2 font-semibold"><Users size={18}/>{t("你的邀请之旅","Your referral journey")}</h3>
    <div className="grid gap-2 sm:grid-cols-3">
     {[[t("分享专属链接","Share your link"),t("发给朋友，或发布到 X、社群。好友必须使用链接注册新账号。","Send it to friends or share on X and in communities. Friends must use it to create a new account.")],[t("好友完成激活","Friend activates"),t("验证邮箱、首次绑定插件并成功接收第一条 AI 回复。","Verify email, connect the extension for the first time, and successfully receive the first AI reply.")],[t("双方领取奖励","Both earn rewards"),t("符合奖励条件后自动到账，你 +50 次，好友额外 +50 次。","When eligible, rewards arrive automatically: +50 for you and +50 extra for your friend.")]].map(([title,desc],i)=><div key={title} className="rounded-lg border bg-background p-3"><span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i+1}</span><p className="font-medium text-sm">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p></div>)}
    </div>
   </div>
   {data.canInvite===false&&<p role="status" data-testid="referral-ineligible-explanation" className="text-sm text-muted-foreground">{t("当前账号尚不符合邀请资格。请确认账号已验证邮箱、未被冻结且不是测试账号。","Your account is not eligible to invite yet. Verify your email and make sure your account is active and not marked for testing.")}</p>}
   {data.canInvite&&<div className="space-y-2">
    {data.link?<div className="flex flex-wrap items-center gap-2">
      <input aria-label={t("我的邀请链接","My invite link")} readOnly value={data.link} onFocus={e=>e.target.select()} className="min-w-0 flex-1 rounded-md border bg-muted/30 p-2 text-xs"/>
      <Button type="button" size="sm" variant="outline" onClick={()=>void copy()}><Copy size={15}/>{t("复制链接","Copy link")}</Button>
      <Button type="button" size="sm" onClick={()=>void copyShare()}><Share2 size={15}/>{t("复制分享文案","Copy share text")}</Button>
     </div>:<Button type="button" disabled={busy} onClick={()=>void create()}><Gift size={16}/>{t("生成我的邀请链接","Create my invite link")}</Button>}
    {showRecruitment&&<div className="space-y-3 rounded-lg bg-muted/40 p-3" data-testid="partner-recruitment">
       <h3 className="font-semibold">{t("想让流量变现？成为推广合伙人","Turn your audience into income. Become a partner.")}</h3>
       <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{t("你的推广佣金","Your commission")}</p><strong className="block text-2xl text-emerald-600">15%+</strong><p className="text-xs text-muted-foreground">{t("符合条件的购买订单","Qualifying purchases")}</p></div>
        <div className="min-w-0 rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{t("粉丝专属福利","Your audience's bonus")}</p><strong className="block text-2xl">{t("250 次","250 replies")}</strong><p className="text-xs text-muted-foreground">{t("比直接注册多送 50 次","50 more than direct signup")}</p></div>
       </div>
       <p className="text-sm">{t("通过你的专属邀请链接注册，粉丝完成激活条件后可获得共计 250 次免费回复额度，你也可获得额外 50 次邀请奖励。","Fans who sign up through your invite link can earn 250 free replies in total after meeting the reward requirements. You can earn 50 bonus replies too.")}</p>
       <p className="text-sm">{t("成为合伙人后，粉丝产生的符合条件的充值及订阅订单，还能为你带来最低 15% 的约定佣金收入。","Approved partners also earn an agreed commission of at least 15% on qualifying credit and subscription purchases made by their referrals.")}</p>
       <div className="rounded-lg border bg-background p-3 space-y-2">
        <p className="text-sm font-semibold">{t("举个例子：你的推广能带来多少佣金？","Example: what could your referrals earn?")}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
         <div><span className="text-xs text-muted-foreground">{t("符合条件的订单本金","Qualifying order principal")}</span><strong className="block">¥100.00</strong></div>
         <div><span className="text-xs text-muted-foreground">{t("按15%计算的佣金","Commission at 15%")}</span><strong className="block text-emerald-600">¥15.00</strong></div>
        </div>
        <p className="text-xs text-muted-foreground">{t("仅为计算示例，不代表保证收益。开通后按约定比例、有效合作期限和核实的订单本金计佣，达到门槛可申请人工结算。","Illustration only, not guaranteed earnings. After approval, commission is based on the agreed rate, eligible term and verified order principal; request manual settlement once the threshold is met.")}</p>
       </div>
       <p className="text-sm font-semibold">{t("粉丝更划算，你也有收益。","A better deal for your audience, extra income for you.")}</p>
       <p className="text-sm">{t("想成为合伙人获得现金返佣？请先私信我，审核通过后开通。","Want to earn cash commissions? DM me first for approval and activation.")}{" "}<a href="https://x.com/yyx1945969" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">{t("在 X 上私信 @yyx1945969","DM @yyx1945969 on X")}</a></p>
       <p className="text-xs text-muted-foreground">{data.link?t("审核开通后，继续使用已有邀请链接，无需重新生成。","After approval, keep using your existing invite link; no new link is needed."):t("普通邀请奖励无需申请合作，生成链接不代表开通现金返佣。","Standard referral rewards do not require approval. Creating a link does not activate cash commissions.")}</p>
      </div>}
    <p className="text-xs text-muted-foreground">{t("30 天内最多奖励 20 位有效邀请。仅新注册用户可通过链接建立邀请关系。","Up to 20 rewarded referrals per rolling 30 days. Only newly created accounts can be attributed.")}</p>
   </div>}
   <div className="space-y-3" data-testid="referral-progress">
    <h3 className="font-semibold">{t("我的推广成果","My referral progress")}</h3>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
     {[[t("邀请注册","Registered"),registered,t("通过你的链接注册","Joined through your link")],[t("奖励成功","Rewarded"),rewarded,t("已完成奖励发放","Rewards issued")],[t("待发放","Awaiting reward"),pending,t("尚未获得邀请奖励","Not yet rewarded")],[t("累计获赠","Credits earned"),earned,t("累计邀请免费额度","Lifetime referral credits")]].map(([label,n,desc])=>
      <div key={label} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong className="block text-2xl tabular-nums">{Number(n).toLocaleString()}{label===t("累计获赠","Credits earned")&&<span className="ml-1 text-xs font-normal">{t("次","credits")}</span>}</strong><p className="mt-1 text-xs text-muted-foreground">{desc}</p></div>)}
    </div>
    <div className="rounded-lg border p-3 space-y-2">
     <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">{t("已发放奖励的邀请进度","Rewarded referral progress")}</span><strong>{rewarded} / {registered} · {percent}%</strong></div>
     <div role="progressbar" aria-label={t("奖励发放进度","Rewarded referral progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-600" style={{width:percent+"%"}}/></div>
     <p className="text-sm">{rewarded>0?<><CheckCircle2 size={16} className="mr-1 inline text-emerald-600"/>{t("你已经成功获得 "+earned+" 次邀请奖励！","You've earned "+earned+" referral credits!")}</>:t("你的第一个有效邀请，可能带来 "+bonus+" 次额外免费额度。","Your first qualifying referral could earn "+bonus+" extra credits.")}</p>
     <p className="text-xs text-muted-foreground">{pending>0?t("还有 "+pending+" 位好友尚未获奖。可提醒好友完成激活；奖励仍需满足资格及30天上限。",pending+" friends have not yet been rewarded. Remind them to activate; eligibility and the rolling 30-day cap still apply."):t("继续分享，每新增一位符合条件的有效邀请可再获 "+bonus+" 次。","Keep sharing. Each additional eligible rewarded referral can earn "+bonus+" more credits.")}</p>
     <p className="text-xs text-muted-foreground">{t("这里显示累计数据，不是最近30天奖励剩余额度。","These are lifetime totals, not your remaining 30-day reward allowance.")}</p>
    </div>
   </div>
   <div className="space-y-2"><h3 className="font-semibold">{t("最近邀请注册","Recent registrations")}</h3>{data.invites?.length?<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>{t("受邀用户","Invitee")}</th><th>{t("注册时间","Registered")}</th><th>{t("奖励状态","Reward status")}</th><th>{t("你的奖励","Your reward")}</th></tr></thead><tbody>{data.invites.map((r,i)=><tr key={i} className="border-t"><td className="py-2">{r.label}</td><td>{new Date(r.registeredAt).toLocaleString()}</td><td>{r.status==="rewarded"?t("已激活 · 已发放","Activated · Rewarded"):t("待发放","Awaiting reward")}</td><td className={r.status==="rewarded"?"font-medium text-emerald-600":"text-muted-foreground"}>{r.status==="rewarded"?("+"+bonus+" "+t("次","credits")):"—"}</td></tr>)}</tbody></table></div>:<p className="text-sm text-muted-foreground">{t("暂无邀请注册记录。","No registrations yet.")}</p>}<p className="text-xs text-muted-foreground">{t("展示最近 30 条记录，保护受邀用户隐私。","Latest 30 records; invitee privacy is protected.")}</p></div>
   {data.invitedBy&&<p className="text-sm text-muted-foreground">{data.invitedBy.status==="rewarded"?t("你通过好友邀请成功激活，额外获得 50 次免费额度。","Your friend referral earned you 50 extra free replies."):t("你有一笔好友邀请奖励待激活：完成插件绑定并成功接收第一条 AI 回复。","Your invite bonus is pending: connect the extension and receive your first AI reply.")}</p>}
   {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  </CardContent>
 </Card>;
}
