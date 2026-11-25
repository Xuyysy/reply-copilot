import {useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
type Job={order_domain:string;order_id:string;state:string;attempts:number;last_code:string;next_attempt_at:number;approval_expires_at:number|null};
type Cursor={updatedAt:number;domain:string;orderId:string};
type Queue={ok:boolean;scheduled:boolean;rows:Job[];next?:Cursor|null};
type Detail={ok:boolean;reason?:string;snapshot?:string;provider?:string;principalFen?:number;refundedFen?:number;candidateFen?:number;rateBps?:number;policyVersion?:number;holdUntil?:number};
const endpoint="/v1/admin/partners/accrual-review";
export default function PartnerAccrualQueue({language,write}:{language:Language;write:<T>(path:string,body:object)=>Promise<T>}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [state,setState]=useState("pending"),[queue,setQueue]=useState<Queue|null>(null),[selected,setSelected]=useState<Job|null>(null),[detail,setDetail]=useState<Detail|null>(null),[reason,setReason]=useState(""),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const lock=useRef(false);
 const money=(fen:number)=>new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(fen/100);
 function clear(){setSelected(null);setDetail(null);setReason("");setReviewed(false);}
 async function load(next=state,cursor?:Cursor){
  if(lock.current)return;lock.current=true;setBusy(true);clear();setQueue(null);setError("");
  try{setQueue(await api<Queue>(endpoint+"?"+new URLSearchParams({state:next,...(cursor?{afterAt:String(cursor.updatedAt),afterDomain:cursor.domain,afterId:cursor.orderId}:{})})));}catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function inspect(j:Job){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");clear();setSelected(j);
  try{if(j.state==="pending")setDetail(await api<Detail>(endpoint+"?"+new URLSearchParams({action:"inspect",domain:j.order_domain,orderId:j.order_id})));}catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function submit(action:"approve_for_queue"|"reopen"){
  if(lock.current||!selected||!reviewed||reason.trim().length<8)return;
  if(action==="approve_for_queue"&&(!detail?.ok||!detail.snapshot||!queue?.scheduled))return;
  if(!window.confirm(t("仅测试环境。确认已核对本次订单及风险，不进行真实资金交易。","Test environment only. Confirm order and risk review; no real money movement.")))return;
  lock.current=true;setBusy(true);setError("");
  try{await write(endpoint,{domain:selected.order_domain,orderId:selected.order_id,action,reason:reason.trim(),riskReviewed:true,...(action==="reopen"?{attempt:selected.attempts}:{expectedSnapshot:detail?.snapshot})});clear();setQueue(await api<Queue>(endpoint+"?"+new URLSearchParams({state})));}catch(e){clear();setQueue(null);setError(readableError(e,language)+" "+t("请重新查询后核对状态。","Reload and verify the state."));}finally{lock.current=false;setBusy(false);}
 }
 const labels:Record<string,string>={pending:t("待处理","Pending"),review:t("待重审","Review"),done:t("已入账","Recorded")};
 return <Card><CardHeader><CardTitle>{t("计佣审核队列（测试）","Accrual review queue (pilot)")}</CardTitle></CardHeader><CardContent className="space-y-3">
 <p className="text-sm text-muted-foreground">{t("仅非生产环境启用；人工核对后批准后台入账。未核验订单不产生佣金。","Non-production only. Review evidence before background accrual; unverified orders are not credited.")}</p>
 <div className="flex gap-2"><select aria-label={t("队列状态","Queue state")} className="rounded border p-2" value={state} disabled={busy} onChange={e=>{setState(e.target.value);setQueue(null);clear();}}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><Button type="button" onClick={()=>void load()} disabled={busy}>{t("查询","Load")}</Button></div>
 {queue&&<p className="text-xs text-muted-foreground">{queue.scheduled?t("后台入账已启用（测试）","Scheduled posting enabled (pilot)"):t("后台入账未启用","Scheduled posting disabled")} · {t("每页最多 30 条","Up to 30 rows per page")}</p>}
 {queue?.rows.map(j=><div className="rounded border p-3 text-sm space-y-1" key={j.order_domain+":"+j.order_id}><p>{j.order_domain==="recharge"?t("次数套餐","Credits"):t("订阅","Subscription")} · {labels[j.state]} · {t("尝试次数","Attempts")} {j.attempts}</p><p className="break-all text-xs">{j.order_id}</p><p className="text-xs">{j.last_code}{j.approval_expires_at?" · "+t("审批截止","Approval expiry")+" "+new Date(j.approval_expires_at).toLocaleString(): ""}</p>{j.state!=="done"&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void inspect(j)}>{t("核对","Review")}</Button>}</div>)}
 {queue?.next&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void load(state,queue.next!)}>{t("下一页","Next page")}</Button>}
 {queue?.rows.length===0&&<p>{t("暂无记录","No records")}</p>}
 {selected&&<div className="space-y-2 rounded border p-3 text-sm"><p className="font-medium break-all">{selected.order_id}</p>
 {detail?.ok&&<><p>{t("支付渠道","Provider")}: {detail.provider}</p><p>{t("候选本金","Principal")}: {money(detail.principalFen||0)} · {t("退款本金","Refunded")}: {money(detail.refundedFen||0)}</p><p>{t("历史规则","Policy")} v{detail.policyVersion} · {(detail.rateBps||0)/100}%</p><p>{t("净候选佣金","Net candidate")}: {money(detail.candidateFen||0)}</p><p>{t("冻结截止","Hold until")}: {detail.holdUntil?new Date(detail.holdUntil).toLocaleString():"—"}</p></>}
 {detail&&!detail.ok&&<p>{t("暂不可批准：","Not eligible: ")}{detail.reason}</p>}
 <label className="block">{t("审核原因（至少 8 字）","Review reason (at least 8 characters)")}<Input value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
 <label className="flex gap-2"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>{t("我已人工核对风险与证据","I manually reviewed risk and evidence")}</label>
 {selected.state==="review"&&<Button type="button" disabled={busy||!reviewed||reason.trim().length<8||selected.attempts>=19} onClick={()=>void submit("reopen")}>{t("重新入队（需再次审核）","Reopen for fresh review")}</Button>}
 {selected.state==="pending"&&<Button type="button" disabled={busy||!reviewed||reason.trim().length<8||!detail?.ok||!queue?.scheduled||!!selected.approval_expires_at||selected.next_attempt_at>Date.now()} onClick={()=>void submit("approve_for_queue")}>{t("批准后台模拟入账","Approve test posting")}</Button>}
 </div>}
 {error&&<p role="alert">{error}</p>}
 </CardContent></Card>;
}
