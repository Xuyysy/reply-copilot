import {useEffect,useRef,useState} from 'react';
import type {Language} from '../../lib/language';
import {phrase,readableError} from '../../lib/language';
import {api,ApiError} from '../../lib/api';
import {Card,CardContent,CardHeader,CardTitle} from '../ui/card';
import {Input} from '../ui/input';
import {Button} from '../ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type Plan={id:string;plan_code:string;price_fen:number;daily_limit:number;duration_days:number;name_zh:string;name_en:string;description_zh:string;description_en:string;active:number;current:number;version:number};
type Subscriber={period_id:string;user_id:string;email:string;username:string|null;plan_code:string;period_status:string;effective_status:string;daily_limit:number;used_today:number;reserved_today:number;remaining_today:number;start_at:number|null;end_at:number|null;order_id:string;order_kind:string;amount_fen:number;order_status:string;payment_status:string|null;risk_state:string|null};
type SubscriptionOrder={id:string;user_id:string;email:string;kind:'purchase'|'renewal'|'upgrade';amount_fen:number;status:string;plan_code:string;created_at:number;paid_at:number|null;applied_at:number|null;payment_status:string|null;risk_state:string|null;merchant_provider:string|null;verified_event_count:number;provider_trade_id:string|null};
const price=(fen:number)=>'¥'+(fen/100).toFixed(2);

type Finance={orders:{kind:string;orders:number;gross_paid_fen:number;full_refunded_fen:number;held_orders:number}[];
 usage:{consumed:number;cost_micro_usd:number}|null;detailScope?:'summary'|'full'};
type Controls={language:Language;active:boolean;busy:boolean;write:(path:string,body:object)=>Promise<unknown>;
 confirm:(title:string,description:string,action:()=>Promise<void>)=>void};
