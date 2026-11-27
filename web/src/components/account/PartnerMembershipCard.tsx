import {useEffect,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Badge} from "../ui/badge";
import PartnerManualReport from "./PartnerManualReport";
import PartnerPayoutProfile from "./PartnerPayoutProfile";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";

type Policy={status:"active"|"paused";level:"standard"|"advanced"|"strategic";rate_bps:number;term_months:number|null;effective_at:number};
type Result={enabled:boolean;policy?:Policy|null;payoutProfileEnabled?:boolean};

export default function PartnerMembershipCard({language,owner}:{language:Language;owner:string}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [result,setResult]=useState<Result|null>(null);
 useEffect(()=>{
  let live=true;setResult(null);
  void api<Result>("/v1/partners/me").then(value=>{if(live)setResult(value);})
   .catch(()=>{if(live)setResult(null);});
  return()=>{live=false;};
 },[owner]);
 // No public eligibility checker, no panel for an unassigned account, and no
 // optimistic visibility while the authenticated server response is pending.
 if(!result?.enabled||!result.policy)return null;
 const p=result.policy;
 const levels={standard:t("普通","Standard"),advanced:t("高级","Advanced"),strategic:t("战略","Strategic")};
 return <Card data-testid="partner-membership" className="border-primary/25">
  <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2">
   {t("推广伙伴","Partner membership")}
   <Badge variant="outline">{p.status==="active"?t("已授权","Authorized"):t("已暂停","Paused")}</Badge>
  </CardTitle></CardHeader>
  <CardContent className="space-y-3">
   <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
    <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{t("合作等级","Partner tier")}</p><strong>{levels[p.level]}</strong></div>
    <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{t("约定佣金比例","Configured commission rate")}</p><strong>{new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{maximumFractionDigits:2}).format(p.rate_bps/100)}%</strong></div>
    <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{t("约定合作期限","Configured term")}</p><strong>{p.term_months===null?t("不限期","Unlimited"):t(p.term_months+" 个月",p.term_months+" months")}</strong></div>
   </div>
   <p className="text-xs text-muted-foreground">{t("使用原有邀请链接，分成由管理员人工核对和转账。","Use your existing invite link. Commission is reviewed and transferred manually by the administrator.")}</p>
   {result.payoutProfileEnabled&&<PartnerPayoutProfile key={owner+":recipient"} language={language}/>}
   <PartnerManualReport key={owner} language={language} owner={owner}/>
  </CardContent>
 </Card>;
}
