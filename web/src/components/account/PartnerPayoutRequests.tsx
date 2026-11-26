import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
type Row={id:string;amount_fen:number;account_mask:string;name_mask:string;settlement_status:string;created_at:number};
type Result={enabled:boolean;accepting?:boolean;minFen?:number|null;recipient?:{version:number;account_mask:string;name_mask:string}|null;requests?:Row[]};
const endpoint="/v1/partners/alipay-requests";
export default function PartnerPayoutRequests({language}:{language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [data,setData]=useState<Result|null>(null),[amount,setAmount]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const lock=useRef(false),live=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const money=(fen:number)=>new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(fen/100);
 const fen=/^\d{1,10}(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0;
 const labels:Record<string,string>={pending:t("待审核","Pending review"),rejected:t("已拒绝","Rejected"),reserved:t("已预留","Reserved"),reconciling:t("转账结果待核实","Transfer reconciliation"),paid:t("已结算","Paid"),cancelled:t("已取消","Cancelled"),approved:t("已审核","Approved")};
 async function load(){
  if(lock.current)return;lock.current=true;setBusy(true);setData(null);setError("");setNotice("");
  try{const v=await api<Result>(endpoint);if(live.current)setData(v);}catch(e){if(live.current)setError(readableError(e,language));}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function submit(){
  if(lock.current||!data?.accepting||!data.recipient||!data.minFen||fen<data.minFen)return;
  lock.current=true;setBusy(true);setError("");setNotice("");
  try{
   await api(endpoint,{method:"POST",body:JSON.stringify({amountFen:fen,recipientVersion:data.recipient.version})});
   if(live.current){setAmount("");setNotice(t("申请已提交，等待人工审核。","Request submitted for manual review."));}
   const v=await api<Result>(endpoint);if(live.current)setData(v);
  }catch(e){if(live.current){setData(null);setError(readableError(e,language)+" "+t("请重新查询确认结果。","Reload to confirm the result."));}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const open=data?.requests?.some(r=>["pending","reserved","reconciling","approved"].includes(r.settlement_status));
 return <section className="space-y-3 rounded border p-3"><h3 className="font-medium">{t("支付宝结算申请","Alipay settlement requests")}</h3>
 <Button type="button" variant="outline" disabled={busy} onClick={()=>void load()}>{t("查询申请记录","Load requests")}</Button>
 {data&&!data.accepting&&<p className="text-sm text-muted-foreground">{t("结算申请暂未开放。","Settlement requests are not open yet.")}</p>}
 {data?.accepting&&!data.recipient&&<p>{t("请先设置支付宝收款信息，再刷新此处。","Set your Alipay receiving details, then reload.")}</p>}
 {data?.accepting&&data.recipient&&!open&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void submit();}}>
 <p>{t("本次收款对象","Destination")}: {data.recipient.account_mask} · {data.recipient.name_mask}</p>
 <p>{t("最低申请金额","Minimum request")}: {money(data.minFen||0)}</p>
 <label className="block text-sm">{t("金额（人民币元）","Amount (CNY)")}<Input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" maxLength={13} disabled={busy} required/></label>
 <Button disabled={busy||!data.minFen||fen<data.minFen}>{t("提交审核申请","Submit for review")}</Button>
 <p className="text-xs text-muted-foreground">{t("申请不代表付款批准，审核通过后才预留佣金。","A request is not a payment approval; funds are reserved only after review.")}</p></form>}
 {data?.requests?.map(r=><div key={r.id} className="rounded border p-2 text-sm">{money(r.amount_fen)} · {labels[r.settlement_status]||r.settlement_status}<p>{r.account_mask} · {r.name_mask} · {new Date(r.created_at).toLocaleString()}</p></div>)}
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</section>;
}
