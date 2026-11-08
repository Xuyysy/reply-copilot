import {useEffect,useState} from 'react';
import {validateMomentumConfig} from '../../../../domain/creator-momentum.js';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Card,CardContent,CardHeader,CardTitle} from '../ui/card';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '../ui/tabs';

type Props = {
 language:string;active:boolean;busy:boolean;
 read:<T>(path:string)=>Promise<T>;
 write:<T>(path:string,body:object)=>Promise<T>;
 confirm:(title:string,description:string,action:()=>Promise<void>)=>void;
};
type TabKey='strategy'|'content'|'preview'|'history';
type Locale='Zh'|'En';
const LOW_RANGES=[[1,2],[3,4],[5,6]];
const SECTIONS=[
 {key:'overview',zh:'当前机制',en:'Current mechanism',limit:6000},
 {key:'research',zh:'技术说明与研究进展',en:'Technology and research',limit:6000},
 {key:'title',zh:'提醒标题',en:'Reminder heading',limit:120},
 {key:'body',zh:'提醒正文',en:'Reminder message',limit:6000}
] as const;

export default function CreatorFeaturesPanel({language,active,busy,read,write,confirm}:Props){
 const t=(zh:string,en:string)=>language==='en'?en:zh;
 const [config,setConfig]=useState<any>(null);
 const [isStaging,setIsStaging]=useState(false);
 const [published,setPublished]=useState<any>(null);
 const [versions,setVersions]=useState<Array<{id:string;createdAt:number}>>([]);
 const [section,setSection]=useState<TabKey>('strategy');
 const [locale,setLocale]=useState<Locale>(language==='en'?'En':'Zh');
 const [stage,setStage]=useState(1);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function load(){
  try{
   const r=await read<{config:any;versions:Array<{id:string;createdAt:number}>;simulationAvailable?:boolean}>('/v1/admin/creator-momentum');
   setIsStaging(r.simulationAvailable===true);
   setConfig(r.config);
   setPublished(r.config);
   setVersions(r.versions||[]);
   setError('');
  }catch(e){setError(e instanceof Error?e.message:t('读取失败','Could not load'));}
 }
 useEffect(()=>{if(active)void load();},[active]);
 const update=(key:string,value:any)=>{setConfig((old:any)=>({...old,[key]:value}));setNotice('');setError('');};
 const dirty=Boolean(config&&published&&JSON.stringify(config)!==JSON.stringify(published));
 const low=Boolean(config?.ranges?.[0]?.[0]<=10);
 const status=published?.enabled?t('当前已启用','Live: enabled'):t('当前已暂停','Live: paused');
 function save(){
  try{
   const next=validateMomentumConfig(config);
   const warning=next.ranges[0][0]<=10
    ?t('注意：当前为低阈值区间。这是全局配置，可能在下一自然日向所有符合条件且开启监测的付费用户触发提醒。请仅在隔离 Staging 环境验收，完成后恢复策略。','Warning: low thresholds apply globally to eligible opted-in customers from the next local day. Test in isolated Staging and restore afterwards.')
    :'';
   confirm(t('确认发布互动势能配置','Publish momentum configuration'),
    t('付费资格不变。文案和暂停状态将在插件刷新权益后生效；阶段阈值及每日上限由每天首次计数固定，当日不会重算。','Paid eligibility is unchanged. Copy/pause updates on entitlement refresh; thresholds and daily cap are pinned by the first local count of the day.')
    +' '+warning,
    async()=>{await write('/v1/admin/creator-momentum',{config:next,expectedVersion:published.version});await load();setNotice(t('新版本保存成功；等待插件刷新权益。','New version saved; extension refresh required.'));});
  }catch{setError(t('配置不合法：三个区间须递增、不重叠；每日提醒上限为 1–3，所有中英文文案不能为空。','Invalid configuration: three ascending non-overlapping ranges, limit 1–3, and nonempty bilingual content required.'));}
 }
 function setRange(stageIndex:number,index:number,value:number){
  setConfig((old:any)=>({...old,ranges:old.ranges.map((range:number[],i:number)=>i===stageIndex?range.map((n,j)=>j===index?value:n):range)}));
  setError('');setNotice('');
 }
 function setLowPreset(){
  setConfig((old:any)=>({...old,ranges:LOW_RANGES.map(range=>[...range]),maxReminders:3}));
  setNotice(t('仅已填入草稿，尚未发布。请先检查测试环境，再点击保存并确认。','Draft only. Verify your test environment before publishing.'));
  setSection('strategy');
 }
 function resetDraft(){
  setConfig(published);
  setError('');
  setNotice(t('已恢复为服务端已保存版本。','Reverted to the last saved version.'));
 }
 const visible=(key:string)=>String(config?.[key+locale]||'');
 const ranges=config?.ranges as number[][]|undefined;
 return <Card className="min-w-0">
  <CardHeader className="space-y-3">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="space-y-1"><CardTitle>{t('互动势能运营控制台','Interaction Momentum Console')}</CardTitle>
     <p className="text-sm text-muted-foreground">{t('配置 PRO 提醒策略、展示文案与版本。插件不会在侧边栏生成 AI 回复。','Manage PRO reminder policy, customer copy and versions. The sidebar never generates replies.')}</p></div>
    <div className="flex flex-wrap gap-2 text-xs">
     <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">PRO · {status}</span>
     {isStaging&&<span className="rounded-full border px-3 py-1.5 text-xs">Staging</span>}
     {dirty&&<span role="status" className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('有未发布修改','Unsaved draft')}</span>}
    </div>
   </div>
   <p className="text-xs text-muted-foreground break-all">{t('服务端配置版本','Published version')}: {published?.version||'—'}</p>
  </CardHeader>
  <CardContent className="min-w-0 space-y-5">
   {error&&<p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
   {notice&&<p role="status" className="rounded-lg border bg-muted/50 p-3 text-sm">{notice}</p>}
   {!config?<Button variant="outline" onClick={()=>void load()}>{t('重新读取配置','Reload configuration')}</Button>:<>
    <div className="grid gap-2 sm:grid-cols-3">
     <div className="rounded-xl border bg-muted/30 p-3"><div className="text-xs text-muted-foreground">{t('有效权益','Eligibility')}</div><strong className="mt-1 block text-sm">{t('已购买用户（固定）','Purchased PRO only')}</strong></div>
     <div className="rounded-xl border bg-muted/30 p-3"><div className="text-xs text-muted-foreground">{t('提醒机制','Trigger')}</div><strong className="mt-1 block text-sm">{t('三阶段 · 回复前提醒','3 stages · before reply')}</strong></div>
     <div className="rounded-xl border bg-muted/30 p-3"><div className="text-xs text-muted-foreground">{t('参数生效方式','Policy updates')}</div><strong className="mt-1 block text-sm">{t('当天策略固定 · 次日更新','Pinned per day')}</strong></div>
    </div>
    <Tabs value={section} onValueChange={v=>setSection(v as TabKey)} className="min-w-0 gap-4">
     <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
      <TabsTrigger value="strategy" className="min-w-0">{t('策略配置','Strategy')}</TabsTrigger>
      <TabsTrigger value="content" className="min-w-0">{t('文案管理','Content')}</TabsTrigger>
      <TabsTrigger value="preview" className="min-w-0">{t('效果预览','Preview')}</TabsTrigger>
      <TabsTrigger value="history" className="min-w-0">{t('版本记录','History')}</TabsTrigger>
     </TabsList>
     <TabsContent value="strategy" className="space-y-4">
      <div className="rounded-xl border p-4 sm:p-5 space-y-3">
       <div><h3 className="font-semibold">{t('提醒启用状态','Reminder availability')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('全局暂停不停止本机 ACK 计数。用户仍须符合付费资格并自行开启监测。','Global pause does not halt local ACK counts. Purchase proof and personal opt-in still apply.')}</p></div>
       <label className="flex items-center gap-3 text-sm font-medium">
        <input aria-label={t('全局开启提醒','Globally enable reminders')} type="checkbox" checked={config.enabled===true} onChange={e=>update('enabled',e.target.checked)} disabled={busy} className="size-5 accent-blue-600"/>
        {t('全局开启提醒','Globally enable reminders')}
       </label>
      </div>
      <div className="rounded-xl border p-4 sm:p-5 space-y-4">
       <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold">{t('三阶段触发区间','Three trigger ranges')}</h3>
         <p className="mt-1 text-xs text-muted-foreground">{t('次数指本机当日 ACK 确认的 AI 生成，而不是已发送的 X 评论。','Counts are local daily ACK-confirmed generations, not posted X replies.')}</p></div>
        {isStaging&&<Button data-testid="momentum-low-preset" type="button" variant="outline" size="sm" disabled={busy} onClick={setLowPreset}>{t('填入低阈值验收区间','Fill low-range test draft')}</Button>}
       </div>
       <div className="grid gap-3">
        {ranges?.map((range,i)=><div key={i} className="grid min-w-0 items-end gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
         <strong className="text-sm">{t('阶段','Stage')} {i+1}</strong>
         {[0,1].map(j=><label key={j} className="block min-w-0 text-xs text-muted-foreground">{j===0?t('下限','Minimum'):t('上限','Maximum')}
          <Input aria-label={(language==='en'?'Stage ':'阶段 ')+(i+1)+(j===0?(language==='en'?' minimum':' 下限'):(language==='en'?' maximum':' 上限'))} type="number" inputMode="numeric" min={1} max={1000000} step={1} value={range[j]} onChange={e=>setRange(i,j,Number(e.target.value))} disabled={busy} className="mt-1 min-w-0 bg-background text-foreground"/>
         </label>)}
        </div>)}
       </div>
       {low&&<p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('低阈值风险：这是全局策略，不是单账号模拟。只建议在 Staging 使用，验收后恢复常规区间。','Low range warning: this is a global policy, not an account-specific simulation. Use Staging and restore afterwards.')}</p>}
       <p className="text-xs text-muted-foreground">{t('当天首次有效计数会固定区间；修改后不回算今天已存在的计数。','First valid local count pins the day policy. Saving new ranges does not recalculate an existing day.')}</p>
       <label className="block max-w-sm text-sm font-medium">{t('每天最多提醒次数（1–3）','Daily reminder cap (1–3)')}
        <Input aria-label={t('每天最多提醒次数（1–3）','Daily reminder cap (1–3)')} type="number" min={1} max={3} step={1} value={config.maxReminders} onChange={e=>update('maxReminders',Number(e.target.value))} disabled={busy} className="mt-2"/>
       </label>
      </div>
     </TabsContent>
     <TabsContent value="content" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
       <div><h3 className="font-semibold">{t('插件介绍及提醒文案','Product descriptions and reminders')}</h3><p className="text-xs text-muted-foreground">{t('直接编辑插件读取的服务端文案。必须保留中英文有效内容。','Edit server-driven extension copy. Both languages must be nonempty.')}</p></div>
       <div className="flex gap-2" role="group" aria-label={t('文案语言','Copy language')}>
        <Button type="button" size="sm" variant={locale==='Zh'?'default':'outline'} onClick={()=>setLocale('Zh')}>中文</Button>
        <Button type="button" size="sm" variant={locale==='En'?'default':'outline'} onClick={()=>setLocale('En')}>English</Button>
       </div>
      </div>
      <fieldset disabled={busy} className="space-y-4">
       {SECTIONS.map(section=><label key={section.key} className="block min-w-0 rounded-xl border p-4">
        <span className="flex justify-between gap-2 text-sm font-semibold">{language==='en'?section.en:section.zh}<span className="text-xs font-normal text-muted-foreground">{visible(section.key).length}/{section.limit}</span></span>
        <textarea aria-label={(language==='en'?section.en:section.zh)+' · '+locale} className="mt-2 block min-h-24 w-full min-w-0 resize-y rounded-lg border bg-background p-3 text-sm leading-relaxed" rows={section.key==='title'?2:5} maxLength={section.limit}
         value={visible(section.key)} onChange={e=>update(section.key+locale,e.target.value)}/>
       </label>)}
      </fieldset>
     </TabsContent>
     <TabsContent value="preview" className="space-y-4">
      <div><h3 className="font-semibold">{t('发布前预览','Preview before publishing')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('实时显示当前草稿；不触发 AI，不修改本机计数或提醒记录。','Preview the current draft. No AI, local count, or reminder record changes.')}</p></div>
      <div className="flex flex-wrap items-center gap-2">
       <div className="flex gap-2" role="group" aria-label={t('预览语言','Preview language')}>
        <Button size="sm" type="button" variant={locale==='Zh'?'default':'outline'} onClick={()=>setLocale('Zh')}>中文</Button>
        <Button size="sm" type="button" variant={locale==='En'?'default':'outline'} onClick={()=>setLocale('En')}>English</Button>
       </div>
       <div className="flex gap-2" role="group" aria-label={t('预览阶段','Preview stage')}>{[1,2,3].map(n=><Button key={n} size="sm" type="button" variant={n===stage?'default':'outline'} onClick={()=>setStage(n)}>{t('阶段','Stage')} {n}</Button>)}</div>
      </div>
      <section aria-label={t('创作者功能预览','Creator feature preview')} data-testid="momentum-draft-preview" className="grid gap-4 lg:grid-cols-2">
       <div className="min-w-0 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 text-slate-900 dark:border-blue-800 dark:from-slate-900 dark:to-slate-950 dark:text-slate-100">
        <div className="flex items-center justify-between text-xs font-bold tracking-wide text-blue-700 dark:text-blue-300"><span>CREATOR MOMENTUM</span><span>PRO</span></div>
        <div className="my-4 grid grid-cols-3 gap-2" aria-hidden="true">{[1,2,3].map(n=><div key={n} className={'h-1.5 rounded-full '+(n<=stage?'bg-blue-600':'bg-blue-200 dark:bg-slate-700')}/>)}</div>
        <p className="text-xs text-blue-700 dark:text-blue-300">{t('阶段','Stage')} {stage}</p>
        <h4 className="mt-3 break-words text-lg font-semibold">{visible('title')}</h4>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{visible('body')}</p>
        <p className="mt-5 text-xs text-muted-foreground">{t('此处为管理后台预览，不会触发真正的回复门控。','Admin-only visual preview; no actual reply gate is triggered.')}</p>
       </div>
       <div className="min-w-0 rounded-2xl border bg-card p-5">
        <h4 className="font-semibold">{t('查看完整介绍','Full introduction')}</h4>
        <div className="mt-4 space-y-3 text-sm leading-relaxed">
         <strong>{t('当前机制','Current mechanism')}</strong><p className="whitespace-pre-wrap break-words">{visible('overview')}</p>
         <strong>{t('后续研究规划','Research roadmap')}</strong><p className="whitespace-pre-wrap break-words">{visible('research')}</p>
        </div>
       </div>
      </section>
     </TabsContent>
     <TabsContent value="history" className="space-y-4">
      <div><h3 className="font-semibold">{t('版本记录与回滚','Version history and rollback')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('每次恢复都会生成新的审计版本，不更改 AI、订单或额度。','Restoration creates a new audited version; AI, orders and credits are unchanged.')}</p></div>
      <div className="space-y-2">{versions.filter(v=>v.id!==published.version).length===0&&<p className="text-sm text-muted-foreground">{t('暂无其他历史版本','No other historical versions')}</p>}
       {versions.filter(v=>v.id!==published.version).map(v=><div key={v.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0"><code className="block break-all text-xs">{v.id}</code><p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString(language==='en'?'en-US':'zh-CN')}</p></div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>confirm(t('回滚创作者功能配置','Roll back creator configuration'),t('恢复将覆盖当前服务端策略并生成新的审计版本。确认继续？','Restoration replaces the published configuration and creates a new audited version. Continue?'),async()=>{await write('/v1/admin/creator-momentum/restore',{versionId:v.id,expectedVersion:published.version});await load();setNotice(t('历史配置已恢复。','History restored.'));})}>{t('恢复此版本','Restore version')}</Button>
       </div>)}
      </div>
     </TabsContent>
    </Tabs>
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur">
     <Button type="button" disabled={busy||!dirty} onClick={save}>{t('保存并确认发布','Save and confirm')}</Button>
     <Button type="button" variant="outline" disabled={busy||!dirty} onClick={resetDraft}>{t('放弃未保存修改','Discard changes')}</Button>
     <Button type="button" variant="ghost" disabled={busy} onClick={()=>{if(dirty){confirm(t('放弃未保存修改？','Discard unsaved draft?'),t('刷新将重新读取服务端配置，当前未保存修改会丢失。','Reloading will discard your draft.'),load);}else void load();}}>{t('刷新服务端配置','Refresh')}</Button>
     <span className="text-xs text-muted-foreground">{dirty?t('尚未发布','Not published'):t('已与服务端同步','Synced')}</span>
    </div>
   </>}
  </CardContent>
 </Card>;
}
