import {useEffect,useState,type FormEvent} from 'react';
import {api} from '../../lib/api';
import {phrase,type Language} from '../../lib/language';
import {Card,CardContent,CardHeader,CardTitle} from '../ui/card';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type Order={
 id:string;user_id:string;email:string;created_at:number;paid_at:number|null;
 product_type:'credit'|'subscription';product_name:string;order_kind:string;order_status:string;
 payment_status:string|null;merchant_provider:string|null;amount_fen:number|null;currency:string|null;
 credits:number|null;entitlement_status:string;payment_evidence:'verified_event'|'credited_legacy'|'unverified'
};
type Result={items:Order[];hasMore:boolean;nextCursor:string|null};
type Stats={
 verifiedCredit:{orders:number;buyers:number;gross_fen:number}|null;
 verifiedSubscription:{kind:string;orders:number;buyers:number;gross_fen:number}[];
 verifiedGrossFen:number;creditConfirmedRefunds:{refunds:number;amount_fen:number}|null;currency:string
};
const money=(fen:number|null)=>fen==null?'—':'¥'+(fen/100).toFixed(2);

export function AdminCommerceSummary({active,language,variant='default'}:{
 active:boolean;language:Language;variant?:'overview'|'default'
}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [stats,setStats]=useState<Stats|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!active)return;let live=true;setError('');
  void api<Stats>('/v1/admin/commerce/summary').then(data=>{if(live)setStats(data);})
   .catch((cause:unknown)=>{if(live)setError(cause instanceof Error?cause.message:t('财务概览暂不可用','Finance overview unavailable'));});
  return()=>{live=false;};
 },[active]);
 if(!active)return null;
 const values:Array<[string,string]> = stats?[
  [t('总核验实收','Total verified gross'),money(stats.verifiedGrossFen)],
  [t('订阅实收','Subscription receipts'),money(stats.verifiedSubscription.reduce((sum,x)=>sum+Number(x.gross_fen||0),0))],
  [t('永久额度包实收','Credit pack receipts'),money(stats.verifiedCredit?.gross_fen??0)],
  [t('额度包已确认退款','Confirmed credit refunds'),money(stats.creditConfirmedRefunds?.amount_fen??0)]
 ]:[];
 const grid=<div className="grid min-w-0 grid-cols-2 gap-2.5 lg:grid-cols-4">
  {values.map(([label,value],i)=><div key={label}
    className={variant==='overview'
      ?'min-w-0 rounded-xl border px-3.5 py-4 sm:px-4 '+(i===0?'border-slate-900 bg-slate-900 text-white':'border-slate-200 bg-white text-slate-900')
      :'min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-4'}>
   <p className={'text-[11px] leading-4 '+(variant==='overview'&&i===0?'text-slate-300':'text-slate-500')}>{label}</p>
   <strong className="admin-kpi-number mt-2 block text-[22px] font-bold leading-none sm:text-[25px]">{value}</strong>
  </div>)}
 </div>;
 const status=<>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {!stats&&!error&&<p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">{t('正在读取已核验收款…','Loading verified receipts…')}</p>}
 </>;
 const caveat=<p className="text-[11px] leading-5 text-slate-500">
  {t('核验实收是历史支付毛额，并非净利润；订阅退款仍需独立复核，未计入额度包退款。','Gross verified receipts are not profit. Subscription refunds require independent review and are excluded from credit-pack refunds.')}
 </p>;
 if(variant==='overview')return <section data-testid="admin-unified-finance" className="space-y-3">
  <div className="flex flex-wrap items-baseline justify-between gap-2">
   <h3 className="text-[15px] font-semibold text-slate-900">{t('经营收入','Verified revenue')}</h3>
   <span className="text-[11px] text-slate-500">{t('最近 90 天 · 仅统计有可信支付事件的订单','Last 90 days · verified provider events')}</span>
  </div>
  {status}
  {stats&&grid}
  {stats&&caveat}
 </section>;
 return <Card data-testid="admin-unified-finance">
  <CardHeader className="pb-2"><CardTitle>{t('已核验经营收款 · 最近90天','Verified receipts · last 90 days')}</CardTitle></CardHeader>
  <CardContent className="space-y-3">
   {status}
   {stats&&grid}
   {stats&&caveat}
  </CardContent>
 </Card>;
}

