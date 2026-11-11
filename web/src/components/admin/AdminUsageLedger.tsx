import {useEffect,useState} from 'react';
import type {Language} from '../../lib/language';
import {phrase} from '../../lib/language';
import {api} from '../../lib/api';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '../ui/table';

type LegacyLedger={id:string;email:string;kind:string;free_delta:number;paid_delta:number;reason:string|null;created_at:number};
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
 const [legacyLedger,setLegacyLedger]=useState<LegacyLedger[]>([]);
 const [legacyLoading,setLegacyLoading]=useState(false);
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
 useEffect(()=>{
  if(!active||mode!=='changes')return;
  let mounted=true;setLegacyLoading(true);setError('');
  void api<{ledger:LegacyLedger[]}>('/v1/admin/ledger').then(data=>{if(mounted)setLegacyLedger(data.ledger);})
   .catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:t('读取额度变动失败。','Unable to load credit changes.'));})
   .finally(()=>{if(mounted)setLegacyLoading(false);});
  return()=>{mounted=false;};
 },[active,mode,nonce]);
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
 const eventName=(kind:string)=>({
  signup_grant:t('新人赠额','Signup grant'),generation_debit:t('AI 消耗','AI debit'),
  generation_refund:t('失败退还','Generation refund'),generation_release:t('预留释放','Reservation release'),
  purchase_grant:t('购买到账','Purchase grant'),purchase_reversal:t('退款撤销','Purchase reversal'),
  admin_adjustment:t('人工调额','Manual adjustment')
 } as Record<string,string>)[kind]||kind;
 const day=(time:number)=>new Date(time).toLocaleString(language==='zh'?'zh-CN':'en-US');
 return <Card data-testid="admin-unified-usage-ledger">
  <CardHeader className="space-y-3">
   <CardTitle>{t('统一使用与权益流水','Unified usage and entitlement activity')}</CardTitle>
   <div className="flex flex-wrap gap-2" role="group" aria-label={t('流水视图','Ledger view')}>
    <Button type="button" size="sm" variant={mode==='usage'?'default':'outline'} onClick={()=>setMode('usage')}>{t('AI 生成消费','AI delivery usage')}</Button>
    <Button type="button" size="sm" variant={mode==='changes'?'default':'outline'} onClick={()=>setMode('changes')}>{t('额度变动','Credit adjustments & grants')}</Button>
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
    <p className="text-xs text-muted-foreground">{t('保留原信用账本的授予、扣减、返还、调整与退款审计。订阅不作为永久额度发放，此视图不会混入订阅消费。','Original credit grants, debits, reversals, refunds and adjustments remain auditable. Subscription usage is not a permanent credit grant.')}</p>
    {legacyLoading&&<p role="status" className="text-sm">{t("正在读取原额度流水…","Loading credit history…")}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="max-h-[36rem] overflow-auto rounded-md border" role="region" tabIndex={0}>
     <Table className="min-w-[800px]"><TableHeader><TableRow>
      {[t('时间','Time'),t('用户','User'),t('事件','Event'),t('免费变动','Free delta'),t('永久付费变动','Paid delta'),t('原因','Reason')].map(x=><TableHead key={x}>{x}</TableHead>)}
     </TableRow></TableHeader><TableBody>{legacyLedger.map(row=><TableRow key={row.id}>
      <TableCell className="whitespace-nowrap text-xs">{day(row.created_at)}</TableCell><TableCell className="break-all text-xs">{row.email}</TableCell><TableCell className="text-xs">{eventName(row.kind)}</TableCell>
      <TableCell className="tabular-nums">{row.free_delta}</TableCell><TableCell className="tabular-nums">{row.paid_delta}</TableCell><TableCell className="text-xs">{row.reason||'—'}</TableCell>
     </TableRow>)}</TableBody></Table>
    </div>
    {!legacyLedger.length&&<p role="status" className="text-sm text-muted-foreground">{t('暂无额度变动。','No credit changes.')}</p>}
   </>}
  </CardContent>
 </Card>;
}
