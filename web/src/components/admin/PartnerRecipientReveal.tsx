import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
type Status={enabled:boolean;configured?:boolean;locked?:boolean};
export default function PartnerRecipientReveal({userId,language,write}:{userId:string;language:Language;write:<T>(path:string,body:object)=>Promise<T>}){
 const t=(zh:string,en:string)=>phrase(language,zh,en),endpoint="/v1/admin/partners/payout";
 const [status,setStatus]=useState<Status|null>(null),[profile,setProfile]=useState<{name:string;account:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const seq=useRef(0);
 useEffect(()=>{const n=++seq.current;void api<Status>(endpoint+"?userId="+encodeURIComponent(userId)).then(r=>{if(n===seq.current)setStatus(r);}).catch(e=>{if(n===seq.current)setError(readableError(e,language));});return()=>{seq.current++;};},[userId]);
 async function reveal(){if(busy||!status?.configured)return;setBusy(true);setError("");setProfile(null);const n=seq.current;try{const r=await write<{profile:{name:string;account:string}}>(endpoint,{userId,reason:"Verify partner recipient for manual settlement"});if(n===seq.current)setProfile(r.profile);}catch(e){if(n===seq.current)setError(readableError(e,language));}finally{if(n===seq.current)setBusy(false);}}
 if(status?.enabled===false)return null;
 return <section className="space-y-2 rounded border p-3" data-testid="admin-partner-recipient"><h3 className="font-semibold">{t("支付宝收款资料","Alipay recipient")}</h3>
 {status&&<p className="text-sm">{status.configured?t("已提交收款资料","Recipient submitted"):t("尚未提交收款资料","Recipient missing")}{status.locked&&t(" · 结算处理中，资料已锁定"," · Locked by pending settlement")}</p>}
 {profile?<div className="space-y-1 break-all text-sm"><p>{t("支付宝账号","Alipay account")}：{profile.account}</p><p>{t("实名收款人","Verified recipient")}：{profile.name}</p><Button type="button" variant="outline" onClick={()=>setProfile(null)}>{t("隐藏资料","Hide details")}</Button></div>:<Button type="button" variant="outline" disabled={busy||!status?.configured} onClick={()=>void reveal()}>{t("验证身份并查看收款资料","Verify and reveal recipient")}</Button>}
 <p className="text-xs text-muted-foreground">{t("查看操作会留下审计记录；处理具体申请时请以申请锁定的收款资料为准。","Reveals are audited. Use the recipient snapshot for a particular settlement request.")}</p>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 </section>;
}
