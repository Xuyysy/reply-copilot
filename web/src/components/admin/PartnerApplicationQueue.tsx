import {useEffect,useState,useRef} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
export type Application={id:string;user_id:string;x_handle:string;email:string;status:"pending"|"approved"|"rejected";created_at:number;reviewed_at:number|null};
type Result={enabled:boolean;items?:Application[];offset?:number;hasMore?:boolean};
export default function PartnerApplicationQueue({language,write,onReview,refreshKey,parentBusy}:{language:Language;write:<T>(path:string,body:object)=>Promise<T>;onReview:(r:Application)=>void;refreshKey:number;parentBusy:boolean}){
 const t=(zh:string,en:string)=>phrase(language,zh,en),endpoint="/v1/admin/partners/applications";
 const [data,setData]=useState<Result|null>(null),[status,setStatus]=useState("pending"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[reject,setReject]=useState<Application|null>(null),[reason,setReason]=useState("");
 const lock=useRef(false),opened=useRef(false);
 async function load(offset=0,filter=status){
  if(lock.current)return;opened.current=true;lock.current=true;setBusy(true);setError("");setReject(null);setStatus(filter);
  try{setData(await api<Result>(endpoint+"?status="+filter+"&offset="+offset));}catch(e){setData(null);setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 useEffect(()=>{if(opened.current)void load(0);},[refreshKey]);
 async function decline(){
  if(parentBusy||lock.current||!reject||reason.trim().length<8)return;lock.current=true;setBusy(true);setError("");
  try{await write(endpoint,{applicationId:reject.id,action:"rejected",reason:reason.trim()});setData(await api<Result>(endpoint+"?status="+status+"&offset=0"));setReject(null);setReason("");}catch(e){setError(readableError(e,language));setData(null);setReject(null);}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-2 rounded-lg border p-3" data-testid="partner-applications-queue">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("合伙人申请审核","Partner applications")}</h3><Button type="button" variant="outline" disabled={busy||parentBusy} onClick={()=>void load()}>{t("查看合伙人申请","View partner applications")}</Button></div>
  {data?.enabled===false&&<p className="text-sm">{t("申请功能暂未开启","Applications not enabled")}</p>}
  {data?.enabled&&<><div className="flex gap-2 flex-wrap">{["pending","approved","rejected"].map(s=><Button key={s} type="button" variant={status===s?"default":"outline"} disabled={busy||parentBusy} onClick={()=>void load(0,s)}>{s==="pending"?t("待审核","Pending"):s==="approved"?t("已通过","Approved"):t("已拒绝","Rejected")}</Button>)}</div>
   {data.items?.length?data.items.map(r=><div key={r.id} className="space-y-1 rounded border p-2 text-sm break-all"><p>{r.email} · <a className="underline text-primary" href={"https://x.com/"+r.x_handle} target="_blank" rel="noopener noreferrer">@{r.x_handle}</a></p><p>{new Date(r.created_at).toLocaleString()} · {t("用户自填，未验证所有权","Self-reported; ownership unverified")}</p>{r.status==="pending"&&<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||parentBusy} onClick={()=>onReview(r)}>{t("审核并设置规则","Review and set terms")}</Button><Button type="button" variant="outline" disabled={busy||parentBusy} onClick={()=>{setReject(r);setReason("");}}>{t("拒绝申请","Decline application")}</Button></div>}</div>):<p className="text-sm">{t("暂无申请","No applications")}</p>}
   <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy||parentBusy||!(data.offset??0)} onClick={()=>void load(Math.max(0,(data.offset??0)-30))}>{t("上一页","Previous")}</Button><Button type="button" variant="outline" disabled={busy||parentBusy||!data.hasMore} onClick={()=>void load((data.offset??0)+30)}>{t("下一页","Next")}</Button></div>
  </>}
  {reject&&<div className="space-y-2"><p>{t("拒绝申请","Decline application")} @{reject.x_handle}</p><Input aria-label={t("拒绝原因","Decline reason")} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} disabled={busy||parentBusy}/><Button type="button" disabled={busy||parentBusy||reason.trim().length<8} onClick={()=>void decline()}>{t("确认拒绝","Confirm decline")}</Button><Button type="button" variant="outline" disabled={busy||parentBusy} onClick={()=>setReject(null)}>{t("取消","Cancel")}</Button></div>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
