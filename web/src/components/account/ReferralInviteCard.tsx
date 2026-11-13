import {useEffect,useState} from "react";
import {Gift,Copy,RefreshCw} from "lucide-react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";

type ReferralMine={
 enabled:boolean;canInvite?:boolean;link?:string|null;bonus?:number;
 registered?:number;rewarded?:number;pending?:number;earnedCredits?:number;
 invitedBy?:{status:string;registeredAt:number;rewardedAt:number|null}|null;
};
export default function ReferralInviteCard({language}:{language:Language}){
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
 if(!data?.enabled)return null;
 return <Card data-testid="account-referral-rewards" className="border-primary/25">
  <CardHeader><CardTitle className="flex items-center gap-2"><Gift size={20}/>{t("邀请好友 · 新人可领 200 + 50 次免费额度","Invite friends · 200 welcome + 50 bonus credits")}</CardTitle></CardHeader>
  <CardContent className="space-y-4">
   <p className="text-sm text-muted-foreground">{t("好友通过邀请链接注册并验证邮箱后，首次绑定插件可正常领取原有的 200 次新人免费额度；成功接收第一条 AI 回复后，再加赠 50 次邀请奖励，合计 250 次。额外邀请奖励不主动过期。","A friend joining through your link still receives the usual 200 welcome credits after first connecting the extension. Once they have verified their email and received their first AI reply, they can earn another 50 referral credits, totaling 250. The extra referral credits do not expire automatically.")}</p>
   {data.canInvite===false&&<p role="status" data-testid="referral-ineligible-explanation" className="text-sm text-muted-foreground">{t("当前账号尚不符合邀请资格。请确认账号已验证邮箱、未被冻结且不是测试账号。","Your account is not eligible to invite yet. Verify your email and make sure your account is active and not marked for testing.")}</p>}
   {data.canInvite&&<div className="space-y-2">
    {data.link?<div className="flex flex-wrap items-center gap-2">
      <input aria-label={t("我的邀请链接","My invite link")} readOnly value={data.link} onFocus={e=>e.target.select()} className="min-w-0 flex-1 rounded-md border bg-muted/30 p-2 text-xs"/>
      <Button type="button" size="sm" variant="outline" onClick={()=>void copy()}><Copy size={15}/>{t("复制链接","Copy link")}</Button>
     </div>:
      <Button type="button" disabled={busy} onClick={()=>void create()}><Gift size={16}/>{t("生成我的邀请链接","Create my invite link")}</Button>}
    <p className="text-xs text-muted-foreground">{t("30 天内最多奖励 10 位有效邀请。仅新注册用户可通过链接建立邀请关系。","Up to 10 rewarded referrals per rolling 30 days. Only newly created accounts can be attributed.")}</p>
   </div>}
   <div className="grid grid-cols-3 gap-2">
    {[[t("邀请注册","Registered"),data.registered],[t("奖励成功","Rewarded"),data.rewarded],[t("累计获赠","Credits earned"),data.earnedCredits]].map(([label,n])=>
     <div key={label} className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block text-xl">{Number(n||0).toLocaleString()}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}
   </div>
   {data.invitedBy&&<p className="text-sm text-muted-foreground">{data.invitedBy.status==="rewarded"?t("你通过好友邀请成功激活，额外获得 50 次免费额度。","Your friend referral earned you 50 extra free replies."):t("你有一笔好友邀请奖励待激活：完成插件绑定并成功接收第一条 AI 回复。","Your invite bonus is pending: connect the extension and receive your first AI reply.")}</p>}
   {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  </CardContent>
 </Card>;
}
