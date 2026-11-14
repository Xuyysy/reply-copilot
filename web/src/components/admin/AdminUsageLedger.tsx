import {useEffect,useState} from 'react';
import type {Language} from '../../lib/language';
import {phrase} from '../../lib/language';
import {api} from '../../lib/api';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type EntitlementRow={
 id:string;user_id:string;email:string;occurred_at:number;
 source:'subscription'|'free'|'paid'|'mixed'|'unknown';event_type:string;
 free_delta:number;paid_delta:number;subscription_delta:number|null;
 plan_code:string|null;daily_limit:number|null;day_index:number|null;
 amount_fen:number|null;order_status:string|null;reference_id:string|null;reason:string|null;
};
type EntitlementResult={items:EntitlementRow[];hasMore:boolean;nextCursor:string|null};
type EntitlementSource='all'|'subscription'|'free'|'paid'|'mixed'|'unknown';
type Usage={
  request_id:string;user_id:string;email:string;created_at:number;
  source:'subscription'|'free'|'paid'|'unknown';source_evidence:string;
  period_id:string|null;period_plan:string|null;model:string|null;
  input_tokens:number|null;output_tokens:number|null;
  estimated_cost_micro_usd:number|null;usage_quality:string|null
};
type Result={items:Usage[];hasMore:boolean;nextCursor:string|null};
type Source='all'|'subscription'|'free'|'paid'|'unknown';

