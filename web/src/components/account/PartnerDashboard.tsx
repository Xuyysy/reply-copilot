import {useEffect,useRef,useState} from "react";
import {api,ApiError} from "../../lib/api";
import {phrase,useLanguage} from "../../lib/language";
import ReferralAndPartnerCards from "./ReferralAndPartnerCards";
import {Button} from "../ui/button";
import {Card,CardContent} from "../ui/card";

type State={kind:"loading"|"guest"|"error"}|{kind:"ready";owner:string};
export default function PartnerDashboard(){
 const language=useLanguage(),t=(zh:string,en:string)=>phrase(language,zh,en);
 const [state,setState]=useState<State>({kind:"loading"}),[revision,setRevision]=useState(0);
 const request=useRef(0);
 useEffect(()=>{
  let active=true;const load=async()=>{
   const id=++request.current;setState({kind:"loading"});
   try{const result=await api<{user:{userId:string}}>("/v1/me");if(active&&id===request.current)setState(typeof result.user?.userId==="string"&&result.user.userId?{kind:"ready",owner:result.user.userId}:{kind:"error"});}
   catch(e){if(active&&id===request.current)setState({kind:e instanceof ApiError&&e.status===401?"guest":"error"});}
  };
  const restore=(event:PageTransitionEvent)=>{if(event.persisted)void load();};
  void load();window.addEventListener("pageshow",restore);
  return()=>{active=false;window.removeEventListener("pageshow",restore);};
 },[revision]);
 return <div className="space-y-5" data-testid="partners-dashboard">
  <header className="space-y-2"><p className="text-sm font-semibold text-primary">{t("推广中心","REFERRAL CENTER")}</p><h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("推广合伙人","Partners")}</h1><p className="text-sm text-muted-foreground">{t("分享你认可的产品，管理邀请奖励与合作收益。","Share a product you believe in, and manage your referral rewards and partner earnings.")}</p></header>
  {state.kind==="loading"&&<p role="status">{t("正在确认账户…","Checking your account…")}</p>}
  {state.kind==="error"&&<Card><CardContent className="space-y-3 p-5"><p role="alert">{t("暂时无法确认账户状态，请重试。","Unable to confirm your account. Please retry.")}</p><Button type="button" onClick={()=>setRevision(n=>n+1)}>{t("重试","Retry")}</Button></CardContent></Card>}
  {state.kind==="guest"&&<Card className="border-primary/25"><CardContent className="space-y-4 p-5 sm:p-7"><h2 className="text-xl font-semibold">{t("让你的影响力带来额外收入","Turn your audience into extra income")}</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="rounded-lg border bg-muted/30 p-4"><strong className="text-3xl text-emerald-600">15%+</strong><p className="text-sm">{t("审核通过后按约定获得符合条件订单的佣金","Approved partners earn the agreed commission on qualifying purchases")}</p></div><div className="rounded-lg border bg-muted/30 p-4"><strong className="text-3xl">{t("250 次","250 replies")}</strong><p className="text-sm">{t("粉丝完成邀请激活条件后可获得的总免费额度","Total free credits for referred users who meet activation requirements")}</p></div></div><p className="text-sm text-muted-foreground">{t("保持原有创作节奏。登录后查看邀请奖励及合伙人申请是否开放，现金佣金需经人工审核开通。","Keep your usual posting routine. Sign in to check referral and application availability. Cash commissions require administrator approval.")}</p><div className="flex flex-wrap gap-3"><Button asChild><a href="/login?mode=login&next=partners">{t("登录后申请","Sign in to apply")}</a></Button><Button asChild variant="outline"><a href="/login?mode=register&next=partners">{t("注册账户","Create an account")}</a></Button></div></CardContent></Card>}
  {state.kind==="ready"&&<ReferralAndPartnerCards key={state.owner} owner={state.owner} language={language}/>}
 </div>;
}
