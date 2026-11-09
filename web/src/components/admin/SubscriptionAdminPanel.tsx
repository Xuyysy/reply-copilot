import {useEffect,useState} from 'react';
import type {Language} from '../../lib/language';
import {phrase,readableError} from '../../lib/language';
import {api,ApiError} from '../../lib/api';
import {Card,CardContent,CardHeader,CardTitle} from '../ui/card';
import {Button} from '../ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type Plan={id:string;plan_code:string;price_fen:number;daily_limit:number;duration_days:number;name_zh:string;name_en:string;active:number;current:number;version:number};
type Subscriber={period_id:string;user_id:string;email:string;username:string|null;plan_code:string;period_status:string;effective_status:string;daily_limit:number;used_today:number;reserved_today:number;remaining_today:number;start_at:number|null;end_at:number|null;order_id:string;order_kind:string;amount_fen:number;order_status:string;payment_status:string|null;risk_state:string|null};
type SubscriptionOrder={id:string;user_id:string;email:string;kind:'purchase'|'renewal'|'upgrade';amount_fen:number;status:string;plan_code:string;created_at:number;paid_at:number|null;applied_at:number|null;payment_status:string|null;risk_state:string|null;merchant_provider:string|null;verified_event_count:number;provider_trade_id:string|null};
const price=(fen:number)=>'¥'+(fen/100).toFixed(2);

export default function SubscriptionAdminPanel({language,active}:{language:Language;active:boolean}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [state,setState]=useState<'loading'|'ready'|'unavailable'|'error'>('loading');
 const [plans,setPlans]=useState<Plan[]>([]);
 const [users,setUsers]=useState<Subscriber[]>([]);
 const [orders,setOrders]=useState<SubscriptionOrder[]>([]);
 const [status,setStatus]=useState('');
 const [plan,setPlan]=useState('');
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!active)return;
  let mounted=true;setState('loading');setError('');
  const query=new URLSearchParams();
  if(status)query.set('status',status);
  if(plan)query.set('plan',plan);
  void Promise.all([
   api<{plans:Plan[]}>('/v1/admin/subscriptions/plans'),
   api<{users:Subscriber[]}>('/v1/admin/subscriptions/users'+(query.size?'?'+query.toString():'')),
   api<{orders:SubscriptionOrder[]}>('/v1/admin/subscriptions/orders')
  ]).then(([p,u,o])=>{
   if(!mounted)return;setPlans(p.plans);setUsers(u.users);setOrders(o.orders);setState('ready');
  }).catch((cause:unknown)=>{
   if(!mounted)return;
   if(cause instanceof ApiError && cause.status===404){setState('unavailable');return;}
   setError(readableError(cause,language));setState('error');
  });
  return()=>{mounted=false;};
 },[active,refresh,status,plan,language]);
 const date=(v:number|null)=>v==null?'—':new Date(v).toLocaleString(language==='en'?'en-US':'zh-CN');
 return <div className="space-y-5" data-testid="subscription-admin-panel">
  <Card><CardHeader><CardTitle>{t('订阅套餐与用户','Subscriptions and subscribers')}</CardTitle></CardHeader><CardContent className="space-y-3">
   <p className="text-sm text-muted-foreground">{t('只读管理视图。订阅收款、升档、续购及退款处理仍需通过经过核验的服务端流程，不支持手工修改已付款订单。','Read-only administration. New orders, upgrades, renewals and refunds require verified server-side payment workflows. Paid orders cannot be edited here.')}</p>
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
     </div>)}
    </div>
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
   <div className="max-h-[30rem] overflow-auto rounded border" role="region" tabIndex={0} aria-label={t('订阅订单列表','Subscription orders')}>
    <Table className="min-w-[850px]"><TableHeader><TableRow>{[t('用户','User'),t('订单','Order'),t('商品类型','Purchase type'),t('金额','Amount'),t('状态','Status'),t('付款证据','Payment evidence'),t('创建时间','Created')].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
     <TableBody>{orders.map(o=><TableRow key={o.id}>
      <TableCell className="max-w-40 break-all">{o.email}</TableCell>
      <TableCell className="max-w-48 break-all text-xs">{o.id}</TableCell>
      <TableCell>{o.kind} · {o.plan_code}</TableCell>
      <TableCell>{price(o.amount_fen)}</TableCell>
      <TableCell>{o.status} / {o.payment_status||'—'}</TableCell>
      <TableCell>{o.verified_event_count>0&&o.payment_status==='paid'&&o.risk_state==='clear'&&o.paid_at!=null&&o.applied_at!=null?t('已记录成功事件','Success event recorded'):t('未核验或存在风险','Unverified or at risk')}</TableCell>
      <TableCell>{date(o.created_at)}</TableCell>
     </TableRow>)}</TableBody></Table>
   </div>
   {!orders.length?<p className="text-sm text-muted-foreground">{t('暂无订阅订单。','No subscription orders.')}</p>:null}
  </CardContent></Card>:null}
 </div>;
}
