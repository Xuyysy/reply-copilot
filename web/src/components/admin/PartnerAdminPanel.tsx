import {useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import PartnerManualReport from "../account/PartnerManualReport";
import PartnerManualQueue from "./PartnerManualQueue";
import {Input} from "../ui/input";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";

type Policy={version:number;status:"active"|"paused";level:string;rate_bps:number;term_months:number|null;effective_at:number;reason:string};
type Result={enabled:boolean;user?:{id:string;email:string;eligible:boolean};history?:Policy[]};
type Props={language:Language;write:<T>(path:string,body:object)=>Promise<T>};
const endpoint="/v1/admin/partners/policy";
export default function PartnerAdminPanel({language,write}:Props){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [q,setQ]=useState("");
 const [data,setData]=useState<Result|null>(null);
 const [level,setLevel]=useState("standard");
 const [status,setStatus]=useState("active");
 const [rate,setRate]=useState("");
 const [term,setTerm]=useState("");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const lock=useRef(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const current=data?.history?.[0];
 async function load(value:string){
  const next=await api<Result>(endpoint+"?q="+encodeURIComponent(value));
  setData(next);
  const p=next.history?.[0];
  setLevel(p?.level||"standard");setStatus(p?.status||"active");
  setRate(p?String(p.rate_bps/100):"");setTerm(p?(p.term_months===null?"unlimited":String(p.term_months)):"");setReason("");
 }
 async function search(){
  if(lock.current||!q.trim())return;
  lock.current=true;setBusy(true);setData(null);setError("");setNotice("");
  try{await load(q.trim());}catch(e){setError(readableError(e,language));}
  finally{lock.current=false;setBusy(false);}
 }
 async function save(){
  const target=data?.user;
  const bps=Math.round(Number(rate)*100);
  const months=term==="unlimited"?null:Number(term);
  if(lock.current||!target||!/^\d{1,3}(\.\d{1,2})?$/.test(rate)||bps<1||bps>10000||
   (months!==null&&(!/^\d{1,3}$/.test(term)||months<1||months>120))||reason.trim().length<8||
   (status==="active"&&!target.eligible)||(status==="paused"&&current?.status!=="active"))return;
  lock.current=true;setBusy(true);setError("");setNotice("");
  try{
   await write(endpoint,{userId:target.id,status,level,rateBps:bps,termMonths:months,reason:reason.trim(),expectedVersion:current?.version||0});
   await load(target.id);setNotice(t("规则已保存，历史版本保留。","Policy saved; history retained."));
  }catch(e){
   setError(readableError(e,language)+" "+t("请重新查询确认实际状态。","Search again to confirm the actual state."));
   setData(null);
  }finally{lock.current=false;setBusy(false);}
 }
 return <Card><CardHeader><CardTitle>{t("推广伙伴 · 资格与规则","Partners · Eligibility and policy")}</CardTitle></CardHeader>
 <CardContent className="space-y-4">
  <PartnerManualQueue language={language} write={write}/>
  <p className="text-sm text-muted-foreground">{t("管理指定伙伴及约定分成。满10元申请，由管理员人工转账并标记完成。","Manage assigned partners and commission terms. Requests start at CNY 10; transfer externally and mark settled.")}</p>
  <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void search();}}>
   <Input aria-label={t("用户 ID 或邮箱","User ID or email")} value={q} onChange={e=>{setQ(e.target.value);setData(null);setNotice("");}} disabled={busy} maxLength={254} className="flex-1" required/>
   <Button disabled={busy||!q.trim()}>{t("查询","Search")}</Button>
  </form>
  {data?.enabled===false&&<p role="status">{t("推广计划默认关闭，需单独审核后启用。","Program disabled pending separate rollout approval.")}</p>}
  {data?.user&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
   <p className="break-all font-medium">{data.user.email} · {data.user.id}</p>
   {!data.user.eligible&&<p>{t("账户不符合启用资格。","Account is not eligible for activation.")}</p>}
   <label className="block text-sm">{t("状态","Status")}<select className="block w-full rounded border p-2" value={status} disabled={busy} onChange={e=>setStatus(e.target.value)}><option value="active">{t("启用","Active")}</option>{current?.status==="active"&&<option value="paused">{t("暂停","Paused")}</option>}{current?.status==="paused"&&<option value="paused" disabled>{t("已暂停","Paused")}</option>}</select></label>
   <label className="block text-sm">{t("等级","Level")}<select className="block w-full rounded border p-2" value={level} disabled={busy} onChange={e=>setLevel(e.target.value)}><option value="standard">{t("普通","Standard")}</option><option value="advanced">{t("高级","Advanced")}</option><option value="strategic">{t("战略","Strategic")}</option></select></label>
   <label className="block text-sm">{t("约定佣金比例（%）","Configured commission rate (%)")}<Input value={rate} disabled={busy} onChange={e=>setRate(e.target.value)} inputMode="decimal" required maxLength={6}/></label>
   <label className="block text-sm">{t("约定合作期限（月）或 unlimited","Configured term (months) or unlimited")}<Input value={term} disabled={busy} onChange={e=>setTerm(e.target.value)} required maxLength={9}/></label>
   <label className="block text-sm">{t("操作原因（至少 8 字）","Reason (at least 8 characters)")}<Input value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} required minLength={8} maxLength={500}/></label>
   <Button disabled={busy||reason.trim().length<8||!rate||!term||(status==="active"&&!data.user.eligible)||(status==="paused"&&current?.status!=="active")}>{current?t("保存合作规则","Save policy"):t("授权推广伙伴","Authorize partner")}</Button>
  </form>}
  {data?.history?.length? <div className="space-y-2"><h3 className="font-medium">{t("最近 20 个规则版本","Last 20 policy versions")}</h3>{data.history.map(p=><div key={p.version} className="rounded border p-2 text-sm break-all">v{p.version} · {p.status} · {p.level} · {p.rate_bps/100}% · {p.term_months??"unlimited"} · {new Date(p.effective_at).toLocaleString()}<p>{p.reason}</p></div>)}</div>:null}
  {data?.user&&current&&<PartnerManualReport key={data.user.id+":"+current.version} owner={data.user.id} language={language} write={write}/>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
 </CardContent></Card>;
}
