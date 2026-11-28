import {useEffect,useState,type ReactNode} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Badge} from "../ui/badge";
import PartnerManualReport from "./PartnerManualReport";
import PartnerPayoutProfile from "./PartnerPayoutProfile";
import {Card,CardContent} from "../ui/card";

type Policy={status:"active"|"paused";level:"standard"|"advanced"|"strategic";rate_bps:number;term_months:number|null;effective_at:number};
type Result={enabled:boolean;policy?:Policy|null;payoutProfileEnabled?:boolean;applicationsEnabled?:boolean};

export function usePartnerMembership(owner:string){
 const [result,setResult]=useState<Result|null>(null);
 useEffect(()=>{
  let live=true;setResult(null);
  void api<Result>("/v1/partners/me").then(value=>{if(live)setResult(value);})
   .catch(()=>{if(live)setResult(null);});
  return()=>{live=false;};
 },[owner]);
 return result;
}

export default function PartnerMembershipCard({language,owner}:{language:Language;owner:string}){
 const result=usePartnerMembership(owner);
 if(!result?.enabled||!result.policy)return null;
 return <Card className="border-primary/25"><CardContent className="pt-4"><PartnerMembershipContent language={language} owner={owner} result={result}/></CardContent></Card>;
}

export function PartnerMembershipContent({language,owner,result,inviteRecords}:{language:Language;owner:string;result:Result|null;inviteRecords?:ReactNode}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 if(!result?.enabled||!result.policy)return null;
 const p=result.policy;
 const levels={standard:t("普通","Standard"),advanced:t("高级","Advanced"),strategic:t("战略","Strategic")};
 return <section data-testid="partner-membership" className="space-y-3 border-t pt-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h3 className="font-semibold">{t("推广伙伴","Partner membership")}</h3>
   <Badge variant="outline">{levels[p.level]} · {p.rate_bps/100}% · {p.status==="active"?t("已授权","Authorized"):t("已暂停","Paused")}</Badge>
  </div>
  <div className="space-y-3">
   <p className="text-xs text-muted-foreground">{t("约定合作期限","Configured term")}：{p.term_months===null?t("不限期","Unlimited"):t(p.term_months+" 个月",p.term_months+" months")}</p>
   <p className="text-xs text-muted-foreground">{t("使用原有邀请链接，系统自动核实符合条件的订单，管理员人工转账。","Use your existing invite link. Qualifying purchases are verified automatically; the administrator transfers manually.")}</p>
   <PartnerManualReport key={owner} language={language} owner={owner} inviteRecords={inviteRecords} payoutContent={result.payoutProfileEnabled?<PartnerPayoutProfile key={owner+":recipient"} language={language}/>:undefined}/>
  </div>
 </section>;
}
