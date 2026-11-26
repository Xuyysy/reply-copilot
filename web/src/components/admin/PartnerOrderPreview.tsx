import {useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
type Result={enabled:boolean;evidence?:{eligible:boolean;reason:string;principalFen?:number;buyerFen?:number;refundedPrincipalFen?:number;provider?:string;kind?:string};policyEligible?:boolean;candidateFen?:number|null;policyVersion?:number|null};
export default function PartnerOrderPreview({language}:{language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [domain,setDomain]=useState("recharge"),[id,setId]=useState(""),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const lock=useRef(false);
 const money=(fen:number)=>new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(fen/100);
 async function load(){if(lock.current||!id.trim())return;lock.current=true;setBusy(true);setResult(null);setError("");
 try{setResult(await api<Result>("/v1/admin/partners/order-preview?"+new URLSearchParams({domain,id:id.trim()})));}
 catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}}
 const reasons:Record<string,string>={no_fiat_evidence:t("无可核验法币记录","No fiat evidence"),ambiguous_transaction:t("交易关联不唯一","Ambiguous transaction"),unsupported_provider:t("不支持该支付渠道","Unsupported provider"),risk_or_pending_refund:t("风控或退款待核对","Risk or pending refund"),not_paid:t("订单未确认支付","Payment not confirmed"),missing_settlement_proof:t("缺少到账或权益发放证据","Missing settlement proof"),invalid_amount_snapshot:t("金额快照不一致","Invalid amount snapshot"),invalid_subscription_amount:t("订阅金额或类型不一致","Invalid subscription amount"),refund_requires_reconciliation:t("退款需要核对","Refund requires reconciliation")};
 const e=result?.evidence;
 return <Card><CardHeader><CardTitle>{t("订单计佣预览","Order commission preview")}</CardTitle></CardHeader><CardContent className="space-y-3">
 <p className="text-sm text-muted-foreground">{t("仅核对现有订单和历史规则；候选商品本金口径未批准，不记账、不付款。","Read-only order and historical policy checks. Candidate product principal basis not approved; no accrual or payout.")}</p>
 <form className="space-y-2" onSubmit={e=>{e.preventDefault();void load();}}>
 <label className="block text-sm">{t("订单类型","Order type")}<select className="block w-full rounded border p-2" value={domain} disabled={busy} onChange={e=>{setDomain(e.target.value);setResult(null);}}><option value="recharge">{t("次数套餐","Credits")}</option><option value="subscription">{t("订阅","Subscription")}</option></select></label>
 <label className="block text-sm">{t("订单 ID","Order ID")}<Input value={id} disabled={busy} maxLength={80} onChange={e=>{setId(e.target.value);setResult(null);}} required/></label>
 <Button disabled={busy||!id.trim()}>{t("核对订单","Check order")}</Button></form>
 {result?.enabled===false&&<p>{t("订单预览尚未启用。","Order preview not enabled.")}</p>}
 {e&&!e.eligible&&<p>{reasons[e.reason]||t("需要人工核对","Requires manual review")}</p>}
 {e?.eligible&&<div className="space-y-1 rounded border p-3 text-sm"><p>{t("支付渠道","Provider")}: {e.provider} · {e.kind}</p><p>{t("买家支付","Buyer payment")}: {money(e.buyerFen||0)}</p><p>{t("候选本金","Candidate principal")}: {money(e.principalFen||0)}</p><p>{t("本金退款","Principal refunded")}: {money(e.refundedPrincipalFen||0)}</p><p>{t("历史规则","Historical policy")}: {result?.policyEligible?"v"+result.policyVersion:t("不符合","Not eligible")}</p>{result?.candidateFen!=null&&<p className="font-medium">{t("模拟佣金（非入账金额）","Simulated commission (not accrued)")}: {money(result.candidateFen)}</p>}</div>}
 {error&&<p role="alert">{error}</p>}
 </CardContent></Card>;
}