export default function AdminCommercePanel({active,language,focusOrderId}:{active:boolean;language:Language;focusOrderId?:string}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [product,setProduct]=useState('all');
 const [status,setStatus]=useState('');
 const [search,setSearch]=useState('');
 const [query,setQuery]=useState('');
 const [rows,setRows]=useState<Order[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [loadingMore,setLoadingMore]=useState(false);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [selected,setSelected]=useState<Order|null>(null);
 useEffect(()=>{
  if(!focusOrderId)return;
  setProduct('all');setStatus('');setSearch(focusOrderId);setQuery(focusOrderId);setSelected(null);
 },[focusOrderId]);
 const path=(next?:string|null)=>{
  const p=new URLSearchParams({product});
  if(status)p.set('status',status);
  if(query)p.set('q',query);
  if(next)p.set('cursor',next);
  return '/v1/admin/commerce/orders?'+p;
 };
 useEffect(()=>{
  if(!active)return;
  let live=true;setLoading(true);setRows([]);setCursor(null);setError('');
  void api<Result>(path()).then(data=>{if(live){setRows(data.items);setCursor(data.nextCursor);setSelected(previous=>{const id=focusOrderId&&query===focusOrderId?focusOrderId:previous?.id;return id?data.items.find(row=>row.id===id)||null:null;});}})
   .catch((e:unknown)=>{if(live)setError(e instanceof Error?e.message:t('订单读取失败','Could not load orders'));})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[active,product,status,query,refresh,focusOrderId]);
 const more=async()=>{
  if(!cursor||loadingMore||loading)return;
  setLoadingMore(true);setError('');
  try{
   const data=await api<Result>(path(cursor));
   setRows(previous=>[...previous,...data.items]);setCursor(data.nextCursor);
  }catch(e){setError(e instanceof Error?e.message:t('加载更多失败','Could not load more'));}
  finally{setLoadingMore(false);}
 };
 const label=(row:Order)=>row.product_type==='credit'?t('永久额度包','Permanent credits'):t('订阅','Subscription');
 const evidence=(row:Order)=>row.payment_evidence==='verified_event'?t('支付事件已核验','Provider proof verified'):
  row.payment_evidence==='credited_legacy'?t('历史已发额，付款证据未独立核验','Legacy credit granted, payment evidence unverified'):
   t('付款未核验','Payment unverified');
 const nextStep=(row:Order)=>{
  if(row.payment_status==='paid'&&row.payment_evidence==='verified_event'&&row.entitlement_status==='not_granted')
   return t('支付事件已核验但未发额度：核对订单金额、通知记录和发额流水，确认无重复入账后再走原有受控补发流程。','Payment is verified but credits are missing. Reconcile the amount, payment events and grant ledger before using the existing guarded grant workflow.');
  if(row.payment_status==='paid'&&row.payment_evidence==='verified_event'&&row.entitlement_status==='not_applied')
   return t('支付事件已核验但订阅未生效：核对订单、支付通知及周期应用记录，确认无重复生效后再走受控处理流程。','Payment is verified but subscription is not applied. Reconcile the payment event and subscription period before using the existing guarded workflow.');
  if(['unknown','manual_review','refund_pending'].includes(row.payment_status||'')||['unknown','manual_review','refund_pending'].includes(row.order_status))
   return t('目前不能确认已收款。请在原支付渠道按订单号核验真实交易，核对金额、商户与回调证据；没有可信付款证据时不得补发、退款或更改状态。','Payment is not confirmed. Check the original merchant transaction by order ID, amount and verified callback before any grant, refund or status change.');
  if(row.payment_evidence==='credited_legacy')
   return t('历史订单已发放权益，但支付证明未独立核验。请先查看历史通知和商户账单，勿重复补发。','Legacy entitlement exists but provider proof is not independently verified. Review history and merchant records; do not grant twice.');
  if(['granted','applied'].includes(row.entitlement_status))
   return t('订单已有权益记录。若用户反馈异常，先核对账号、周期及发放流水，不要重复发放。','Entitlement is recorded. If a customer reports a problem, review account and ledger records before considering any change.');
  return t('先核对原始支付状态、交易证据与权益记录。任何补发或退款都必须走原有受控审核流程。','Verify merchant payment, evidence and entitlement first. Any refund or grant must use an existing guarded approval workflow.');
 };
 return <div className="space-y-4" data-testid="admin-unified-orders">
  <AdminCommerceSummary active={active} language={language}/>
  <Card><CardHeader><CardTitle>{t('全部商品订单','All product orders')}</CardTitle></CardHeader>
   <CardContent className="space-y-4">
    <p className="text-xs text-muted-foreground">{t('把永久额度包、订阅首购、续购和升级放在同一张只读订单表中。订单状态、支付证据与权益状态分别保留。','One read-only table for permanent credits, subscription purchase, renewal and upgrade. Order, payment and entitlement states remain separate.')}</p>
    {focusOrderId&&query===focusOrderId&&<p role="status" data-testid="admin-order-alert-focus" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800">{t('已从异常提醒定位订单：核对实际付款证据与权益记录后再决定是否需要人工处理。','Opened from an alert: verify payment evidence and entitlement before taking any action.')} <span className="font-mono break-all">{focusOrderId}</span></p>}
    {focusOrderId&&query===focusOrderId&&!loading&&!rows.some(row=>row.id===focusOrderId)&&!error&&<p role="status" className="text-xs text-amber-800">{t('未在当前查询范围找到此订单。请检查订单号或在历史订单中核对，不应据此认定没有付款。','This order was not found in the current results. Verify the ID or historical records; this does not prove the payment is absent.')}</p>}
    {selected&&!loading&&<section data-testid="admin-order-triage" aria-label={t('订单核验与下一步','Order verification and next steps')} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm">
     <div className="flex flex-wrap items-center justify-between gap-2"><strong>{t('订单核验与下一步','Order verification and next steps')}</strong><Button size="sm" type="button" variant="outline" onClick={()=>setSelected(null)}>{t('收起','Collapse')}</Button></div>
     <p className="break-all font-mono text-xs">{selected.id}</p>
     <p className="break-all">{selected.email} · {selected.product_name} · {selected.order_kind}</p>
     <p>{t('订单状态','Order')}: {selected.order_status} · {t('支付状态','Payment')}: {selected.payment_status||'—'} · {t('权益状态','Entitlement')}: {selected.entitlement_status}</p>
     <p>{t('支付证据','Payment evidence')}: {evidence(selected)} · {t('订单金额','Order amount')}: {selected.currency==='CNY'?money(selected.amount_fen):'—'}</p>
     <p className="font-medium text-amber-900">{nextStep(selected)}</p>
     <p className="text-xs text-slate-600">{t('这里只能查看订单审计摘要和刷新记录，不能自动查商户、补发权益、退款或将异常标为已解决。','Read-only order evidence and refresh. This view cannot query the merchant, grant entitlements, refund or mark the alert resolved.')}</p>
     <Button type="button" size="sm" variant="outline" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>{t('刷新当前订单核验','Refresh order evidence')}</Button>
    </section>
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event:FormEvent)=>{event.preventDefault();setQuery(search.trim());}}>
     <label className="space-y-1 text-xs">{t('商品','Product')}<select value={product} aria-label={t('商品类型','Product type')} className="block h-9 rounded border bg-background px-2" onChange={e=>setProduct(e.target.value)}>
       <option value="all">{t('全部','All')}</option><option value="subscription">{t('订阅','Subscriptions')}</option><option value="credit">{t('永久额度','Permanent credits')}</option>
      </select></label>
     <label className="space-y-1 text-xs">{t('订单状态','Order status')}<select value={status} aria-label={t('订单状态','Order status')} className="block h-9 rounded border bg-background px-2" onChange={e=>setStatus(e.target.value)}>
       <option value="">{t('全部','All')}</option>
       {['paid','pending','unknown','awaiting_payment','failed','closed','expired','refunded','refund_pending','manual_review'].map(s=><option key={s} value={s}>{s}</option>)}
      </select></label>
     <label className="min-w-48 flex-1 space-y-1 text-xs">{t('精确订单号、用户ID或邮箱','Exact order ID, user ID or email')}
      <Input value={search} maxLength={120} aria-label={t('精确订单号、用户ID或邮箱','Exact order ID, user ID or email')} onChange={e=>setSearch(e.target.value)} placeholder={t('最近90天；可选精确搜索','Last 90 days; optional exact search')}/></label>
     <Button variant="outline" disabled={loading} type="submit">{t('查询','Search')}</Button>
     <Button variant="outline" disabled={loading} type="button" onClick={()=>setRefresh(x=>x+1)}>{t('刷新','Refresh')}</Button>
    </form>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading?<p role="status" className="text-sm">{t('正在加载订单…','Loading orders…')}</p>:
     <div className="data-table-wrap admin-list-scroll" role="region" tabIndex={0} aria-label={t('统一订单表','Unified orders table')}>
      <Table className="min-w-[1080px]"><TableHeader className="sticky top-0 z-10 bg-background"><TableRow>
       {[t('订单时间','Created'),t('用户','User'),t('商品','Product'),t('实付人民币','CNY'),t('商户','Merchant'),t('订单 / 支付','Order / payment'),t('权益状态','Entitlement'),t('付款证据','Payment evidence')].map(x=><TableHead key={x}>{x}</TableHead>)}
      </TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.product_type+':'+row.id}>
       <TableCell className="whitespace-nowrap text-xs">{new Date(row.created_at).toLocaleString(language==='zh'?'zh-CN':'en-US')}</TableCell>
       <TableCell className="max-w-44 break-all text-xs">{row.email}</TableCell>
       <TableCell><strong className="text-sm">{label(row)}</strong><p className="text-xs">{row.product_name} · {row.order_kind}</p><Button type="button" variant="link" size="sm" className="h-auto max-w-48 break-all p-0 text-left font-mono text-xs" onClick={()=>setSelected(row)}>{row.id}</Button></TableCell>
       <TableCell className="tabular-nums">{row.currency==='CNY'?money(row.amount_fen):'—'}</TableCell>
       <TableCell className="text-xs">{row.merchant_provider||'—'}</TableCell>
       <TableCell className="text-xs">{row.order_status} / {row.payment_status||'—'}</TableCell>
       <TableCell className="text-xs">{row.entitlement_status}</TableCell>
       <TableCell className="max-w-52 text-xs">{evidence(row)}</TableCell>
      </TableRow>)}</TableBody></Table>
     </div>}
    {!loading&&!rows.length&&!error&&<p role="status" className="text-sm text-muted-foreground">{t('当前范围没有订单','No orders in this range')}</p>}
    {cursor&&<Button type="button" variant="outline" disabled={loading||loadingMore} onClick={()=>void more()}>{loadingMore?t('加载中…','Loading…'):t('加载更多','Load more')}</Button>}
   </CardContent></Card>
 </div>;
}