export default function AdminUsageLedger({active,language}:{active:boolean;language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [mode,setMode]=useState<'usage'|'changes'>('usage');
 const [source,setSource]=useState<Source>('all');
 const [search,setSearch]=useState('');
 const [query,setQuery]=useState('');
 const [items,setItems]=useState<Usage[]>([]);
 const [changeSource,setChangeSource]=useState<EntitlementSource>('all');
 const [changeSearch,setChangeSearch]=useState('');
 const [changeQuery,setChangeQuery]=useState('');
 const [changeDays,setChangeDays]=useState(30);
 const [changeAnchor,setChangeAnchor]=useState(()=>Date.now());
 const [changeItems,setChangeItems]=useState<EntitlementRow[]>([]);
 const [changeNextCursor,setChangeNextCursor]=useState<string|null>(null);
 const [changeLoading,setChangeLoading]=useState(false);
 const [changeMoreLoading,setChangeMoreLoading]=useState(false);
 const [nextCursor,setNextCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [moreLoading,setMoreLoading]=useState(false);
 const [error,setError]=useState('');
 const [nonce,setNonce]=useState(0);
 const params=(cursor?:string|null)=>{
  const p=new URLSearchParams({source});
  if(query.trim())p.set('q',query.trim());
  if(cursor)p.set('cursor',cursor);
  return '/v1/admin/usage-ledger?'+p.toString();
 };
 useEffect(()=>{
  if(!active||mode!=='usage')return;
  let mounted=true;
  setLoading(true);setError('');setItems([]);setNextCursor(null);
  void api<Result>(params()).then(result=>{
   if(!mounted)return;
   setItems(result.items);setNextCursor(result.nextCursor);
  }).catch((cause:unknown)=>{
   if(mounted)setError(cause instanceof Error?cause.message:t('读取失败，请重试。','Unable to load usage. Retry.'));
  }).finally(()=>{if(mounted)setLoading(false);});
  return()=>{mounted=false;};
 },[active,mode,source,query,nonce]);
 const changeParams=(cursor?:string|null)=>{
  const p=new URLSearchParams({source:changeSource,from:String(changeAnchor-changeDays*86400000),to:String(changeAnchor+1)});
  if(changeQuery.trim())p.set('q',changeQuery.trim());
  if(cursor)p.set('cursor',cursor);
  return '/v1/admin/entitlement-activity?'+p.toString();
 };
 useEffect(()=>{
  if(!active||mode!=='changes')return;
  let mounted=true;setChangeLoading(true);setError('');setChangeItems([]);setChangeNextCursor(null);
  void api<EntitlementResult>(changeParams()).then(data=>{
   if(mounted){setChangeItems(data.items);setChangeNextCursor(data.nextCursor);}
  }).catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:t('读取权益流水失败。','Unable to load entitlement activity.'));})
   .finally(()=>{if(mounted)setChangeLoading(false);});
  return()=>{mounted=false;};
 },[active,mode,changeSource,changeQuery,changeDays,changeAnchor,nonce]);
 async function loadMoreChanges(){
  if(!changeNextCursor||changeLoading||changeMoreLoading)return;
  setChangeMoreLoading(true);setError('');
  try{
   const data=await api<EntitlementResult>(changeParams(changeNextCursor));
   setChangeItems(previous=>[...previous,...data.items]);
   setChangeNextCursor(data.nextCursor);
  }catch(cause){setError(cause instanceof Error?cause.message:t('加载更多失败。','Could not load more.'));}
  finally{setChangeMoreLoading(false);}
 }
 async function loadMore(){
  if(!nextCursor||loading||moreLoading)return;
  setMoreLoading(true);setError('');
  try{
   const result=await api<Result>(params(nextCursor));
   setItems(previous=>[...previous,...result.items]);
   setNextCursor(result.nextCursor);
  }catch(cause){setError(cause instanceof Error?cause.message:t('加载更多失败。','Could not load more.'));}
  finally{setMoreLoading(false);}
 }
 const sourceName=(value:Usage['source'])=>({
  subscription:t('订阅日额度','Subscription allowance'),
  free:t('免费额度','Free credits'),
  paid:t('永久付费额度','Permanent credits'),
  unknown:t('历史未归属','Unattributed legacy')
 })[value];
 const day=(time:number)=>new Date(time).toLocaleString(language==='zh'?'zh-CN':'en-US');
 return <Card data-testid="admin-unified-usage-ledger">
  <CardHeader className="space-y-3">
   <CardTitle>{t('统一使用与权益流水','Unified usage and entitlement activity')}</CardTitle>
   <div className="flex flex-wrap gap-2" role="group" aria-label={t('流水视图','Ledger view')}>
    <Button type="button" size="sm" variant={mode==='usage'?'default':'outline'} onClick={()=>setMode('usage')}>{t('AI 生成消费','AI delivery usage')}</Button>
    <Button type="button" size="sm" variant={mode==='changes'?'default':'outline'} onClick={()=>setMode('changes')}>{t('全部权益流水','All entitlement activity')}</Button>
   </div>
  </CardHeader>
  <CardContent className="space-y-4">
   {mode==='usage'?<>
    <p className="text-xs text-muted-foreground">{t('统一显示订阅、免费和永久额度的已确认 AI 交付。仅 ACK 成功计一次；预留、失败和购买本身不计为生成消费。默认显示最近30天。','Includes acknowledged AI deliveries funded by subscriptions, free or permanent credits. One ACK is one generation; reservations, failures and purchases are excluded. Last 30 days by default.')}</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();setQuery(search.trim());}}>
     <label className="min-w-40 flex-1 space-y-1 text-xs">{t('扣次来源','Consumption source')}
      <select className="block h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label={t('扣次来源','Consumption source')} value={source} onChange={event=>setSource(event.target.value as Source)}>
       <option value="all">{t('所有来源','All sources')}</option>
       <option value="subscription">{t('订阅','Subscription')}</option>
       <option value="free">{t('免费','Free')}</option>
       <option value="paid">{t('永久付费','Permanent paid')}</option>
       <option value="unknown">{t('历史未知','Legacy unknown')}</option>
      </select>
     </label>
     <label className="min-w-48 flex-[2] space-y-1 text-xs">{t('精确用户 ID 或邮箱','Exact user ID or email')}
      <Input aria-label={t('精确用户 ID 或邮箱','Exact user ID or email')} value={search} maxLength={120} onChange={event=>setSearch(event.target.value)} placeholder={t('不填显示所有用户','Blank for all users')} />
     </label>
     <Button type="submit" variant="outline" disabled={loading}>{t('查询','Search')}</Button>
     <Button type="button" variant="outline" disabled={loading} onClick={()=>setNonce(x=>x+1)}>{t('刷新','Refresh')}</Button>
    </form>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading?<p role="status" className="py-6 text-sm">{t('正在读取消费记录…','Loading usage…')}</p>:
     <div className="data-table-wrap admin-list-scroll" role="region" tabIndex={0} aria-label={t('AI 消费记录','AI usage records')}>
      <Table className="min-w-[1020px]">
       <TableHeader><TableRow>
        {[t('交付时间','Delivered'),t('用户','User'),t('扣次来源','Source'),t('模型','Model'),t('Token','Tokens'),t('估算成本 USD','Est. cost USD'),t('请求 ID','Request ID')].map(label=><TableHead key={label}>{label}</TableHead>)}
       </TableRow></TableHeader>
       <TableBody>{items.map(row=><TableRow key={row.user_id+':'+row.request_id}>
        <TableCell className="whitespace-nowrap text-xs">{day(row.created_at)}</TableCell>
        <TableCell><span className="break-all text-sm">{row.email}</span></TableCell>
        <TableCell><strong className="text-sm">{sourceName(row.source)}</strong>
         {row.source==='subscription'&&row.period_plan&&<div className="text-xs text-muted-foreground">{row.period_plan.toUpperCase()} · {t('当前周期','Current period')}</div>}
         {row.source_evidence==='legacy_request'&&<div className="text-xs text-muted-foreground">{t('历史请求归属','Legacy request attribution')}</div>}
        </TableCell>
        <TableCell className="text-xs">{row.model||'—'}</TableCell>
        <TableCell className="tabular-nums text-xs">{row.input_tokens==null&&row.output_tokens==null?'—':String(row.input_tokens??0)+' / '+String(row.output_tokens??0)}</TableCell>
        <TableCell className="tabular-nums text-xs">{row.estimated_cost_micro_usd==null?'—':(row.estimated_cost_micro_usd/1000000).toFixed(5)}</TableCell>
        <TableCell className="max-w-48 break-all font-mono text-xs">{row.request_id}</TableCell>
       </TableRow>)}</TableBody>
      </Table>
     </div>}
    {!loading&&!items.length&&!error&&<p role="status" className="text-sm text-muted-foreground">{t('当前条件下没有已确认的生成消费。','No acknowledged usage for this selection.')}</p>}
    {nextCursor&&<Button type="button" variant="outline" disabled={loading||moreLoading} onClick={()=>void loadMore()}>{moreLoading?t('加载中…','Loading…'):t('加载更多','Load more')}</Button>}
   </>:<>
    <p className="text-xs text-muted-foreground">{t('合并免费、永久付费和订阅流水，展示订阅订单、成功扣次及失败释放。临时预占记录已隐藏，不影响后台审计；订阅每日上限不算永久额度。默认最近30天。','Combines free, permanent and subscription order, consumption, and failed-release events. Temporary reservation rows are hidden, but retained in the audit trail. Daily subscription allowance is not a permanent grant. Last 30 days by default.')}</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();setChangeQuery(changeSearch.trim());}}>
     <label className="min-w-36 flex-1 space-y-1 text-xs">{t('权益来源','Entitlement source')}
      <select className="block h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label={t('权益来源','Entitlement source')} value={changeSource} onChange={event=>setChangeSource(event.target.value as EntitlementSource)}>
       <option value="all">{t('全部','All')}</option>
       <option value="subscription">{t('订阅','Subscription')}</option>
       <option value="free">{t('免费额度','Free credits')}</option>
       <option value="paid">{t('永久付费额度','Permanent credits')}</option>
       <option value="mixed">{t('免费及永久混合','Mixed credits')}</option>
       <option value="unknown">{t('未归属（零变动）','Unattributed / zero-delta')}</option>
      </select>
     </label>
     <label className="min-w-24 space-y-1 text-xs">{t('时间范围','Date range')}
      <select className="block h-9 w-full rounded-md border bg-background px-2 text-sm" value={changeDays} onChange={event=>setChangeDays(Number(event.target.value))} aria-label={t('时间范围','Date range')}>
       <option value={30}>{t('最近30天','Last 30 days')}</option>
       <option value={90}>{t('最近90天','Last 90 days')}</option>
       <option value={366}>{t('最近一年','Last year')}</option>
      </select>
     </label>
     <label className="min-w-48 flex-[2] space-y-1 text-xs">{t('精确用户 ID 或邮箱','Exact user ID or email')}
      <Input aria-label={t('权益流水用户查询','Search entitlement activity user')} value={changeSearch} maxLength={120} onChange={event=>setChangeSearch(event.target.value)} placeholder={t('不填显示所有用户','Blank for all users')} />
     </label>
     <Button type="submit" variant="outline" disabled={changeLoading}>{t('查询','Search')}</Button>
     <Button type="button" variant="outline" disabled={changeLoading} onClick={()=>{setChangeAnchor(Date.now());setNonce(x=>x+1);}}>{t('刷新','Refresh')}</Button>
    </form>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {changeLoading?<p role="status" className="text-sm">{t('正在读取全部权益流水…','Loading entitlement activity…')}</p>:
    <div className="data-table-wrap admin-list-scroll" role="region" tabIndex={0} aria-label={t('全部权益流水记录','All entitlement activity records')}>
     <Table className="min-w-[1200px]"><TableHeader><TableRow>
      {[t('事件时间','Time'),t('用户','User'),t('来源','Source'),t('事件','Event'),t('免费变动','Free delta'),t('永久付费变动','Paid delta'),t('订阅日额度','Subscription daily'),t('方案 / 订单 / 原因','Plan / order / detail')].map(x=><TableHead key={x}>{x}</TableHead>)}
     </TableRow></TableHeader><TableBody>{changeItems.map(row=>{
      const name=({
       signup_grant:t('新人赠额','Signup grant'),
       generation_debit:t('AI 消耗','AI debit'),
       generation_refund:t('失败退还','Generation refund'),
       generation_release:t('预留释放','Reservation release'),
       purchase_grant:t('购买到账','Purchase grant'),
       purchase_reversal:t('退款撤销','Purchase reversal'),
       admin_adjustment:t('人工调额','Manual adjustment'),
       subscription_purchase:t('订阅开通入账','Subscription purchase applied'),
       subscription_renewal:t('订阅续费入账','Subscription renewal applied'),
       subscription_upgrade:t('订阅升级入账','Subscription upgrade applied'),
       subscription_consume:t('订阅 AI 成功扣次','Subscription AI consumed'),
       subscription_release:t('订阅失败释放预占','Subscription reservation released'),
       subscription_refund:t('订阅退款记录','Subscription refund record')
      } as Record<string,string>)[row.event_type]||row.event_type;
      const category=({
       subscription:t('订阅','Subscription'),free:t('免费额度','Free'),
       paid:t('永久付费','Permanent'),mixed:t('混合额度','Mixed'),
       unknown:t('未归属','Unattributed')
      })[row.source];
      const subscriptionValue=row.event_type==='subscription_release'?t('释放预占（未扣）','Reservation released (not debited)'):
       row.event_type==='subscription_consume'?'−1':
       row.event_type.startsWith('subscription_')&&row.daily_limit!=null?t('每日上限 ','Daily limit ')+row.daily_limit:'—';
      return <TableRow key={row.id}>
       <TableCell className="whitespace-nowrap text-xs">{day(row.occurred_at)}</TableCell>
       <TableCell className="break-all text-xs">{row.email}</TableCell>
       <TableCell className="whitespace-nowrap text-xs">{category}</TableCell>
       <TableCell className="text-xs">{name}</TableCell>
       <TableCell className="tabular-nums">{row.source==='subscription'?'—':row.free_delta}</TableCell>
       <TableCell className="tabular-nums">{row.source==='subscription'?'—':row.paid_delta}</TableCell>
       <TableCell className="whitespace-nowrap text-xs">{subscriptionValue}</TableCell>
       <TableCell className="max-w-[24rem] break-all text-xs">
        {row.plan_code&&<span className="font-semibold">{row.plan_code.toUpperCase()} · </span>}
        {row.amount_fen!=null&&<span>{t('订单金额 ¥','Order ¥')}{(row.amount_fen/100).toFixed(2)} · </span>}
        {row.order_status&&<span>{row.order_status} · </span>}
        {row.reason&&<span>{row.reason} · </span>}
        <span className="font-mono text-muted-foreground">{row.reference_id||'—'}</span>
       </TableCell>
      </TableRow>;
     })}</TableBody></Table>
    </div>}
    {!changeLoading&&!changeItems.length&&!error&&<p role="status" className="text-sm text-muted-foreground">{t('当前条件下没有权益流水记录。','No entitlement activity for this selection.')}</p>}
    {changeNextCursor&&<Button type="button" variant="outline" disabled={changeLoading||changeMoreLoading} onClick={()=>void loadMoreChanges()}>{changeMoreLoading?t('加载中…','Loading…'):t('加载更多','Load more')}</Button>}
   </>}
  </CardContent>
 </Card>;
}
