import {useEffect,useRef,useState} from 'react';
import {api} from '../../lib/api';
import {phrase,type Language} from '../../lib/language';
import {Button} from '../ui/button';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';

type State={localDiagnostics:{enabled:boolean;expiresAt:number|null}};
type Write=<T,>(path:string,body:object)=>Promise<T>;
export default function SupportDiagnosticsPanel({userId,language,write}:{userId:string;language:Language;write:Write}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const path='/v1/admin/users/'+encodeURIComponent(userId)+'/support-features';
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [hours,setHours]=useState(24),[reason,setReason]=useState('');
 const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function load(){
  setBusy(true);setError('');
  try{const result=await api<State>(path);if(live.current)setState(result);}
  catch{if(live.current){setState(null);setError(t('读取失败，请重试。','Could not load; retry.'));}}
  finally{if(live.current)setBusy(false);}
 }
 async function change(enabled:boolean){
  if(busy||reason.trim().length<8)return;
  if(!window.confirm(enabled?t('确认向当前用户限时开放故障诊断？','Enable diagnostics for this user temporarily?'):t('确认撤销当前用户的诊断入口？','Revoke diagnostics for this user?')))return;
  setBusy(true);setError('');
  try{const result=await write<State>(path,{enabled,...(enabled?{hours}:{}),reason:reason.trim()});if(live.current){setState(result);setReason('');}}
  catch(cause){if(live.current){setState(null);setError(cause instanceof Error?cause.message:t('操作未确认，请重新查询。','Operation unconfirmed; reload.'));}}
  finally{if(live.current)setBusy(false);}
 }
 const enabled=state?.localDiagnostics.enabled===true;
 return <Card data-testid="admin-support-diagnostics"><CardHeader><CardTitle>{t('定向故障诊断','Targeted diagnostics')}</CardTitle></CardHeader><CardContent className="space-y-3">
  <p className="text-sm text-muted-foreground">{t('仅开放本机诊断入口，不会上传报告或控制用户浏览器。默认关闭，到期自动失效。','Enables a local diagnostic panel only. No report uploads or remote browser control. Off by default; expires automatically.')}</p>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  <Button variant="outline" type="button" disabled={busy} onClick={()=>void load()}>{state?t('刷新授权状态','Refresh access'):t('查询授权状态','Check access')}</Button>
  {state&&<>
   <p role="status" className="text-sm">{enabled?t('已开启，有效期至：','Enabled until: ')+new Date(state.localDiagnostics.expiresAt!).toLocaleString():t('未开启','Disabled')}</p>
   <label className="block text-sm">{t('授权时长','Duration')}<select className="ml-2 rounded border p-2" value={hours} disabled={busy} onChange={e=>setHours(Number(e.target.value))}><option value={24}>24h</option><option value={72}>72h</option><option value={168}>7d</option></select></label>
   <label className="block text-sm">{t('操作原因（至少8字）','Reason (min. 8 characters)')}<textarea className="mt-1 block w-full rounded border p-2" maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||reason.trim().length<8} onClick={()=>void change(true)}>{enabled?t('续期','Renew'):t('开启诊断','Enable')}</Button><Button variant="outline" type="button" disabled={busy||!enabled||reason.trim().length<8} onClick={()=>void change(false)}>{t('撤销','Revoke')}</Button></div>
  </>}
 </CardContent></Card>;
}