export default function SubscriptionAdminPanel({language,active,busy,write,confirm}:Controls){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [state,setState]=useState<'loading'|'ready'|'unavailable'|'error'>('loading');
 const [plans,setPlans]=useState<Plan[]>([]);
 const [editing,setEditing]=useState<Plan|null>(null);
 const [finance,setFinance]=useState<Finance|null>(null);
 const [usageLoadState,setUsageLoadState]=useState<'idle'|'loading'|'loaded'|'error'>('idle');
 const [usageError,setUsageError]=useState('');
 const financeRequestVersion=useRef(0);
 const [kind,setKind]=useState('');
 const [orderStatus,setOrderStatus]=useState('');
 const [users,setUsers]=useState<Subscriber[]>([]);
 const [orders,setOrders]=useState<SubscriptionOrder[]>([]);
 const [status,setStatus]=useState('');
 const [plan,setPlan]=useState('');
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!active)return;
  let mounted=true;const revision=++financeRequestVersion.current;
  setState('loading');setError('');setFinance(null);setUsageLoadState('idle');setUsageError('');
  const query=new URLSearchParams();
  if(status)query.set('status',status);
  if(plan)query.set('plan',plan);
  const orderQuery=new URLSearchParams({kind,status:orderStatus});
  void Promise.all([
   api<{plans:Plan[]}>('/v1/admin/subscriptions/plans'),
   api<{users:Subscriber[]}>('/v1/admin/subscriptions/users'+(query.size?'?'+query.toString():'')),
   api<{orders:SubscriptionOrder[]}>('/v1/admin/subscriptions/orders?'+orderQuery),
   api<Finance>('/v1/admin/subscriptions/finance?view=summary')
  ]).then(([p,u,o,f])=>{
   if(!mounted||revision!==financeRequestVersion.current)return;setPlans(p.plans);setUsers(u.users);setOrders(o.orders);setFinance(f);setState('ready');
  }).catch((cause:unknown)=>{
   if(!mounted||revision!==financeRequestVersion.current)return;
   if(cause instanceof ApiError && cause.status===404){setState('unavailable');return;}
   setError(readableError(cause,language));setState('error');
  });
  return()=>{mounted=false;financeRequestVersion.current++;};
 },[active,refresh,status,plan,kind,orderStatus,language]);
 const loadExactUsage=()=>{
  if(!active||state!=='ready'||usageLoadState==='loading')return;
  const revision=++financeRequestVersion.current;
  setUsageLoadState('loading');setUsageError('');
  void api<Finance>('/v1/admin/subscriptions/finance').then(full=>{
   if(revision!==financeRequestVersion.current)return;
   setFinance(full);setUsageLoadState('loaded');
  }).catch((cause:unknown)=>{
   if(revision!==financeRequestVersion.current)return;
   setUsageError(readableError(cause,language));setUsageLoadState('error');
  });
 };
 const date=(v:number|null)=>v==null?'—':new Date(v).toLocaleString(language==='en'?'en-US':'zh-CN');
 return <div className="space-y-5" data-testid="subscription-admin-panel">
  <Card><CardHeader><CardTitle>{t('订阅套餐与用户','Subscriptions and subscribers')}</CardTitle></CardHeader><CardContent className="space-y-3">
   <p className="text-sm text-muted-foreground">{t('套餐修改产生新版本，已有订单保留原价。复核暂停不发起退款或授予权益。','Plan edits create a new version. Existing orders keep their prices. A review hold does not issue a refund or grant access.')}</p>
   {state==='unavailable'?<p role="status">{t('订阅系统尚未启用。现有额度、订单和商户设置不受影响。','Subscriptions are not enabled. Existing credits, orders and payment settings remain unchanged.')}</p>:null}
   {state==='error'?<p role="alert" className="text-destructive">{error}</p>:null}
   {state==='loading'?<p role="status">{t('读取订阅数据中…','Loading subscription data…')}</p>:null}
   <Button type="button" variant="outline" disabled={state==='loading'} onClick={()=>setRefresh(v=>v+1)}>{t('刷新订阅数据','Refresh subscriptions')}</Button>
   {state==='ready'?<>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
     {plans.map(p=><div key={p.id} className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-2"><strong>{language==='en'?p.name_en:p.name_zh}</strong><span className="text-xs text-muted-foreground">{p.active?t('上架','Active'):t('下架','Inactive')}</span></div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{price(p.price_fen)}</p>
      <p className="text-sm">{p.daily_limit.toLocaleString()} {t('次/24小时','generations / 24h')}</p>
      <p className="text-xs text-muted-foreground">{p.duration_days} {t('天 · 版本','days · Version')} {p.version}</p>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>setEditing(p)}>{t('编辑','Edit')}</Button>
     </div>)}
    </div>
    {editing&&<form className="grid gap-2 sm:grid-cols-2" onSubmit={event=>{
      event.preventDefault();
      const next=editing;
      confirm(t('发布套餐新版本','Publish plan version'),t('只影响未来订单。','Applies to future orders only.'),async()=>{
        await write('/v1/admin/subscriptions/plans/'+next.plan_code,{expectedId:next.id,priceFen:next.price_fen,
          nameZh:next.name_zh,nameEn:next.name_en,descriptionZh:next.description_zh,descriptionEn:next.description_en,active:Boolean(next.active)});
        setEditing(null);setRefresh(value=>value+1);
      });
    }}>
     <label>{t('人民币分','CNY fen')}<Input type="number" required min={1} max={10000000} value={editing.price_fen||''} onChange={e=>setEditing({...editing,price_fen:Number(e.target.value)})}/></label>
     <label><input type="checkbox" checked={Boolean(editing.active)} onChange={e=>setEditing({...editing,active:Number(e.target.checked)})}/> {t('上架','Active')}</label>
     {([['name_zh',t('中文名称','Chinese name')],['name_en',t('英文名称','English name')],['description_zh',t('中文说明','Chinese description')],['description_en',t('英文说明','English description')]] as const).map(([key,label])=>
      <label key={key}>{label}<Input required={key.startsWith('name_')} maxLength={key.startsWith('name_')?80:1500} value={editing[key]} onChange={e=>setEditing({...editing,[key]:e.target.value})}/></label>)}
     <Button disabled={busy}>{t('审核并保存','Review and save')}</Button>
     <Button type="button" variant="outline" onClick={()=>setEditing(null)}>{t('取消','Cancel')}</Button>
    </form>}
   </>:null}
  </CardContent></Card>
  {state==='ready'?<Card><CardHeader><CardTitle>{t('订阅用户','Subscriber records')}</CardTitle></CardHeader><CardContent className="space-y-3">
   <div className="flex flex-wrap gap-3">
    <label className="flex flex-col gap-1 text-sm">{t('订阅状态','Status')}<select aria-label={t('筛选订阅状态','Filter subscription status')} className="h-9 rounded border px-3" value={status} onChange={e=>setStatus(e.target.value)}>
      {[['',t('全部','All')],['active',t('生效中','Active')],['queued',t('待生效','Queued')],['expired',t('已到期','Expired')],['refund_pending',t('退款审核','Refund review')],['revoked',t('已撤销','Revoked')]].map(([v,label])=><option key={v} value={v}>{label}</option>)}
     </select></label>
    <label className="flex flex-col gap-1 text-sm">{t('档位','Plan')}<select aria-label={t('筛选订阅档位','Filter subscription plan')} className="h-9 rounded border px-3" value={plan} onChange={e=>setPlan(e.target.value)}>
     {['','basic','pro','max','ultra'].map(v=><option key={v} value={v}>{v||t('全部','All')}</option>)}
    </select></label>
   </div>
   <p className="text-xs text-muted-foreground">{t('最多显示最近100条订阅周期。使用额度与支付证明由服务端校验；「未核验」不能视为活跃付费。','Displays at most 100 recent periods. Daily usage and payment evidence are server-verified; unverified records are not active paid entitlements.')}</p>
   <div role="region" tabIndex={0} aria-label={t('订阅用户列表','Subscriber list')} className="max-h-[34rem] overflow-auto rounded border">
    <Table className="min-w-[950px]"><TableHeader><TableRow>{[t('用户','User'),t('套餐','Plan'),t('生效状态','Effective status'),t('今日已用','Used today'),t('预留','Reserved'),t('剩余','Remaining'),t('到期','Expires'),t('来源订单','Source order')].map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader>
     <TableBody>{users.map(u=><TableRow key={u.period_id}>
      <TableCell><span className="break-all">{u.email}</span><p className="text-xs text-muted-foreground">{u.username||u.user_id}</p></TableCell>
      <TableCell className="uppercase">{u.plan_code}</TableCell><TableCell>{u.effective_status}</TableCell>
      <TableCell className="tabular-nums">{u.used_today}</TableCell><TableCell className="tabular-nums">{u.reserved_today}</TableCell><TableCell className="tabular-nums">{u.remaining_today}</TableCell>
      <TableCell>{date(u.end_at)}</TableCell><TableCell className="break-all text-xs">{u.order_id}<p>{price(u.amount_fen)} · {u.payment_status||u.order_status}</p></TableCell>
     </TableRow>)}</TableBody></Table>
   </div>
   {!users.length?<p role="status" className="text-sm text-muted-foreground">{t('暂无符合条件的订阅记录。','No matching subscriptions.')}</p>:null}
  </CardContent></Card>:null}
  {state==='ready'?<Card><CardHeader><CardTitle>{t('订阅订单审计','Subscription order audit')}</CardTitle></CardHeader><CardContent className="space-y-3">
   <p className="text-xs text-muted-foreground">{t('最近100条订单。待付款、支付未知或缺少核验事件的记录不能视为已开通权益。','100 recent orders. Pending, unknown or unverified payment events do not grant access.')}</p>
   <div className="flex flex-wrap gap-3">
    <label>{t('订单类型','Order type')} <select value={kind} onChange={event=>setKind(event.target.value)}>{['','purchase','renewal','upgrade'].map(value=><option key={value} value={value}>{value||t('全部','All')}</option>)}</select></label>
    <label>{t('订单状态','Order status')} <select value={orderStatus} onChange={event=>setOrderStatus(event.target.value)}>{['','pending','unknown','paid','closed','failed','manual_review','refund_pending','refunded'].map(value=><option key={value} value={value}>{value||t('全部','All')}</option>)}</select></label>
   </div>
   {finance&&<div className="rounded border p-3">
     <strong>{t('最近 30 天 · 已核验订阅付款','Last 30 days · Verified subscription payments')}</strong>
     {finance.orders.map(row=><p key={row.kind}>{row.kind} · {row.orders} · {t('实收总额','Gross received')} {price(row.gross_paid_fen)} · {t('全额退款','Full refunds')} {price(row.full_refunded_fen)} · {t('待复核','Under review')} {row.held_orders}</p>)}
     {finance.usage
       ?<p>{t('订阅成功生成','Delivered subscription generations')} {finance.usage.consumed} · {t('估算上游成本','Estimated upstream cost')} ${(finance.usage.cost_micro_usd/1_000_000).toFixed(4)}</p>
       :<div className="mt-2 space-y-2">
         <p className="text-xs text-muted-foreground">{t('为节约 D1 读取量，30 天生成量与上游成本在需要时才统计。','To conserve D1 reads, 30-day generations and upstream cost are calculated on demand.')}</p>
         <Button type="button" variant="outline" disabled={busy||usageLoadState==='loading'} onClick={loadExactUsage}>
           {usageLoadState==='loading'?t('正在计算精确使用量…','Calculating exact usage…'):t('查看近30天精确用量与成本','Load exact 30-day usage and cost')}
         </Button>
         {usageLoadState==='error'?<p role="alert" className="text-sm text-destructive">{usageError}</p>:null}
        </div>}
   </div>}
   <div className="max-h-[30rem] overflow-auto rounded border" role="region" tabIndex={0} aria-label={t('订阅订单列表','Subscription orders')}>
    <Table className="min-w-[850px]"><TableHeader><TableRow>{[t('用户','User'),t('订单','Order'),t('商品类型','Purchase type'),t('金额','Amount'),t('状态','Status'),t('付款证据','Payment evidence'),t('创建时间','Created')].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
     <TableBody>{orders.map(o=><TableRow key={o.id}>
      <TableCell className="max-w-40 break-all">{o.email}</TableCell>
      <TableCell className="max-w-48 break-all text-xs">{o.id}</TableCell>
      <TableCell>{o.kind} · {o.plan_code}</TableCell>
      <TableCell>{price(o.amount_fen)}</TableCell>
      <TableCell>{o.status} / {o.payment_status||'—'}
        {['paid','manual_review'].includes(o.status)&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>confirm(
         t('暂停订阅权益并复核','Hold subscription for review'),o.id,async()=>{
          await write('/v1/admin/subscriptions/orders/'+encodeURIComponent(o.id)+'/hold',{});setRefresh(value=>value+1);
         })}>{t('暂停并复核','Hold for review')}</Button>}
        {o.merchant_provider==='mk99'&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>confirm(
         t('向支付平台核对订单','Verify with the payment platform'),o.id,async()=>{
          await write('/v1/admin/subscriptions/orders/'+encodeURIComponent(o.id)+'/verify',{});setRefresh(value=>value+1);
         })}>{t('可信查单','Verify payment')}</Button>}</TableCell>
      <TableCell>{o.verified_event_count>0&&o.payment_status==='paid'&&o.risk_state==='clear'&&o.paid_at!=null&&o.applied_at!=null?t('已记录成功事件','Success event recorded'):t('未核验或存在风险','Unverified or at risk')}</TableCell>
      <TableCell>{date(o.created_at)}</TableCell>
     </TableRow>)}</TableBody></Table>
   </div>
   {!orders.length?<p className="text-sm text-muted-foreground">{t('暂无订阅订单。','No subscription orders.')}</p>:null}
  </CardContent></Card>:null}
 </div>;
}
