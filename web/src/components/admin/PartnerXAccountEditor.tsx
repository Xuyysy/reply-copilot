import {useRef,useState} from "react";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";

type Props={userId:string;handle:string|null;version:number;language:Language;write:<T>(path:string,body:object)=>Promise<T>;onSaved:()=>Promise<void>};
export default function PartnerXAccountEditor({userId,handle,version,language,write,onSaved}:Props){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [editing,setEditing]=useState(false),[value,setValue]=useState(handle??""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const lock=useRef(false);
 const valid=/^@?[a-zA-Z0-9_]{1,15}$/.test(value.trim())&&reason.trim().length>=8;
 async function save(){
  if(lock.current||!valid)return;lock.current=true;setBusy(true);setError("");
  try{await write("/v1/admin/partners/x-account",{userId,xHandle:value.trim(),expectedVersion:version,reason:reason.trim()});await onSaved();setEditing(false);}
  catch(e){setError(readableError(e,language)+" "+t("请刷新列表确认实际状态。","Refresh the directory to confirm the actual state."));}
  finally{lock.current=false;setBusy(false);}
 }
 return <div className="space-y-2 my-2" data-testid="partner-x-account">
  <div className="flex flex-wrap items-center gap-2">{handle&&/^[a-z0-9_]{1,15}$/.test(handle)?<a className="text-primary underline" href={"https://x.com/"+handle} target="_blank" rel="noopener noreferrer">@{handle}</a>:<span className="text-muted-foreground">{t("尚未绑定 X 账号","X account not linked")}</span>}
  {!editing&&<Button type="button" size="sm" variant="outline" onClick={()=>{setValue(handle??"");setReason("");setError("");setEditing(true);}}>{handle?t("修改 X 账号","Edit X account"):t("绑定 X 账号","Link X account")}</Button>}</div>
  {editing&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void save();}}>
   <Input aria-label={t("合伙人 X 用户名","Partner X username")} placeholder="@username" value={value} maxLength={16} disabled={busy} onChange={e=>setValue(e.target.value)} required/>
   <Input aria-label={t("绑定原因","Binding reason")} placeholder={t("操作原因（至少 8 字）","Reason (at least 8 characters)")} value={reason} minLength={8} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)} required/>
   <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy||!valid}>{t("保存 X 账号","Save X account")}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setEditing(false)}>{t("取消","Cancel")}</Button></div>
   {error&&<p role="alert">{error}</p>}
  </form>}
 </div>;
}
