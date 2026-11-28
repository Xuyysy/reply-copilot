import {useRef,useState} from "react";
import {api,ApiError} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
type Entry={id:string;partner_user_id:string;email:string;amount_fen:number;created_at:number;recipient_available?:number};
export default function PartnerManualQueue({language,write}:{language:Language;write:<T>(path:string,body:object)=>Promise<T>}){
 const t=(zh:string,en:string)=>phrase(language,zh,en),endpoint="/v1/admin/partners/manual-report";
 const [data,setData]=useState<{enabled:boolean;queue?:Entry[];payoutProfileEnabled?:boolean;ledgerEnabled?:boolean}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [selected,setSelected]=useState<Entry|null>(null),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [recipient,setRecipient]=useState<{name:string;account:string}|null>(null),[settlementReady,setSettlementReady]=useState(false);
 const lock=useRef(false);
 const money=(n:number)=>new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(n/100);
 async function refresh(){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError("");
  try{setData(await api(endpoint));setSelected(null);setRecipient(null);setConfirmed(false);setReason("");setSettlementReady(false);}
  catch(e){setData(null);setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function check(entry:Entry){
  const r=await api<{settlementReady:boolean|null}>(endpoint+"?requestId="+encodeURIComponent(entry.id));
  setSettlementReady(r.settlementReady===true);
  if(r.settlementReady!==true)setError(t("佣金尚未核实或申请金额已变化，请勿转账。","Commission is not verified or the amount changed. Do not transfer."));
 }
 async function handle(entry:Entry){
  if(lock.current)return;
  setSelected(entry);setRecipient(null);setReason("");setConfirmed(false);setSettlementReady(false);setError("");
  if(!data?.ledgerEnabled||data.payoutProfileEnabled)return;
  lock.current=true;setBusy(true);
  try{await check(entry);}catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function syncSelected(){
  if(!selected||lock.current)return;
  lock.current=true;setBusy(true);setRecipient(null);setConfirmed(false);setSettlementReady(false);setError("");
  try{await write(endpoint,{sync:true,userId:selected.partner_user_id});await check(selected);}
  catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function reveal(){
  if(lock.current||!selected||!selected.recipient_available)return;
  lock.current=true;setBusy(true);setError("");setRecipient(null);setConfirmed(false);setSettlementReady(false);
  try{
   const open=()=>write<{profile:{name:string;account:string}}>("/v1/admin/partners/payout",{userId:selected.partner_user_id,requestId:selected.id,forSettlement:true,reason:"Verify recipient for manual settlement"});
   let r;
   try{r=await open();}catch(e){
    // Normal requests need no extra sync. Only a definite ledger-readiness
    // rejection may trigger one bounded batch, followed by a fresh server check.
    if(!data?.ledgerEnabled||!(e instanceof ApiError)||e.code!=="PARTNER_SETTLEMENT_CHANGED")throw e;
    await write(endpoint,{sync:true,userId:selected.partner_user_id});
    r=await open();
   }
   setRecipient(r.profile);setSettlementReady(true);
  }
  catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function resolve(action:"completed"|"rejected"){
  if(lock.current||!selected||reason.trim().length<8||(action==="completed"&&(!confirmed||(data?.payoutProfileEnabled&&!recipient)||(data?.ledgerEnabled&&!settlementReady))))return;
  lock.current=true;setBusy(true);setError("");
  try{await write(endpoint,{requestId:selected.id,action,reason:reason.trim()});setSelected(null);setRecipient(null);setConfirmed(false);setReason("");setData(await api(endpoint));}
  catch(e){setError(readableError(e,language)+" "+t("请刷新确认状态，不要重复转账。","Refresh to confirm status. Do not transfer twice."));setData(null);setSelected(null);setRecipient(null);setConfirmed(false);}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-3 rounded-lg border p-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("待处理结算申请","Pending settlement requests")}</h3><Button type="button" variant="outline" disabled={busy} onClick={()=>void refresh()}>{t("查看申请","View requests")}</Button></div>
  <p className="text-xs text-muted-foreground">{t("系统自动核实订单。确认本次收款资料及金额，线下完成转账后才标记已结算，请勿重复转账。","Orders are verified automatically. Confirm the recipient and amount, then mark settled after the external transfer. Do not transfer twice.")}</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {data?.enabled===false&&<p>{t("暂未开放。","Not enabled.")}</p>}
  {data?.enabled&&(!data.queue?.length?<p>{t("暂无待处理申请。","No pending requests.")}</p>:data.queue.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"><div className="break-all">{r.email} · {money(r.amount_fen)}<p className="text-xs">{r.partner_user_id} · {new Date(r.created_at).toLocaleString()}</p></div><Button type="button" variant="outline" disabled={busy} onClick={()=>void handle(r)}>{t("处理","Handle")}</Button></div>))}
  {selected&&<div className="space-y-2 rounded border p-3">
   <p className="font-medium break-all">{selected.email} · {money(selected.amount_fen)}</p>
   {data?.payoutProfileEnabled&&(selected.recipient_available?<div className="space-y-2 rounded bg-muted/40 p-2">{recipient?<div className="space-y-1 break-all"><p>{t("支付宝账号","Alipay account")}：{recipient.account}</p><p>{t("收款人","Recipient")}：{recipient.name}</p><Button type="button" variant="outline" onClick={()=>{setRecipient(null);setConfirmed(false);}}>{t("隐藏收款资料","Hide recipient")}</Button></div>:<Button type="button" variant="outline" disabled={busy} onClick={()=>void reveal()}>{t("验证身份并查看本次收款资料","Verify and reveal this recipient")}</Button>}</div>:<p className="text-sm text-amber-700">{t("该历史申请缺少收款资料快照，请核对后驳回并让合伙人重新申请。","Legacy request has no recipient snapshot. Review, reject and ask the partner to reapply.")}</p>)}
   {data?.ledgerEnabled&&!data.payoutProfileEnabled&&!settlementReady&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void syncSelected()}>{t("重新核实佣金","Recheck commission")}</Button>}
   <Input aria-label={t("处理备注","Resolution note")} placeholder={t("备注，至少8字","Note, at least 8 characters")} value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)}/>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t("我已核对金额，并在线下完成该笔转账。","I verified the amount and completed this transfer outside the system.")}</label>
   <p className="text-xs text-muted-foreground" role="status">{[data?.payoutProfileEnabled&&!recipient?t("请先验证并查看本次收款资料","Verify and reveal this recipient first"):"",data?.ledgerEnabled&&!settlementReady?t("佣金尚未通过复核","Commission not verified yet"):"",reason.trim().length<8?t("处理备注至少8个字符","Note requires 8 characters"):"",!confirmed?t("实际转账完成后勾选确认","Confirm only after the actual transfer"):""].filter(Boolean).join(" · ")}</p>
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||!confirmed||reason.trim().length<8||Boolean(data?.payoutProfileEnabled&&!recipient)||Boolean(data?.ledgerEnabled&&!settlementReady)} onClick={()=>void resolve("completed")}>{t("标记已结算","Mark settled")}</Button><Button type="button" variant="outline" disabled={busy||reason.trim().length<8} onClick={()=>void resolve("rejected")}>{t("拒绝","Reject")}</Button></div>
  </div>}
 </section>;
}
