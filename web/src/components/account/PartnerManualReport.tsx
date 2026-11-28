import {useState,useRef} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
type Report={enabled:boolean;summary?:{verifiedOrders:number;reviewCount:number;estimatedFen:number|null;recordedFen:number;differenceFen:number|null;complete:boolean};
 payoutProfileRequired?:boolean;recipientReady?:boolean;ledgerEnabled?:boolean;syncPending?:boolean;nextCursor?:string|null;
 minRequestFen?:number;requestableFen?:number|null;pendingId?:string|null;
 orders?:{domain:string;orderId:string;buyerId?:string;buyerLabel?:string|null;registeredAt?:number|null;paidAt:number;rateBps:number;state:string;principalFen:number|null;commissionFen:number|null;reason?:string}[];
 records?:{id:string;amount_fen:number;status:"pending"|"completed"|"rejected";created_at:number;resolved_at:number|null;reason?:string}[]};
type Props={language:Language;owner:string;write?:<T>(path:string,body:object)=>Promise<T>};
export default function PartnerManualReport({language,owner,write}:Props){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const endpoint=write?"/v1/admin/partners/manual-report":"/v1/partners/manual-report";
 const url=endpoint+(write?"?userId="+encodeURIComponent(owner):"");
 const [data,setData]=useState<Report|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false);
 const lock=useRef(false);
 const [pageCursor,setPageCursor]=useState<string|null>(null),[previous,setPrevious]=useState<(string|null)[]>([]);
 const money=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(v/100);
 async function refresh(cursor?:string|null,history:(string|null)[]=[]){

  if(lock.current)return;
  lock.current=true;setBusy(true);setError("");setOpened(true);
  try{
   let result=await api<Report>(url+(cursor?(write?"&":"?")+"cursor="+encodeURIComponent(cursor):""));
   if(!cursor&&result.syncPending&&!write)result=await api<Report>(endpoint,{method:"POST",body:JSON.stringify({sync:true})});
   setData(result);setPageCursor(cursor??null);setPrevious(history);
  }catch(e){setData(null);setError(readableError(e,language));}
  finally{lock.current=false;setBusy(false);}
 }
 async function syncAdmin(){
  if(!write||lock.current)return;
  lock.current=true;setBusy(true);setError("");
  try{setData(await write<Report>(endpoint,{sync:true,userId:owner}));setPageCursor(null);setPrevious([]);}catch(e){setError(readableError(e,language));}finally{lock.current=false;setBusy(false);}
 }
 async function apply(){
  const amount=data?.requestableFen;
  if(write||lock.current||amount==null||amount<(data?.minRequestFen??1000)||data?.pendingId)return;
  lock.current=true;setBusy(true);setError("");
  try{await api(endpoint,{method:"POST",body:JSON.stringify({expectedAmountFen:amount})});setData(await api<Report>(url));setPageCursor(null);setPrevious([]);}
  catch(e){setData(null);setError(readableError(e,language)+" "+t("请刷新确认申请状态。","Refresh to check application status."));}
  finally{lock.current=false;setBusy(false);}
 }
 const s=data?.summary;
 return <section className="space-y-3 rounded-lg border p-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("推广分成","Referral commission")}</h3><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void refresh()}>{opened?t("刷新","Refresh"):t("查看分成","View commission")}</Button></div>
  {busy&&<p role="status" className="text-sm">{t("处理中…","Loading…")}</p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {data?.enabled===false&&<p className="text-sm">{t("分成统计尚未开放。","Commission reporting is not enabled.")}</p>}
  {s&&<>
   <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{[[t("累计核实分成","Verified commission"),money(s.estimatedFen)],[t("已结算","Settled"),money(s.recordedFen)],[t("待结算","Unsettled"),money(s.differenceFen)]].map(([label,value])=><div key={label} className="rounded bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong>{value}</strong></div>)}</div>
   {!write&&<div className="space-y-2">
    {data?.payoutProfileRequired&&!data.recipientReady&&<p role="status" className="text-sm text-amber-700">{t("请先填写支付宝收款资料，然后刷新分成记录。","Complete your Alipay recipient profile and refresh before applying.")}</p>}
    <Button type="button" disabled={busy||data?.requestableFen==null||!!data.pendingId} onClick={()=>void apply()}>{data?.pendingId?t("申请处理中","Application pending"):t("申请结算","Request settlement")+(data?.requestableFen!=null?" "+money(data.requestableFen):"")}</Button>
    <p className="text-xs text-muted-foreground">{t(`满${(data?.minRequestFen??1000)/100}元可申请全部待结算金额，管理员人工转账。`,`Request the full unsettled amount from CNY ${(data?.minRequestFen??1000)/100}; the administrator transfers manually.`)}</p>
   </div>}
   {(!s.complete||s.reviewCount>0)&&<p role="status" className="text-sm text-amber-700">{!s.complete?(data?.syncPending?t("正在分批核实新订单，请继续刷新至同步完成。","New orders are being reconciled in batches. Refresh until complete."):t("统计范围超限，请联系管理员。","Report limit exceeded; contact the administrator.")):t("部分订单暂未核实，不计入待结算金额；已核实佣金可正常申请。","Unverified orders are excluded; verified commission remains available to request.")}</p>}
   {write&&data?.syncPending&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void syncAdmin()}>{t("同步佣金","Sync commission")}</Button>}
   <h4 className="font-medium">{data?.ledgerEnabled?t("购买记录","Purchases"):t("最近购买记录","Recent purchases")}</h4><p className="text-xs text-muted-foreground">{data?.ledgerEnabled?t("每页30条，分页不影响累计佣金。","30 orders per page; pagination does not affect the total."):t("最近 30 条统计范围内订单，待核对订单不计入可申请金额。","Latest 30 orders in scope. Orders under review do not count toward the amount available to request.")}</p>
   <div className="divide-y" data-testid="partner-purchase-list">
    {data?.orders?.map(o=><div className="py-2 text-sm" key={o.domain+":"+o.orderId} data-testid="partner-purchase-record">
     <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-medium break-all">{t("受邀用户","Referred user")} {o.buyerLabel??t("暂不可显示","Unavailable")}</span>
      <span className="text-muted-foreground">{new Date(o.paidAt).toLocaleString()} · {o.domain==="recharge"?t("次数套餐","Credits"):t("订阅","Subscription")}</span>
      <strong className={o.state==="verified"?"ml-auto text-emerald-600 tabular-nums":"ml-auto text-amber-700"}>{o.state==="verified"&&o.commissionFen!=null?"+"+money(o.commissionFen):t("待核实","Under review")}</strong>
     </div>
     <p className="mt-1 text-xs text-muted-foreground">{t("订单本金","Order principal")} {money(o.principalFen)} · {t("佣金比例","Commission rate")} {o.rateBps/100}% · {o.state==="verified"?t("已计入累计佣金","Included in total"):t("暂未计入佣金","Not included yet")}</p>
     {write&&<p className="text-xs text-muted-foreground break-all">{t("订单编号","Order ID")} {o.orderId}{o.buyerId?" · "+o.buyerId:""}{o.reason?" · "+o.reason:""}</p>}
    </div>)}
   </div>
   {!!data?.orders?.length&&<p className="text-xs text-muted-foreground">{t("用户标识已脱敏，可能重名；已核实佣金不代表已转账。","Buyer labels are masked and may repeat. Verified commission does not mean a transfer has been made.")}</p>}
   {data?.ledgerEnabled&&<div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={busy||previous.length===0} onClick={()=>void refresh(previous.at(-1)??null,previous.slice(0,-1))}>{t("上一页","Previous page")}</Button><span className="text-xs">{t("第","Page ")}{previous.length+1}{t("页","")}</span><Button type="button" variant="outline" disabled={busy||!data.nextCursor} onClick={()=>void refresh(data.nextCursor!,[...previous,pageCursor])}>{t("下一页","Next page")}</Button></div>}
   {!data?.orders?.length&&<p className="text-sm text-muted-foreground">{t("暂无统计订单。","No matching orders.")}</p>}
   <h4 className="font-medium">{t("申请记录","Settlement requests")}</h4>
   {data?.records?.map(r=><div key={r.id} className="rounded border p-2 text-sm break-all">{new Date(r.created_at).toLocaleString()} · {money(r.amount_fen)} · {r.status==="pending"?t("待处理","Pending"):r.status==="completed"?t("已结算","Settled"):t("已拒绝","Rejected")}{write&&r.reason&&<p className="text-xs">{r.reason}</p>}</div>)}
   {!data?.records?.length&&<p className="text-sm text-muted-foreground">{t("暂无申请记录。","No requests.")}</p>}
  </>}
 </section>;
}
