import {useEffect,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
import {Input} from "../ui/input";

type Entry={invited_user_id:string;inviter_user_id:string;inviter_email:string;invited_email:string;status:"pending"|"rewarded";registered_at:number;rewarded_at:number|null};
type Stats={registered:number;activated:number;pending:number;inviters:number;issuedCredits:number};
type Result={enabled:boolean;totals?:Stats;items?:Entry[];offset?:number;pageSize?:number};
export default function ReferralAdminPanel({active,language}:{active:boolean;language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [value,setValue]=useState<Result|null>(null);
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState("");
 const [offset,setOffset]=useState(0);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!active)return;
  let live=true;setLoading(true);
  const params=new URLSearchParams({offset:String(offset)});
  if(filter)params.set("q",filter);
  void api<Result>("/v1/admin/referrals?"+params).then(result=>{if(live){setValue(result);setError("");}})
   .catch(()=>{if(live)setError(t("邀请统计暂不可用，请重试。","Referral statistics unavailable."));})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 // input language changes should not cause another database query
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[active,filter,offset]);
 if(!active)return null;
 return <section data-testid="admin-referrals" className="space-y-4">
  <Card><CardHeader><CardTitle>{t("邀请奖励 · 用户增长","Referral rewards · User growth")}</CardTitle></CardHeader>
   <CardContent className="space-y-4">
    {loading&&<p role="status" className="text-sm text-muted-foreground">{t("正在加载数据…","Loading…")}</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {value?.enabled===false&&<p className="text-sm text-muted-foreground">{t("邀请奖励尚未启用，需要独立审核数据库迁移与发布配置。","Referral rewards are not enabled; a separately approved migration and rollout are required.")}</p>}
    {value?.enabled&&<div className="grid gap-2 sm:grid-cols-5">
      {[[t("邀请注册","Registered"),value.totals?.registered],[t("有效激活","Activated"),value.totals?.activated],[t("待激活","Pending"),value.totals?.pending],[t("邀请人数","Inviters"),value.totals?.inviters],[t("发放次数","Credits issued"),value.totals?.issuedCredits]].map(([label,n])=>
       <div key={label} className="rounded-lg border bg-slate-50 p-3"><strong className="block text-xl">{Number(n||0).toLocaleString()}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}
    </div>}
    {value?.enabled&&<p className="text-xs text-muted-foreground">{t("仅统计普通真实用户；管理员与已标记的测试账号不计入增长 KPI。奖励仅在成功送达首条 AI 回复后发放。","Real-user accounts only; administrators and marked test accounts are excluded. Bonuses require delivery of the first AI reply.")}</p>}
   </CardContent>
  </Card>
  {value?.enabled&&<Card><CardHeader><CardTitle>{t("邀请关系与奖励审计","Referral attribution & awards")}</CardTitle></CardHeader>
   <CardContent className="space-y-3">
    <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setOffset(0);setFilter(query.trim());}}>
      <Input aria-label={t("精确搜索用户 ID 或邮箱","Exact user ID or email")} placeholder={t("精确搜索用户 ID 或邮箱","Exact user ID or email")} value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} className="min-w-48 flex-1"/>
      <Button type="submit" variant="outline">{t("搜索","Search")}</Button>
    </form>
    <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={t("邀请奖励列表","Referral list")}>
      <table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground">
       <th className="p-2">{t("邀请人","Inviter")}</th><th className="p-2">{t("受邀用户","Invitee")}</th><th className="p-2">{t("状态","Status")}</th><th className="p-2">{t("注册时间","Registered")}</th><th className="p-2">{t("奖励","Reward")}</th>
      </tr></thead><tbody>{(value.items||[]).map(row=><tr className="border-b" key={row.invited_user_id}>
       <td className="p-2 break-all">{row.inviter_email}</td><td className="p-2 break-all">{row.invited_email}</td>
       <td className="p-2">{row.status==="rewarded"?t("已奖励","Rewarded"):t("待激活","Pending")}</td>
       <td className="p-2">{new Date(row.registered_at).toLocaleString(language==="zh"?"zh-CN":"en-US")}</td>
       <td className="p-2">{row.status==="rewarded"?"+50 / +50":"—"}</td>
      </tr>)}</tbody></table>
    </div>
    {!loading&&!value.items?.length&&<p className="text-sm text-muted-foreground">{t("当前范围暂无邀请数据。","No referrals in this range.")}</p>}
    <div className="flex items-center justify-between"><Button variant="outline" size="sm" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-50))}>{t("上一页","Previous")}</Button>
      <span className="text-xs text-muted-foreground">{offset+1}–{offset+(value.items?.length||0)}</span>
      <Button variant="outline" size="sm" disabled={loading||(value.items?.length||0)<50||offset>=4950} onClick={()=>setOffset(offset+50)}>{t("下一页","Next")}</Button></div>
   </CardContent>
  </Card>}
 </section>;
}
