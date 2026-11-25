import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
type Row={id:string;amount_fen:number;account_mask:string;name_mask:string;settlement_status:string;created_at:number};
type Result={enabled:boolean;requests?:Row[];pilotReview?:boolean;pilotReconcile?:boolean};
type ReviewResult={ok:boolean;state:string;recipient?:{account:string;name:string};amountFen?:number};
const endpoint="/v1/admin/partners/alipay-requests";
export default function PartnerRequestsPanel({language,write}:{language:Language;write:<T>(path:string,body:object)=>Promise<T>}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [q,setQ]=useState(""),[value,setValue]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[reason,setReason]=useState("");
 const lock=useRef(false);
 const [reviewed,setReviewed]=useState(false),[reference,setReference]=useState(""),[confirmedAmount,setConfirmedAmount]=useState("");
 const [reveal,setReveal]=useState<ReviewResult|null>(null);
 useEffect(()=>{if(!reveal)return;const timer=setTimeout(()=>setReveal(null),60000);return()=>clearTimeout(timer);},[reveal]);
 async function review(row:Row,action:"approve"|"start"|"paid"|"no_transfer"){
  if(lock.current||!reviewed||reason.trim().length<8)return;
  const amount=/^\d{1,10}(\.\d{1,2})?$/.test(confirmedAmount)?Math.round(Number(confirmedAmount)*100):0;
  if(action==="paid"&&(!reference.trim()||amount!==row.amount_fen))return;
  if(!window.confirm(t("仅限测试环境模拟结算。请确认已核对证据，不能进行真实转账。","Test environment simulation only. Confirm evidence; do not transfer real funds.")))return;
  lock.current=true;setBusy(true);setError("");setReveal(null);
  try{
   const result=await write<ReviewResult>("/v1/admin/partners/payout-review",{requestId:row.id,action,reviewed:true,reason:reason.trim(),...(action==="paid"?{amountFen:amount,reference:reference.trim()}:action==="no_transfer"?{amountFen:0,reference:null}:{})});
   if(result.recipient)setReveal(result);
   setReason("");setReviewed(false);setReference("");setConfirmedAmount("");
   setValue(await api<Result>(endpoint+"?q="+encodeURIComponent(q.trim())));
  }catch(e){setValue(null);setReveal(null);setError(readableError(e,language)+" "+t("请重新查询，若转账结果不明，不得再次付款。","Reload; never repeat a transfer with an unknown outcome."));}
  finally{lock.current=false;setBusy(false);}
 }
 async function load(){
  if(lock.current||!q.trim())return;lock.current=true;setBusy(true);setValue(null);setReveal(null);setReviewed(false);setError("");
  try{setValue(await api<Result>(endpoint+"?q="+encodeURIComponent(q.trim())));}catch(e){setError(readableError(e,language));}
  finally{lock.current=false;setBusy(false);}
 }
 async function reject(id:string){
  if(lock.current||reason.trim().length<8)return;
  lock.current=true;setBusy(true);setError("");
  try{await write(endpoint,{requestId:id,action:"reject",reason:reason.trim()});setReason("");setValue(await api<Result>(endpoint+"?q="+encodeURIComponent(q.trim())));}
  catch(e){setValue(null);setError(readableError(e,language)+" "+t("请重新查询。","Reload to confirm."));}
  finally{lock.current=false;setBusy(false);}
 }
 const labels:Record<string,string>={pending:t("待审核","Pending"),rejected:t("已拒绝","Rejected"),reserved:t("已预留","Reserved"),reconciling:t("待核对","Reconciling"),paid:t("已结算","Paid"),cancelled:t("已取消","Cancelled"),approved:t("已审核","Approved")};
 return <Card><CardHeader><CardTitle>{t("支付宝结算申请","Alipay settlement requests")}</CardTitle></CardHeader><CardContent className="space-y-3">
 <p className="text-sm text-muted-foreground">{t("生产环境仅支持查询和拒绝；测试环境可在独立开关下模拟完整结算。","Production supports search/reject only; separate test gates allow simulated settlement.")}</p>
 <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void load();}}><Input aria-label={t("推广伙伴用户 ID","Partner user ID")} value={q} disabled={busy} maxLength={80} onChange={e=>{setQ(e.target.value);setValue(null);setReason("");setReveal(null);setReviewed(false);}} required/><Button disabled={busy||!q.trim()}>{t("查询","Search")}</Button></form>
 {value?.enabled===false&&<p>{t("功能未启用。","Not enabled.")}</p>}
 {value?.enabled&&<label className="block text-sm">{t("审核原因（至少 8 字）","Review reason (at least 8 characters)")}<Input value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>}
 {(value?.pilotReview||value?.pilotReconcile)&&<div className="space-y-2 rounded border p-3">
 <p className="text-sm font-medium">{t("仅测试环境 · 不进行真实转账","Test environment only · no real transfer")}</p>
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>{t("已人工核对相应订单与转账证据","Manually checked relevant order and transfer evidence")}</label>
 <label className="block text-sm">{t("确认金额（元，仅付款确认）","Confirmed amount (CNY, paid only)")}<Input value={confirmedAmount} disabled={busy} onChange={e=>setConfirmedAmount(e.target.value)} inputMode="decimal"/></label>
 <label className="block text-sm">{t("模拟转账流水号","Simulated transfer reference")}<Input value={reference} disabled={busy} onChange={e=>setReference(e.target.value)} maxLength={160}/></label>
 </div>}
 {reveal?.recipient&&<div className="space-y-1 rounded border p-3 text-sm"><p>{t("本次锁定收款对象，仅显示 60 秒","Locked destination, displayed for 60 seconds")}</p><p>{reveal.recipient.account}</p><p>{reveal.recipient.name}</p><p>{t("金额","Amount")}: {(reveal.amountFen||0)/100}</p><Button type="button" variant="outline" onClick={()=>setReveal(null)}>{t("隐藏","Hide")}</Button></div>}
 {value?.requests?.map(r=><div key={r.id} className="space-y-1 rounded border p-3 text-sm"><p>{new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(r.amount_fen/100)} · {labels[r.settlement_status]||r.settlement_status}</p><p>{r.account_mask} · {r.name_mask}</p><p className="break-all text-xs">{r.id}</p>{r.settlement_status==="pending"&&<Button type="button" variant="outline" disabled={busy||reason.trim().length<8} onClick={()=>void reject(r.id)}>{t("拒绝申请","Reject request")}</Button>}{value.pilotReview&&r.settlement_status==="pending"&&<Button type="button" disabled={busy||!reviewed||reason.trim().length<8} onClick={()=>void review(r,"approve")}>{t("模拟批准并预留","Simulate approval")}</Button>}{value.pilotReview&&r.settlement_status==="reserved"&&<Button type="button" disabled={busy||!reviewed||reason.trim().length<8} onClick={()=>void review(r,"start")}>{t("锁定转账并查看账号","Lock and reveal")}</Button>}{value.pilotReconcile&&r.settlement_status==="reconciling"&&<div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||!reviewed||reason.trim().length<8||!reference.trim()} onClick={()=>void review(r,"paid")}>{t("确认模拟付款","Confirm simulated payment")}</Button><Button type="button" variant="outline" disabled={busy||!reviewed||reason.trim().length<8} onClick={()=>void review(r,"no_transfer")}>{t("确认未转账","Confirm no transfer")}</Button></div>}</div>)}
 {error&&<p role="alert">{error}</p>}
 </CardContent></Card>;
}
