import {useEffect,useState} from 'react';
import {api} from '../../lib/api';
import {phrase,type Language} from '../../lib/language';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';
type Period={
 period_id:string;period_status:string;plan_code:string;daily_limit:number;
 start_at:number|null;end_at:number|null;used_today:number;reserved_today:number;remaining_today:number;
 effective_active:boolean;real_payment_verified:number;order_status:string;payment_status:string|null;
 merchant_provider:string|null;source_order_id:string
};
type Order={id:string;kind:string;amount_fen:number;created_at:number;status:string;plan_code:string;payment_status:string|null;merchant_provider:string|null};
type Profile={user:{id:string;email:string};creditBalances:{free_balance:number;paid_balance:number};subscriptionPeriods:Period[];subscriptionOrders:Order[];asOf:number};
export default function AdminCommerceUserProfile({userId,language}:{userId:string;language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [profile,setProfile]=useState<Profile|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  let live=true;setProfile(null);setError('');
  void api<Profile>('/v1/admin/commerce/users/'+encodeURIComponent(userId))
   .then(data=>{if(live)setProfile(data);})
   .catch((cause:unknown)=>{if(live)setError(cause instanceof Error?cause.message:t('读取订阅档案失败','Could not load subscription profile'));});
  return()=>{live=false;};
 },[userId]);
 const day=(value:number|null)=>value==null?'—':new Date(value).toLocaleString(language==='zh'?'zh-CN':'en-US');
 const current=profile?.subscriptionPeriods.find(p=>p.effective_active);
 return <Card data-testid="admin-unified-user-entitlements"><CardHeader><CardTitle>{t('统一权益档案','Combined entitlements')}</CardTitle></CardHeader><CardContent className="space-y-3">
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {!profile&&!error&&<p role="status" className="text-sm">{t('正在读取账户权益…','Loading entitlements…')}</p>}
  {profile&&<>
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {[
     [t('当前已核验订阅','Verified subscription'),current?.plan_code.toUpperCase()||t('无','None')],
     [t('订阅今日已用 / 预留','Subscription used / reserved'),current?current.used_today+' / '+current.reserved_today:'—'],
     [t('订阅日剩余','Subscription remaining today'),current?String(current.remaining_today):'—'],
     [t('永久付费余额','Permanent paid balance'),String(profile.creditBalances.paid_balance)]
    ].map(([k,v])=><div key={k} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{k}</p><strong className="mt-1 block font-semibold tabular-nums">{v}</strong></div>)}
   </div>
   <p className="text-xs text-muted-foreground">{t('免费额度','Free credits')}: {profile.creditBalances.free_balance} · {t('查询时间','As of')}: {day(profile.asOf)}。{t('订阅每日额度与永久额度账本彼此独立。','Subscription daily allowance is separate from permanent credits.')}</p>
   <div className="max-h-56 overflow-auto rounded border" role="region" tabIndex={0} aria-label={t('历史订阅周期','Subscription periods')}>
    <Table className="min-w-[760px]"><TableHeader><TableRow>{[t('档位','Plan'),t('周期','Period'),t('状态','State'),t('当日消耗 / 预留','Used / reserved'),t('核验','Verified')].map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader>
     <TableBody>{profile.subscriptionPeriods.map(p=><TableRow key={p.period_id}>
      <TableCell className="uppercase text-xs">{p.plan_code}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{day(p.start_at)} – {day(p.end_at)}</TableCell>
      <TableCell className="text-xs">{p.effective_active?t('生效中','Active'):p.period_status}</TableCell>
      <TableCell className="tabular-nums text-xs">{p.used_today} / {p.reserved_today}</TableCell>
      <TableCell className="text-xs">{p.real_payment_verified?t('真实商户核验','Real merchant verified'):t('未有真实支付证明','No real payment proof')}</TableCell>
     </TableRow>)}</TableBody></Table>
   </div>
   {profile.subscriptionPeriods.length===0&&<p className="text-xs text-muted-foreground">{t('无订阅周期','No subscription periods')}</p>}
   <div className="max-h-48 overflow-auto rounded border" role="region" tabIndex={0} aria-label={t('订阅订单历史','Subscription order history')}>
    <Table className="min-w-[650px]"><TableHeader><TableRow>{[t('订单','Order'),t('类型','Kind'),t('金额','Amount'),t('支付 / 权益','Payment / entitlement')].map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{profile.subscriptionOrders.map(o=><TableRow key={o.id}>
      <TableCell className="max-w-40 break-all font-mono text-xs">{o.id}</TableCell>
      <TableCell className="text-xs">{o.plan_code} · {o.kind}</TableCell>
      <TableCell className="text-xs tabular-nums">¥{(o.amount_fen/100).toFixed(2)}</TableCell>
      <TableCell className="text-xs">{o.payment_status||'—'} / {o.status}</TableCell>
    </TableRow>)}</TableBody></Table>
   </div>
  </>}
 </CardContent></Card>;
}
