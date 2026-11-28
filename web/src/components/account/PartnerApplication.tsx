import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
type Result={enabled:boolean;canApply?:boolean;application?:{id:string;x_handle:string;status:"pending"|"approved"|"rejected";created_at:number}|null};
export default function PartnerApplication({language}:{language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en),endpoint="/v1/partners/application";
 const [data,setData]=useState<Result|null>(null),[open,setOpen]=useState(false),[handle,setHandle]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const lock=useRef(false);
 async function reload(){setError("");try{setData(await api<Result>(endpoint));}catch(e){setError(readableError(e,language));}}
 useEffect(()=>{let live=true;void api<Result>(endpoint).then(r=>{if(live)setData(r);}).catch(e=>{if(live)setError(readableError(e,language));});return()=>{live=false;};},[]);
 async function submit(){
  if(lock.current||!/^@?[a-zA-Z0-9_]{1,15}$/.test(handle.trim()))return;
  lock.current=true;setBusy(true);setError("");
  try{setData(await api<Result>(endpoint,{method:"POST",body:JSON.stringify({xHandle:handle.trim()})}));setOpen(false);setHandle("");}
  catch(e){setError(readableError(e,language));try{setData(await api<Result>(endpoint));}catch{}}
  finally{lock.current=false;setBusy(false);}
 }
 const a=data?.application;
 return <div className="space-y-2" data-testid="partner-application">
  {a&&<p role="status" className="text-sm font-medium">@{a.x_handle} · {a.status==="pending"?t("申请待审核","Application pending review"):a.status==="approved"?t("已通过，请刷新页面","Approved; refresh the page"):t("申请未通过","Application declined")}</p>}
  {a?.status==="pending"&&<Button type="button" variant="outline" onClick={()=>void reload()}>{t("刷新审核状态","Refresh application status")}</Button>}
  {data?.enabled&&data.canApply&&a?.status!=="pending"&&a?.status!=="approved"&&(open?<div className="space-y-2">
   <label className="block text-sm">{t("X 账号（必填）","X username (required)")}<Input aria-label={t("X 账号","X username")} placeholder="@username" value={handle} maxLength={16} disabled={busy} onChange={e=>setHandle(e.target.value)}/></label>
   <p className="text-xs text-muted-foreground">{t("填写你自己的 X 用户名，审核通过后才开通现金佣金。","Enter your own X username. Cash commissions are activated only after approval.")}</p>
   <Button type="button" disabled={busy||!/^@?[a-zA-Z0-9_]{1,15}$/.test(handle.trim())} onClick={()=>void submit()}>{t("提交申请","Submit application")}</Button>{" "}<Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>{t("取消","Cancel")}</Button>
  </div>:<Button type="button" onClick={()=>setOpen(true)}>{a?.status==="rejected"?t("重新申请","Apply again"):t("申请成为推广合伙人","Apply to become a partner")}</Button>)}
  {error&&<><p role="alert" className="text-sm text-red-700">{error}</p><Button type="button" variant="outline" disabled={busy} onClick={()=>void reload()}>{t("重试","Retry")}</Button></>}
 </div>;
}
