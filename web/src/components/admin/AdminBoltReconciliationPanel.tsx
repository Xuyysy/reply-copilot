import {useEffect,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";

type Network="TRC20"|"POLYGON"|"BEP20"|"ERC20"|"SOLANA";
type Scope="attention"|"all"|"paid"|"open";
type Summary={total:number;attention:number;manual_review:number;paid_unapplied:number;paid:number;pending:number};
type Row={id:string;external_order_id:string;email:string;network:Network;
 product_type:string;status:string;review_reason:string|null;created_at:number;
 payable_usdt_micros:number|null;paid_usdt_micros:number|null;recorded_receipts:number};
type Report={schemaReady:boolean;summary:Summary;orders:Row[];nextCursor:string|null};
type ProviderEvent={event_id:string;status:string;network:string;tx_hash:string;
 received_at:number;has_recorded_digest:number};
type Evidence={order:Row&{receiving_address:string|null;tx_hash:string|null;
 token_contract:string;external_order_id:string};providerEvents:ProviderEvent[];
 matchedRecordedReceipts:number;readOnly:boolean;
 entitlement:{kind:string;credit:{status:string;credited_at:number|null;ledger_grants:number;batch_grants:number}|null;
 subscription:{status:string;paid_at:number|null;applied_at:number|null;period_count:number;upgrade_count:number}|null}};
const REASON:Record<string,[string,string]>={
 manual_review:["等待人工核查","Manual review required"],
 paid_unapplied:["付款已记录但权益未发放","Recorded paid, entitlement unapplied"],
 missing_recorded_receipt:["缺少关联回执记录","Missing recorded receipt"],
 missing_credit_ledger:["缺少永久额度账本记录","Missing credit ledger"],
 missing_credit_order_state:["充值订单状态或到账标记不一致","Credit order/crediting status mismatch"],
 missing_subscription_entitlement:["缺少订阅权益记录","Missing subscription entitlement"],
 expired_unresolved:["过期订单仍未解决","Expired unresolved order"],
 unknown_status:["订单付款状态不确定","Uncertain payment status"]
};
const CHAINS:Network[]=["TRC20","POLYGON","BEP20","ERC20","SOLANA"];
const money=(v:number|null):string=>{
 if(v===null||!Number.isSafeInteger(v)||v<0)return "—";
 const n=BigInt(v);
 const fraction=(n%1000000n).toString().padStart(6,"0").replace(/0+$/,"");
 return (n/1000000n).toString()+(fraction?"."+fraction:"")+" USDT";
};
const when=(v:number|null)=>v===null?"—":new Date(v).toLocaleString();

export default function AdminBoltReconciliationPanel({active,language}:{active:boolean;language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [scope,setScope]=useState<Scope>("attention");
 const [network,setNetwork]=useState<"all"|Network>("all");
 const [rows,setRows]=useState<Row[]>([]);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [schemaReady,setSchemaReady]=useState(false);
 const [cursor,setCursor]=useState<string|null>(null);
 const [selected,setSelected]=useState<Evidence|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [loadingMore,setLoadingMore]=useState(false);
 const [detailLoading,setDetailLoading]=useState(false);
 const [error,setError]=useState("");
 const [detailError,setDetailError]=useState("");
 const [reload,setReload]=useState(0);
 useEffect(()=>{
  if(!active)return;
  let live=true;setLoading(true);setError("");setRows([]);setCursor(null);
  setSelected(null);setSelectedId(null);
  const q=new URLSearchParams({scope,network,limit:"25"});
  void api<Report>("/v1/admin/boltutil/reconciliation?"+q.toString()).then(result=>{
   if(!live)return;
   setSummary(result.summary);setRows(result.orders);setCursor(result.nextCursor);
   setSchemaReady(result.schemaReady);
  }).catch((e:unknown)=>{if(live)setError(e instanceof Error?e.message:t("对账数据读取失败","Unable to load reconciliation"));})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[active,scope,network,reload]);
 async function more(){
  if(!cursor||loading||loadingMore)return;
  setLoadingMore(true);setError("");
  try{
   const q=new URLSearchParams({scope,network,limit:"25",cursor});
   const result=await api<Report>("/v1/admin/boltutil/reconciliation?"+q.toString());
   setRows(old=>[...old,...result.orders.filter(item=>!old.some(row=>row.id===item.id))]);
   setCursor(result.nextCursor);
  }catch(e){setError(e instanceof Error?e.message:t("无法加载更多","Unable to load more"));}
  finally{setLoadingMore(false);}
 }
 async function details(id:string){
  setSelectedId(id);setSelected(null);setDetailError("");setDetailLoading(true);
  try{
   const result=await api<Evidence>("/v1/admin/boltutil/orders/"+encodeURIComponent(id)+"/evidence");
   setSelected(result);
  }catch(e){setDetailError(e instanceof Error?e.message:t("无法读取订单证据","Unable to inspect order evidence"));}
  finally{setDetailLoading(false);}
 }
 return <Card data-testid="boltutil-reconciliation">
  <CardHeader>
   <CardTitle>{t("USDT 五链对账与异常核查","USDT five-chain reconciliation & exceptions")}</CardTitle>
   <p className="text-sm text-muted-foreground">{t(
    "USDT 订单单独统计，不计入人民币收入。只查看已记录的回执与权益证据，不执行链上查询或订单变更。",
    "USDT counts stay separate from CNY revenue. Stored evidence only; no on-chain query or order mutation."
   )}</p>
  </CardHeader>
  <CardContent className="space-y-4">
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {([
      ["total",t("累计订单","All orders")],
      ["attention",t("待核查","Needs review")],
      ["manual_review",t("人工复核","Manual review")],
      ["paid_unapplied",t("已付款未发权益","Paid unapplied")],
      ["paid",t("记录已付款","Recorded paid")],
      ["pending",t("未最终确认","Open / uncertain")]
    ] as const).map(([key,label])=><div key={key} className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{summary?.[key]??"—"}</p>
    </div>)}
   </div>
   <div className="flex flex-wrap items-center gap-2">
    <select className="h-10 rounded-md border px-2 text-sm" aria-label={t("对账范围","Reconciliation scope")}
     value={scope} onChange={e=>setScope(e.target.value as Scope)}>
     <option value="attention">{t("仅待核查","Needs review")}</option>
     <option value="all">{t("全部订单","All")}</option>
     <option value="paid">{t("已记录付款","Paid")}</option>
     <option value="open">{t("未最终确认","Open")}</option>
    </select>
    <select className="h-10 rounded-md border px-2 text-sm" aria-label={t("对账网络","Reconciliation network")}
     value={network} onChange={e=>setNetwork(e.target.value as "all"|Network)}>
     <option value="all">{t("全部网络","All networks")}</option>
     {CHAINS.map(n=><option key={n} value={n}>{n}</option>)}
    </select>
    <Button variant="outline" disabled={loading||loadingMore} onClick={()=>setReload(v=>v+1)}>
     {t("刷新核查","Refresh evidence")}
    </Button>
   </div>
   {!schemaReady&&!loading&&<p role="status" className="text-sm text-muted-foreground">
    {t("D1 五链结构未标记就绪；没有读取历史订单表。","D1 BoltUtil schema not declared ready; order table not queried.")}
   </p>}
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   <div className="space-y-2">
    {rows.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0 space-y-1">
       <p className="break-all text-xs font-medium">{item.external_order_id} · {item.network} · {item.product_type}</p>
       <p className="break-all text-xs text-muted-foreground">{item.email} · {when(item.created_at)}</p>
       <p className="text-xs">{money(item.payable_usdt_micros)} · {item.status} · {item.review_reason?
         t(REASON[item.review_reason]?.[0]||item.review_reason,REASON[item.review_reason]?.[1]||item.review_reason)
         :t("无异常标记","No flagged issue")}</p>
      </div>
      <Button variant="outline" size="sm" onClick={()=>void details(item.id)}>{t("查看证据","Inspect evidence")}</Button>
    </div>)}
    {!loading&&schemaReady&&rows.length===0&&<p className="text-sm text-muted-foreground">
      {t("当前筛选没有匹配的订单。","No matching orders for this filter.")}
    </p>}
    {cursor&&<Button variant="outline" disabled={loadingMore||loading} onClick={()=>void more()}>
      {loadingMore?t("加载中…","Loading…"):t("加载更多（25 笔）","Load 25 more")}
    </Button>}
   </div>
   {selectedId&&<section className="space-y-3 rounded-xl border p-4" aria-label={t("订单证据","Order evidence")}>
    <div className="flex items-center justify-between gap-2">
     <h4 className="font-semibold">{t("逐笔只读证据核查","Read-only payment evidence")}</h4>
     <Button size="sm" variant="outline" onClick={()=>{setSelectedId(null);setSelected(null);}}>
      {t("关闭","Close")}
     </Button>
    </div>
    {detailLoading&&<p role="status">{t("正在读取…","Loading…")}</p>}
    {detailError&&<p role="alert" className="text-sm text-red-700">{detailError}</p>}
    {selected&&<>
     <p className="break-all text-xs">{selected.order.external_order_id} · {selected.order.network} · {selected.order.status}</p>
     <p className="break-all text-xs">{t("历史收款地址","Recorded recipient")}: {selected.order.receiving_address||"—"}</p>
     <p className="break-all text-xs">{t("交易哈希","Transaction hash")}: {selected.order.tx_hash||"—"}</p>
     <p className="text-sm">{t("应付","Payable")}: {money(selected.order.payable_usdt_micros)} ·
      {t("实付","Paid")}: {money(selected.order.paid_usdt_micros)}</p>
     <p className="text-sm">{t("匹配的已记录回执摘要","Matching stored receipt digests")}: {selected.matchedRecordedReceipts}</p>
     <p className="text-sm">{t("权益账本","Entitlement ledger")}:
      {selected.entitlement.kind==="credits"
       ?" "+t("额度授予","Credit grant")+" "+(selected.entitlement.credit?.ledger_grants??0)+
          " · "+t("额度批次","Credit batches")+" "+(selected.entitlement.credit?.batch_grants??0)
       :" "+t("订阅周期","Subscription periods")+" "+(selected.entitlement.subscription?.period_count??0)+
          " · "+t("升级变更","Tier changes")+" "+(selected.entitlement.subscription?.upgrade_count??0)}
     </p>
     <p className="text-xs text-muted-foreground">{t(
      "数据库回执摘要不等于独立链上确认。此页面不提供手工确认到账或发放权益功能。",
      "Stored receipt digests do not establish independent chain confirmation. No manual settle or grant action is available."
     )}</p>
     <p className="text-sm font-medium">{t("已记录事件（最多 25 条）","Recorded events (up to 25)")}</p>
     {selected.providerEvents.map(e=><p key={e.event_id} className="break-all text-xs text-muted-foreground">
      {when(e.received_at)} · {e.status} · {e.network} · {e.event_id} ·
      {e.has_recorded_digest?t("有摘要","Has digest"):t("无摘要","No digest")}
     </p>)}
    </>}
   </section>}
  </CardContent>
 </Card>;
}
