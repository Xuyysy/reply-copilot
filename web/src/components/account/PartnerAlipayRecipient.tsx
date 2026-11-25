import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";

type Result={enabled:boolean;editable?:boolean;recipient?:{version:number;account_mask:string;name_mask:string;created_at:number}|null};
const endpoint="/v1/partners/alipay-recipient";
export default function PartnerAlipayRecipient({language}:{language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [data,setData]=useState<Result|null>(null);
 const [account,setAccount]=useState("");
 const [name,setName]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const lock=useRef(false);
 const live=useRef(false);
 useEffect(()=>{
  live.current=true;
  return()=>{live.current=false;};
 },[]);
 async function load(){
  if(lock.current)return;
  lock.current=true;setBusy(true);setData(null);setError("");setNotice("");
  try{const value=await api<Result>(endpoint);if(live.current)setData(value);}
  catch(e){if(live.current)setError(readableError(e,language));}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function save(){
  if(lock.current||!data?.enabled||!data.editable||!account.trim()||!name.trim())return;
  lock.current=true;setBusy(true);setError("");setNotice("");
  try{
   const value=await api<Result>(endpoint,{method:"POST",body:JSON.stringify({account:account.trim(),name:name.trim(),expectedVersion:data.recipient?.version??0})});
   if(live.current){setData(value);setNotice(t("收款信息已保存。","Receiving details saved."));}
  }catch(e){
   if(live.current){setData(null);setError(readableError(e,language)+" "+t("请重新查询确认结果。","Reload to confirm the result."));}
  }finally{lock.current=false;if(live.current){setAccount("");setName("");setBusy(false);}}
 }
 return <section className="space-y-3 rounded border p-3">
 <h3 className="font-medium">{t("支付宝收款信息","Alipay receiving details")}</h3>
 {!data&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void load()}>{t("查看或设置收款信息","View or set receiving details")}</Button>}
 {data?.enabled===false&&<p className="text-sm text-muted-foreground">{t("支付宝收款信息功能暂未开放。","Alipay receiving details are not enabled yet.")}</p>}
 {data?.recipient&&<p className="text-sm">{data.recipient.account_mask} · {data.recipient.name_mask} · v{data.recipient.version}</p>}
 {data?.enabled&&data.editable&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}} autoComplete="off">
 <p className="text-xs text-muted-foreground">{t("仅填写收款账号与实名认证姓名；不要填写支付密码或验证码。修改不会影响既有结算申请。","Enter the receiving account and verified holder name only. Never enter a password or verification code. Changes do not affect existing settlement requests.")}</p>
 <label className="block text-sm">{t("支付宝账号（手机号或邮箱）","Alipay account (phone or email)")}<Input value={account} onChange={e=>setAccount(e.target.value)} disabled={busy} required maxLength={120} autoComplete="off"/></label>
 <label className="block text-sm">{t("收款人真实姓名","Account holder name")}<Input value={name} onChange={e=>setName(e.target.value)} disabled={busy} required maxLength={120} autoComplete="off"/></label>
 <Button disabled={busy||!account.trim()||!name.trim()}>{t("加密保存收款信息","Save encrypted receiving details")}</Button>
 </form>}
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 {notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
 <p className="text-xs text-muted-foreground">{t("收款账号保存不代表已核实实名认证，也不会自动发起转账。","Saving a receiving account does not verify identity or initiate payment.")}</p>
 </section>;
}
