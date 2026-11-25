import {useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
type Row={id:string;amount_fen:number;account_mask:string;name_mask:string;settlement_status:string;created_at:number};
type Result={enabled:boolean;requests?:Row[]};
const endpoint="/v1/admin/partners/alipay-requests";
export default function PartnerRequestsPanel({language,write}:{language:Language;write:<T>(path:string,body:object)=>Promise<T>}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [q,setQ]=useState(""),[value,setValue]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[reason,setReason]=useState("");
 const lock=useRef(false);
 async function load(){
  if(lock.current||!q.trim())return;lock.current=true;setBusy(true);setValue(null);setError("");
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
 <p className="text-sm text-muted-foreground">{t("当前仅支持查询、拒绝申请；付款批准和收款账号解密尚未启用。","Search and reject only; payment approval and recipient reveal are not enabled.")}</p>
 <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void load();}}><Input aria-label={t("推广伙伴用户 ID","Partner user ID")} value={q} disabled={busy} maxLength={80} onChange={e=>{setQ(e.target.value);setValue(null);setReason("");}} required/><Button disabled={busy||!q.trim()}>{t("查询","Search")}</Button></form>
 {value?.enabled===false&&<p>{t("功能未启用。","Not enabled.")}</p>}
 {value?.enabled&&<label className="block text-sm">{t("拒绝原因（至少 8 字）","Rejection reason (at least 8 characters)")}<Input value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>}
 {value?.requests?.map(r=><div key={r.id} className="space-y-1 rounded border p-3 text-sm"><p>{new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(r.amount_fen/100)} · {labels[r.settlement_status]||r.settlement_status}</p><p>{r.account_mask} · {r.name_mask}</p><p className="break-all text-xs">{r.id}</p>{r.settlement_status==="pending"&&<Button type="button" variant="outline" disabled={busy||reason.trim().length<8} onClick={()=>void reject(r.id)}>{t("拒绝申请","Reject request")}</Button>}</div>)}
 {error&&<p role="alert">{error}</p>}
 </CardContent></Card>;
}
