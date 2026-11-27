import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";

type Report={enabled:boolean;summary?:{verifiedOrders:number;reviewCount:number;estimatedFen:number|null;recordedFen:number;differenceFen:number|null;complete:boolean};
 orders?:{domain:string;orderId:string;buyerId?:string;paidAt:number;rateBps:number;state:string;principalFen:number|null;commissionFen:number|null;reason?:string}[];
 records?:{id:string;amount_fen:number;transferred_at:number;external_reference?:string;reason?:string}[]};
type Props={language:Language;owner:string;write?:<T>(path:string,body:object)=>Promise<T>};
export default function PartnerManualReport({language,owner,write}:Props){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const endpoint=write?"/v1/admin/partners/manual-report":"/v1/partners/manual-report";
 const url=endpoint+(write?"?userId="+encodeURIComponent(owner):"");
 const [data,setData]=useState<Report|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false);
 const [amount,setAmount]=useState(""),[date,setDate]=useState(""),[reference,setReference]=useState(""),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 const lock=useRef(false),sequence=useRef(0);
 const money=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(v/100);
 useEffect(()=>()=>{sequence.current++;},[owner]);
 async function refresh(){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError("");setOpened(true);setData(null);const n=++sequence.current;
  try{const result=await api<Report>(url);if(n===sequence.current)setData(result);}
  catch(e){if(n===sequence.current)setError(readableError(e,language));}
  finally{if(n===sequence.current){lock.current=false;setBusy(false);}}
 }
 const amountFen=/^\d{1,10}(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0;
 const transferredAt=date?new Date(date).getTime():NaN;
 const canRecord=!!write&&data?.enabled&&confirmed&&amountFen>0&&Number.isSafeInteger(amountFen)&&Number.isFinite(transferredAt)&&transferredAt<=Date.now()&&/^[A-Za-z0-9_-]{4,80}$/.test(reference.trim())&&reason.trim().length>=8;
 async function record(){
  if(!write||!canRecord||lock.current)return;
  lock.current=true;setBusy(true);setError("");const n=++sequence.current;
  try{await write(endpoint,{userId:owner,amountFen,transferredAt,reference:reference.trim(),reason:reason.trim()});
   if(n!==sequence.current)return;
   setAmount("");setDate("");setReference("");setReason("");setConfirmed(false);
   setData(await api<Report>(url));
  }catch(e){if(n===sequence.current){setError(readableError(e,language)+" "+t("请刷新核对记录，勿重复登记。","Refresh to reconcile; do not record twice."));setData(null);setConfirmed(false);}}
  finally{if(n===sequence.current){lock.current=false;setBusy(false);}}
 }
 const s=data?.summary;
 return <section className="space-y-3 rounded-lg border p-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("推广分成","Referral commission")}</h3><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void refresh()}>{opened?t("刷新","Refresh"):t("查看分成","View commission")}</Button></div>
  {busy&&<p role="status" className="text-sm">{t("读取中…","Loading…")}</p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {data?.enabled===false&&<p className="text-sm">{t("人工分成统计尚未开放。","Manual commission reporting is not enabled.")}</p>}
  {s&&<>
   <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{[[t("已核实订单参考分成","Verified-order estimate"),money(s.estimatedFen)],[t("已登记转账","Recorded transfers"),money(s.recordedFen)],[t("待核对差额","Reconciliation difference"),money(s.differenceFen)]].map(([label,value])=><div key={label} className="rounded bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong>{value}</strong></div>)}</div>
   <p className="text-sm">{t("已核实订单","Verified orders")}: {s.verifiedOrders} · {t("待人工核对","Needs review")}: {s.reviewCount}</p>
   {(!s.complete||s.reviewCount>0)&&<p role="status" className="text-sm text-amber-700">{!s.complete?t("订单超出本次统计上限，累计金额不可用。","Order limit exceeded; lifetime total unavailable."):t("存在退款、风险或证据不完整的订单，差额暂不计算。","Some orders require review; difference is withheld.")}</p>}
   <p className="text-xs text-muted-foreground">{t("仅核算已有人民币支付证据的商品本金，按订单时点规则计算；差额不是可提现余额。退款、非人民币支付或不完整记录需人工核对。","CNY product principal with existing payment evidence only, using policy at order time. Difference is not a withdrawable balance. Refunds, non-CNY payments and incomplete records may need review.")}</p>
   <h4 className="font-medium">{t("最近订单（最多 30 笔）","Recent orders (up to 30)")}</h4>
   {data?.orders?.map(o=><div className="rounded border p-2 text-sm break-all" key={o.domain+":"+o.orderId}>{new Date(o.paidAt).toLocaleString()} · {o.domain==="recharge"?t("次数套餐","Credits"):t("订阅","Subscription")} · {o.state==="verified"?money(o.commissionFen):t("待核对","Review")}<p className="text-xs text-muted-foreground">{o.orderId}{write&&o.buyerId?" · "+o.buyerId:""} · {o.rateBps/100}%{write&&o.reason?" · "+o.reason:""}</p></div>)}
   {!data?.orders?.length&&<p className="text-sm text-muted-foreground">{t("暂无统计订单。","No matching orders.")}</p>}
   <h4 className="font-medium">{t("最近人工转账记录","Recent recorded transfers")}</h4>
   {data?.records?.map(r=><div key={r.id} className="rounded border p-2 text-sm break-all">{new Date(r.transferred_at).toLocaleString()} · {money(r.amount_fen)}{write&&<p className="text-xs">{r.external_reference} · {r.reason}</p>}</div>)}
   {!data?.records?.length&&<p className="text-sm text-muted-foreground">{t("暂无登记记录。","No recorded transfers.")}</p>}
   {write&&<form className="space-y-2 border-t pt-3" onSubmit={e=>{e.preventDefault();void record();}}>
    <h4 className="font-medium">{t("登记已完成的人工转账","Record a completed external transfer")}</h4>
    <p className="text-xs text-muted-foreground">{t("只做记账，不会转账。使用唯一自定义记录编号，勿填写收款凭据。提交后不可直接编辑或删除。","Bookkeeping only; no transfer occurs. Use a unique internal reference, not recipient credentials. Records cannot be edited or deleted.")}</p>
    <label className="block text-sm">{t("人民币金额","CNY amount")}<Input inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setConfirmed(false);}} required disabled={busy}/></label>
    <label className="block text-sm">{t("实际转账时间","Actual transfer time")}<Input type="datetime-local" value={date} onChange={e=>{setDate(e.target.value);setConfirmed(false);}} required disabled={busy}/></label>
    <label className="block text-sm">{t("唯一记录编号","Unique reference")}<Input maxLength={80} value={reference} onChange={e=>{setReference(e.target.value);setConfirmed(false);}} required disabled={busy}/></label>
    <label className="block text-sm">{t("备注（至少 8 字）","Note (at least 8 characters)")}<Input maxLength={500} minLength={8} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} required disabled={busy}/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>{t("我确认该笔转账已在系统外完成。","I confirm the transfer has already been completed outside the system.")}</label>
    <Button disabled={busy||!canRecord}>{t("登记转账记录","Record transfer")}</Button>
   </form>}
  </>}
 </section>;
}
