import {useEffect,useState} from 'react';
import {api} from '../../lib/api';
import {phrase,type Language} from '../../lib/language';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import {Button} from '../ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type Alert={key:string;type:string;severity:'attention'|'warning';title:string;detail:string;order_id?:string;user_id?:string;created_at?:number;count?:number;order_status?:string;target:'orders'|'subscriptions'|'cost'};
type Plan={plan:string;deliveries:number;observedPeriods:number;deliveryCostMicroUsd:number;costedDeliveries:number;avgCostMicroUsd:number|null};
type Insights={
 time:{from:number;to:number;timezone:string;generatedAt:number};
 alerts:Alert[];alertCoverage:string;
 aiUsage:{rowsSampled:number;moreThanSample:boolean;limit:number;subscription:number;free:number;paid:number;unattributed:number;plans:Plan[];attributionNote:string};
 aiBudget:{dayUtc:string;limitMicroUsd:number;committedMicroUsd:number;percent:number|null};
};
const usd=(micro:number|null)=>micro==null?'—':'$'+(micro/1_000_000).toFixed(6);
export default function AdminOperationsInsights({language,active,mode,navigate,write,compact=false}:{
 language:Language;active:boolean;mode:'alerts'|'plans';navigate:(tab:string,orderId?:string)=>void;write?:(path:string,body:Record<string,unknown>)=>Promise<unknown>;compact?:boolean
}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [insights,setInsights]=useState<Insights|null>(null);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [ackOrder,setAckOrder]=useState<string|null>(null);
 const [ackReason,setAckReason]=useState('');
 const [ackBusy,setAckBusy]=useState(false);
 const acknowledge=async(orderId:string)=>{
  if(!write||ackBusy||ackReason.trim().length<8)return;
  if(!window.confirm(t('只结束这条过期订单的运营提醒；原订单和商户交易状态保持不变。如果后续有新的付款结果将再次提醒。确定继续吗？',
   'End this expired order alert only. Order and merchant payment states remain unchanged. New payment activity will raise a new alert. Continue?')))return;
  setAckBusy(true);setError('');
  try{
   await write('/v1/admin/ops-insights/acknowledge',{orderId,reason:ackReason.trim(),confirm:true});
   setAckOrder(null);setAckReason('');setRefresh(v=>v+1);
  }catch(e){setError(e instanceof Error?e.message:t('结束提醒失败，请刷新后再检查原订单。','Could not acknowledge alert. Refresh and verify the order.'));}
  finally{setAckBusy(false);}
 };
 useEffect(()=>{
  if(!active)return;
  let live=true;setInsights(null);setError('');
  void api<Insights>('/v1/admin/ops-insights?view='+mode).then(data=>{if(live)setInsights(data);})
   .catch((cause:unknown)=>{if(live)setError(cause instanceof Error?cause.message:t('读取运营分析失败','Unable to load insights'));});
  return()=>{live=false;};
 },[active,mode,refresh]);
 if(!active)return null;
 const statusLabel=(a:Alert)=>{
  if(a.type==='subscription_review')return t('订阅待复核','Subscription review');
  if(a.type==='credit_payment_unknown')return t('额度包付款待确认','Credit payment unknown');
  if(a.type==='credit_entitlement_gap')return t('额度包已付款但未发放额度','Credit paid, credits not granted');
  if(a.type==='subscription_entitlement_gap')return t('订阅已付款但权益未生效','Subscription paid, entitlement not applied');
  if(a.type==='ai_budget')return t('AI 预算预警','AI budget warning');
  return t('需关注事件','Attention needed');
 };
 return <Card data-testid={'admin-ops-'+mode} className={compact?"min-w-0 !gap-0":"mb-4"}>
  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
   <CardTitle>{mode==='alerts'?t('订单核验与预算提醒','Payment checks & budget alerts'):t('订阅套餐 AI 使用与成本','Subscription AI usage and cost')}</CardTitle>
   <Button type="button" size="sm" variant="outline" onClick={()=>setRefresh(x=>x+1)}>{t('刷新','Refresh')}</Button>
  </CardHeader>
  <CardContent className={compact?"min-w-0 space-y-3 pt-0":"space-y-3"}>
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   {!insights&&!error&&<p role="status" className="text-sm text-muted-foreground">{t('正在加载运营数据…','Loading operations data…')}</p>}
   {insights&&mode==='alerts'&&<>
     {!compact&&<p className="text-xs leading-5 text-muted-foreground">{t('只展示最近30天待核验订单及支付已确认超过5分钟但权益仍未发放的订单，以及预算预警。每类最多8条，非完整历史待办。','Recent unresolved subscription and credit-pack orders, budget warnings. Up to eight orders per kind; not the full historical backlog.')}</p>}
    {!insights.alerts.length&&<p role="status" className="text-sm">{t('当前筛选范围没有需关注的事件。','No flagged events in the inspected ranges.')}</p>}
    <div className={compact?"admin-ops-feed space-y-2":"space-y-2"}>
     {insights.alerts.map(a=><div key={a.key} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2.5" data-testid="admin-ops-alert">
      <span className={'h-2 w-2 shrink-0 rounded-full '+(a.severity==='attention'?'bg-amber-500':'bg-slate-400')}/>
      <div className="min-w-0 flex-1">
       <p className="break-words text-[13px] font-semibold leading-5 text-slate-800">{statusLabel(a)}{a.count!=null?' · '+a.count:''}</p>
       <p className="break-all font-mono text-[10px] leading-4 text-slate-500">{a.order_id||a.detail}</p>
       <p className="mt-1 text-[11px] leading-4 text-slate-600">{a.type==='credit_payment_unknown'?t('先核对付款凭证和原收银订单，未核验前不要补发额度。','Verify the original payment and evidence; do not grant credits without proof.'):a.type==='subscription_review'?t('核对商户付款状态与订阅订单；不要凭待确认状态发放权益。','Check the merchant payment and subscription order; do not grant entitlements from an uncertain status.'):a.type==='credit_entitlement_gap'?t('已发现可信支付事件但额度未发放，请人工复核发额流水。','Verified payment evidence exists, but credits are missing. Review the credit ledger.'):a.type==='subscription_entitlement_gap'?t('已发现可信支付事件但订阅未生效，请人工复核权益应用记录。','Verified payment evidence exists, but the subscription is inactive. Review entitlement records.'):t('检查预算与成本设置。','Check the budget and cost settings.')}</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-xs" onClick={()=>navigate(a.order_id?'orders':a.target,a.order_id)}>
       {a.order_id?t('核对订单','Review order'):t('查看预算','View budget')}
      </Button>
      {write&&a.type==='credit_payment_unknown'&&a.order_status==='expired'&&a.order_id&&<Button type="button" size="sm" variant="outline" disabled={ackBusy} onClick={()=>{setAckOrder(a.order_id||null);setAckReason('');setError('');}}>
       {t('已核实，结束提醒','Reviewed · Dismiss alert')}
      </Button>}
      {ackOrder===a.order_id&&a.order_id&&<div className="w-full space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="admin-ack-expired-order">
       <p>{t('仅处理过期订单的待办提醒，不会更改订单、商户收款、退款或额度记录。请填写至少8字的实际核对原因。','Acknowledge the expired-order alert without changing payment, refund or credit records. Enter a review reason (at least 8 characters).')}</p>
       <textarea rows={2} maxLength={500} value={ackReason} onChange={e=>setAckReason(e.target.value)} aria-label={t('核验原因','Review reason')} className="w-full rounded-md border bg-background p-2" placeholder={t('例如：已核对原商户交易，确认无需继续跟进','Example: Merchant transaction reviewed; no further operator action required')}/>
       <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={ackBusy||ackReason.trim().length<8} onClick={()=>void acknowledge(a.order_id!)}>{ackBusy?t('处理中…','Processing…'):t('确认结束提醒','Confirm dismissal')}</Button>
        <Button type="button" size="sm" variant="outline" disabled={ackBusy} onClick={()=>setAckOrder(null)}>{t('返回','Back')}</Button>
       </div>
      </div>}
     </div>)}
    </div>
     {compact?<details className="text-[11px] leading-5 text-slate-500">
       <summary className="cursor-pointer font-medium">{t('关于异常提醒与统计范围','About alert coverage')}</summary>
       <p className="mt-1">{t('近30天、每类最多8条，只读核验线索；已过期且未核验的订单可由管理员经二次验证结束提醒，不会自动退款、补发或更改订单状态。','Recent 30 days, up to eight per type. Read-only except audited alert acknowledgment for expired unverified orders; no refunds, grants or order status changes.')}</p>
      </details>:<p className="text-xs text-muted-foreground">{t('提醒是来源数据库的只读线索，并不自动进行查单、退款、放款或更改订单状态。','Read-only indicators only. No payment verification calls, refunds, credit grants or status mutations occur here.')}</p>}
   </>}
   {insights&&mode==='plans'&&<>
    <p className="text-xs text-muted-foreground">{t('最近7天按已确认 ACK 交付统计，最多抽取最新1000个请求；当前周期档位是快照，不代表升级前的历史档位。仅包含成功交付请求的模型成本，不含失败请求费用。','Seven-day ACK-confirmed deliveries, capped at the latest 1,000 requests. Plan is current period snapshot, not necessarily the historical pre-upgrade tier. Cost covers delivered requests only, not failed upstream calls.')}</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
     {[
      [t('已观察成功生成','Observed ACK deliveries'),insights.aiUsage.rowsSampled.toLocaleString()],
      [t('订阅额度生成','Subscription deliveries'),insights.aiUsage.subscription.toLocaleString()],
      [t('免费 / 永久包','Free / permanent'),insights.aiUsage.free+' / '+insights.aiUsage.paid],
      [t('当日 AI 预算使用','Daily AI budget used'),insights.aiBudget.percent==null?'—':insights.aiBudget.percent+'%']
     ].map(([name,value])=><div key={name} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{name}</p><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>)}
    </div>
    {insights.aiUsage.moreThanSample&&<p role="status" className="text-sm font-semibold text-amber-700">{t('已超过1000条：以下只是最新交付样本，不能当作全量七日统计。','More than 1,000 deliveries: this is a recent sample, NOT full seven-day totals.')}</p>}
    <div className="data-table-wrap admin-list-scroll" role="region" tabIndex={0} aria-label={t('订阅档位生成成本','Plan delivery costs')}>
     <Table className="min-w-[710px]"><TableHeader><TableRow>
      {[t('周期当前档位','Current tier'),t('成功交付','ACK deliveries'),t('覆盖周期数','Observed periods'),t('已知成本次数','Costed deliveries'),t('模型成本 USD','Recorded cost USD'),t('每次有成本记录的均价','Avg per costed ACK')].map(x=><TableHead key={x}>{x}</TableHead>)}
     </TableRow></TableHeader><TableBody>{insights.aiUsage.plans.map(p=><TableRow key={p.plan}>
      <TableCell className="uppercase font-semibold">{p.plan}</TableCell>
      <TableCell className="tabular-nums">{p.deliveries}</TableCell>
      <TableCell className="tabular-nums">{p.observedPeriods}</TableCell>
      <TableCell className="tabular-nums">{p.costedDeliveries}</TableCell>
      <TableCell className="tabular-nums">{usd(p.deliveryCostMicroUsd)}</TableCell>
      <TableCell className="tabular-nums">{usd(p.avgCostMicroUsd)}</TableCell>
     </TableRow>)}</TableBody></Table>
    </div>
    {!insights.aiUsage.plans.length&&<p role="status" className="text-sm text-muted-foreground">{t('本次观察范围没有已确认订阅消费。','No acknowledged subscription deliveries in this sample.')}</p>}
    <p className="text-xs text-muted-foreground">{t('这些成本是平台记录的模型估算值，不等于商户账单、支付净收入或真实利润。','Recorded model costs are estimates, not provider billing, net settlement, or profit.')}</p>
   </>}
  </CardContent>
 </Card>;
}
