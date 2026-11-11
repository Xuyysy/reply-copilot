import {useEffect,useState} from 'react';
import {api} from '../../lib/api';
import {phrase,type Language} from '../../lib/language';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import {Button} from '../ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type Alert={key:string;type:string;severity:'attention'|'warning';title:string;detail:string;order_id?:string;user_id?:string;created_at?:number;count?:number;target:'orders'|'subscriptions'|'cost'};
type Plan={plan:string;deliveries:number;observedPeriods:number;deliveryCostMicroUsd:number;costedDeliveries:number;avgCostMicroUsd:number|null};
type Insights={
 time:{from:number;to:number;timezone:string;generatedAt:number};
 alerts:Alert[];alertCoverage:string;aiFailures24h:number;
 aiUsage:{rowsSampled:number;moreThanSample:boolean;limit:number;subscription:number;free:number;paid:number;unattributed:number;plans:Plan[];attributionNote:string};
 aiBudget:{dayUtc:string;limitMicroUsd:number;committedMicroUsd:number;percent:number|null};
};
const usd=(micro:number|null)=>micro==null?'—':'$'+(micro/1_000_000).toFixed(6);
export default function AdminOperationsInsights({language,active,mode,navigate,compact=false}:{
 language:Language;active:boolean;mode:'alerts'|'plans';navigate:(tab:string,orderId?:string)=>void;compact?:boolean
}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [insights,setInsights]=useState<Insights|null>(null);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!active)return;
  let live=true;setInsights(null);setError('');
  void api<Insights>('/v1/admin/ops-insights').then(data=>{if(live)setInsights(data);})
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
  return t('AI 失败请求','AI failure requests');
 };
 return <Card data-testid={'admin-ops-'+mode} className={compact?"min-w-0 !gap-0":"mb-4"}>
  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
   <CardTitle>{mode==='alerts'?t('运营异常待办','Operator attention queue'):t('订阅套餐 AI 使用与成本','Subscription AI usage and cost')}</CardTitle>
   <Button type="button" size="sm" variant="outline" onClick={()=>setRefresh(x=>x+1)}>{t('刷新','Refresh')}</Button>
  </CardHeader>
  <CardContent className={compact?"min-w-0 space-y-3 pt-0":"space-y-3"}>
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   {!insights&&!error&&<p role="status" className="text-sm text-muted-foreground">{t('正在加载运营数据…','Loading operations data…')}</p>}
   {insights&&mode==='alerts'&&<>
    <p className="text-xs text-muted-foreground">{t('只展示最近30天待核验订单及支付已确认超过5分钟但权益仍未发放的订单，以及预算/AI请求异常。每类最多8条，非完整历史待办。','Recent unresolved subscription and credit-pack orders, budget and AI anomalies. Up to eight orders per kind; not the full historical backlog.')}</p>}
    {!insights.alerts.length&&<p role="status" className="text-sm">{t('当前筛选范围没有需关注的事件。','No flagged events in the inspected ranges.')}</p>}
    <div className={compact?"admin-ops-feed space-y-2":"space-y-2"}>
     {insights.alerts.map(a=><div key={a.key} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2.5" data-testid="admin-ops-alert">
      <span className={'h-2 w-2 shrink-0 rounded-full '+(a.severity==='attention'?'bg-amber-500':'bg-slate-400')}/>
      <div className="min-w-0 flex-1">
       <p className="break-words text-[13px] font-semibold leading-5 text-slate-800">{statusLabel(a)}{a.count!=null?' · '+a.count:''}</p>
       <p className="break-all font-mono text-[10px] leading-4 text-slate-500">{a.order_id||a.detail}</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-xs" onClick={()=>navigate(a.order_id?'orders':a.target,a.order_id)}>
       {compact?t('查看','View'):t('打开相关管理','Open management')}
      </Button>
     </div>)}
    </div>
    <p className="text-xs text-muted-foreground">{t('提醒是来源数据库的只读线索，并不自动进行查单、退款、放款或更改订单状态。','Read-only indicators only. No payment verification calls, refunds, credit grants or status mutations occur here.')}</p>}
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
