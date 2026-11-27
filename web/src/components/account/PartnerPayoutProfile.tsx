import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
type Profile={enabled:boolean;version:number;locked:boolean;profile:{name:string;account:string}|null};
export default function PartnerPayoutProfile({language}:{language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en),endpoint="/v1/partners/payout";
 const [data,setData]=useState<Profile|null>(null),[name,setName]=useState(""),[account,setAccount]=useState(""),[edit,setEdit]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const lock=useRef(false),seq=useRef(0);
 async function load(){if(lock.current)return;lock.current=true;const n=++seq.current;setBusy(true);setError("");try{const r=await api<Profile>(endpoint);if(n===seq.current){setData(r);setEdit(!r.profile&&!r.locked);}}catch(e){if(n===seq.current){setData(null);setError(readableError(e,language));}}finally{lock.current=false;if(n===seq.current)setBusy(false);}}
 useEffect(()=>{void load();return()=>{seq.current++;lock.current=false;};},[]);
 async function save(){if(lock.current||!data||data.locked||!name.trim()||!account.trim())return;lock.current=true;const n=++seq.current;setBusy(true);setError("");setNotice("");try{const r=await api<Profile>(endpoint,{method:"POST",body:JSON.stringify({name,account,expectedVersion:data.version})});if(n===seq.current){setData(r);setEdit(false);setNotice(t("收款资料已保存，请刷新分成记录。","Recipient saved. Refresh the commission report."));}}catch(e){if(n===seq.current){setData(null);setError(readableError(e,language));}}finally{if(n===seq.current){setName("");setAccount("");setBusy(false);}lock.current=false;}}
 if(data?.enabled===false)return null;
 return <section className="space-y-3 rounded-lg border p-3" data-testid="partner-payout-profile"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{t("支付宝收款资料","Alipay recipient details")}</h3><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void load()}>{t("刷新","Refresh")}</Button></div>
 <p className="text-sm text-muted-foreground">{t("仅用于管理员人工核对与转账，资料加密保存。请填写你的支付宝账号及实名收款人，不要提交密码、验证码或身份证号码。","Used only for manual verification and transfer by the administrator. Details are encrypted. Enter your Alipay account and verified recipient name, not passwords, codes or identity numbers.")}</p>
 {data?.locked&&<p className="text-sm text-amber-700">{t("结算申请处理中，暂不可修改收款资料。","Your recipient is locked while a settlement request is pending.")}</p>}
 {data?.profile&&<div className="space-y-1 rounded bg-muted/40 p-2 text-sm"><p>{t("支付宝账号","Alipay account")}：{data.profile.account}</p><p>{t("收款人","Recipient")}：{data.profile.name}</p>{!data.locked&&!edit&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setEdit(true)}>{t("修改收款资料","Edit recipient")}</Button>}</div>}
 {data&&!data.locked&&edit&&<form className="space-y-2" autoComplete="off" onSubmit={e=>{e.preventDefault();void save();}}>{!data.profile&&<p role="status" className="text-sm text-amber-700">{t("首次开通请先填写收款资料，保存后才能申请结算。","Complete your recipient profile before requesting settlement.")}</p>}<label className="block text-sm">{t("支付宝收款账号","Alipay account")}<Input value={account} onChange={e=>setAccount(e.target.value)} required maxLength={160} minLength={3} autoComplete="off" disabled={busy}/></label><label className="block text-sm">{t("支付宝实名收款人","Verified Alipay recipient name")}<Input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="off" disabled={busy}/></label><Button disabled={busy||!name.trim()||!account.trim()}>{t("保存收款资料","Save recipient")}</Button>{data.profile&&<Button type="button" variant="outline" onClick={()=>{setEdit(false);setName("");setAccount("");}}>{t("取消","Cancel")}</Button>}</form>}
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
 </section>;
}
