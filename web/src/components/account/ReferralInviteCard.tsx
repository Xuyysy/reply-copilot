import {useEffect,useState,type ReactNode} from "react";
import {Gift,Copy,RefreshCw} from "lucide-react";
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
export default function ReferralInviteCard({language,showRecruitment,renderPartner}:{language:Language;showRecruitment:boolean;renderPartner?:(invites:ReactNode)=>ReactNode}){
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
 if(loading)return <div data-testid="referral-user-loading" role="status" className="text-sm text-muted-foreground">{t("正在读取邀请奖励…","Loading referral rewards…")}</div>;
 if(!data?.enabled&&!renderPartner)return error?<p role="alert" className="text-sm text-red-700">{error}</p>:null;
 const inviteRecords=data?.enabled?<div className="space-y-2"><h3 className="font-semibold">{t("最近邀请注册","Recent registrations")}</h3>{data.invites?.length?<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>{t("受邀用户","Invitee")}</th><th>{t("注册时间","Registered")}</th><th>{t("奖励状态","Reward status")}</th></tr></thead><tbody>{data.invites.map((r,i)=><tr key={i} className="border-t"><td className="py-2">{r.label}</td><td>{new Date(r.registeredAt).toLocaleString()}</td><td>{r.status==="rewarded"?t("已激活","Activated"):t("待激活","Pending")}</td></tr>)}</tbody></table></div>:<p className="text-sm text-muted-foreground">{t("暂无邀请注册记录。","No registrations yet.")}</p>}<p className="text-xs text-muted-foreground">{t("展示最近 30 条记录，保护受邀用户隐私。","Latest 30 records; invitee privacy is protected.")}</p></div>:<p className="text-sm text-muted-foreground">{t("邀请记录暂不可用。","Referral records are unavailable.")}</p>;
 return <Card data-testid="account-referral-rewards" className="border-primary/25">
  <CardHeader><CardTitle className="flex items-center gap-2"><Gift size={20}/>{t("我的推广中心","My referral center")}</CardTitle></CardHeader>
  <CardContent className="space-y-4">
   {data?.enabled&&<>
   <p className="text-sm font-medium">{t("邀请好友 · 双方各得 50 次，新人另领 200 次","Invite friends · 50 bonus credits each + 200 welcome credits for newcomers")}</p>
   <p className="text-sm text-muted-foreground">{t("好友通过你的邀请链接注册并验证邮箱后，首次绑定插件可领取原有的 200 次新人免费额度；成功接收第一条 AI 回复后，你和好友各额外获得 50 次。好友合计 250 次，邀请奖励不主动过期。","A friend who signs up through your link and verifies their email receives the usual 200 welcome credits after first connecting the extension. Once they successfully receive their first AI reply, both you and your friend earn 50 extra credits each. Your friend receives 250 credits in total, and the referral bonuses do not expire automatically.")}</p>
   {data.canInvite===false&&<p role="status" data-testid="referral-ineligible-explanation" className="text-sm text-muted-foreground">{t("当前账号尚不符合邀请资格。请确认账号已验证邮箱、未被冻结且不是测试账号。","Your account is not eligible to invite yet. Verify your email and make sure your account is active and not marked for testing.")}</p>}
   {data.canInvite&&<div className="space-y-2">
    {data.link?<div className="flex flex-wrap items-center gap-2">
      <input aria-label={t("我的邀请链接","My invite link")} readOnly value={data.link} onFocus={e=>e.target.select()} className="min-w-0 flex-1 rounded-md border bg-muted/30 p-2 text-xs"/>
      <Button type="button" size="sm" variant="outline" onClick={()=>void copy()}><Copy size={15}/>{t("复制链接","Copy link")}</Button>
     </div>:<Button type="button" disabled={busy} onClick={()=>void create()}><Gift size={16}/>{t("生成我的邀请链接","Create my invite link")}</Button>}
    {showRecruitment&&<div className="space-y-3 rounded-lg bg-muted/40 p-3" data-testid="partner-recruitment">
       <h3 className="font-semibold">{t("想让流量变现？成为推广合伙人","Turn your audience into income. Become a partner.")}</h3>
       <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{t("你的推广佣金","Your commission")}</p><strong className="block text-2xl text-emerald-600">15%+</strong><p className="text-xs text-muted-foreground">{t("符合条件的购买订单","Qualifying purchases")}</p></div>
        <div className="min-w-0 rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{t("粉丝专属福利","Your audience's bonus")}</p><strong className="block text-2xl">{t("250 次","250 replies")}</strong><p className="text-xs text-muted-foreground">{t("比直接注册多送 50 次","50 more than direct signup")}</p></div>
       </div>
       <p className="text-sm">{t("通过你的专属邀请链接注册，粉丝完成激活条件后可获得共计 250 次免费回复额度，你也可获得额外 50 次邀请奖励。","Fans who sign up through your invite link can earn 250 free replies in total after meeting the reward requirements. You can earn 50 bonus replies too.")}</p>
       <p className="text-sm">{t("成为合伙人后，粉丝产生的符合条件的充值及订阅订单，还能为你带来最低 15% 的约定佣金收入。","Approved partners also earn an agreed commission of at least 15% on qualifying credit and subscription purchases made by their referrals.")}</p>
       <p className="text-sm font-semibold">{t("粉丝更划算，你也有收益。","A better deal for your audience, extra income for you.")}</p>
       <p className="text-sm font-semibold">{t("无需把账号变成广告号！保持你原有的内容和更新节奏，偶尔分享几次自己的邀请链接就可以。","No need to turn your account into an ad feed. Keep posting your own content as usual and share your referral link from time to time.")}</p>
       <p className="text-sm">{t("想成为合伙人获得现金返佣？请先私信我，审核通过后开通。","Want to earn cash commissions? DM me first for approval and activation.")}{" "}<a href="https://x.com/yyx1945969" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">{t("在 X 上私信 @yyx1945969","DM @yyx1945969 on X")}</a></p>
       <p className="text-xs text-muted-foreground">{data.link?t("审核开通后，继续使用已有邀请链接，无需重新生成。","After approval, keep using your existing invite link; no new link is needed."):t("普通邀请奖励无需申请合作，生成链接不代表开通现金返佣。","Standard referral rewards do not require approval. Creating a link does not activate cash commissions.")}</p>
      </div>}
    <p className="text-xs text-muted-foreground">{t("普通邀请的免费额度奖励，每30天最多20位。推广合伙人的现金佣金不受此人数限制。仅新注册用户可通过链接建立邀请关系。","Free-credit rewards are limited to 20 successful referrals per rolling 30 days. Affiliate commissions have no such referral-count limit. Only new accounts can be attributed via a referral link.")}</p>
   </div>}
   <div className="grid grid-cols-3 gap-2">
    {[[t("邀请注册","Registered"),data.registered],[t("奖励成功","Rewarded"),data.rewarded],[t("累计免费奖励","Free credits earned"),data.earnedCredits]].map(([label,n])=>
     <div key={label} className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block text-xl">{Number(n||0).toLocaleString()}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}
   </div>
   {data.invitedBy&&<p className="text-sm text-muted-foreground">{data.invitedBy.status==="rewarded"?t("你通过好友邀请成功激活，额外获得 50 次免费额度。","Your friend referral earned you 50 extra free replies."):t("你有一笔好友邀请奖励待激活：完成插件绑定并成功接收第一条 AI 回复。","Your invite bonus is pending: connect the extension and receive your first AI reply.")}</p>}
   {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
   </>}
   {renderPartner?renderPartner(inviteRecords):inviteRecords}
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  </CardContent>
 </Card>;
}
