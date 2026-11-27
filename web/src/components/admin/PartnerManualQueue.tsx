import {useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
type Entry={id:string;partner_user_id:string;email:string;amount_fen:number;created_at:number};
export default function PartnerManualQueue({language,write}:{language:Language;write:<T>(path:string,body:object)=>Promise<T>}){
 const t=(zh:string,en:string)=>phrase(language,zh,en),endpoint="/v1/admin/partners/manual-report";
 const [data,setData]=useState<{enabled:boolean;queue?:Entry[]}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [selected,setSelected]=useState<Entry|null>(null),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 const lock=useRef(false);
 const money=(n:number)=>new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(n/100);
 async function refresh(){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError("");
  try{setData(await api(endpoint));setSelected(null);setConfirmed(false);setReason("");}
  catch(e){setData(null);setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function resolve(action:"completed"|"rejected"){
  if(lock.current||!selected||reason.trim().length<8||(action==="completed"&&!confirmed))return;
  lock.current=true;setBusy(true);setError("");
  try{await write(endpoint,{requestId:selected.id,action,reason:reason.trim()});setSelected(null);setConfirmed(false);setReason("");setData(await api(endpoint));}
  catch(e){setError(readableError(e,language)+" "+t("请刷新确认状态，不要重复转账。","Refresh to confirm status. Do not transfer twice."));setData(null);setSelected(null);setConfirmed(false);}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-3 rounded-lg border p-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("待处理结算申请","Pending settlement requests")}</h3><Button type="button" variant="outline" disabled={busy} onClick={()=>void refresh()}>{t("查看申请","View requests")}</Button></div>
  <p className="text-xs text-muted-foreground">{t("先核对伙伴订单及实际金额，线下转账后才标记已结算。系统不会执行转账。","Verify the partner's orders and actual amount first. Mark settled only after external transfer. No transfer is executed by this system.")}</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {data?.enabled===false&&<p>{t("暂未开放。","Not enabled.")}</p>}
  {data?.enabled&&(!data.queue?.length?<p>{t("暂无待处理申请。","No pending requests.")}</p>:data.queue.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"><div className="break-all">{r.email} · {money(r.amount_fen)}<p className="text-xs">{r.partner_user_id} · {new Date(r.created_at).toLocaleString()}</p></div><Button type="button" variant="outline" disabled={busy} onClick={()=>{setSelected(r);setReason("");setConfirmed(false);}}>{t("处理","Handle")}</Button></div>))}
  {selected&&<div className="space-y-2 rounded border p-3">
   <p className="font-medium break-all">{selected.email} · {money(selected.amount_fen)}</p>
   <Input aria-label={t("处理备注","Resolution note")} placeholder={t("备注，至少8字","Note, at least 8 characters")} value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)}/>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t("我已核对金额，并在线下完成该笔转账。","I verified the amount and completed this transfer outside the system.")}</label>
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||!confirmed||reason.trim().length<8} onClick={()=>void resolve("completed")}>{t("标记已结算","Mark settled")}</Button><Button type="button" variant="outline" disabled={busy||reason.trim().length<8} onClick={()=>void resolve("rejected")}>{t("拒绝","Reject")}</Button></div>
  </div>}
 </section>;
}
