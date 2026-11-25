// Synthetic-only ephemeral Worker tail. Never print raw frames, URLs, headers, or tokens.
import {validAccount} from './cf-free-cloud-cpu-evidence.mjs';
import WebSocket from 'ws';
const NAME='xrh-cf-free-cpu-pilot-20261120';
const ROUNDS=[10000,60000,100000,210000];
const MODES=['http','do'];
const OUTCOMES=['ok','exception','exceededCpu','exceededMemory','canceled','unknown','scriptNotFound','responseStreamDisconnected'];
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function sanitizeTailEvent(event){
  if(!event||event.scriptName!==NAME||!Array.isArray(event.logs))return null;
  const marker=event.logs.map(l=>l?.message).find(m=>Array.isArray(m)&&m.length===3&&m[0]==='XRH_PILOT_CPU'&&['http','do','do_rpc'].includes(m[1])&&ROUNDS.includes(m[2]));
  if(!marker)return null;
  const cpu=finite(event.cpuTime)?event.cpuTime:finite(event.cpuTimeMs)?event.cpuTimeMs:null;
  const wall=finite(event.wallTime)?event.wallTime:finite(event.wallTimeMs)?event.wallTimeMs:null;
  return {mode:marker[1],rounds:marker[2],cpuMs:cpu,wallMs:wall,outcome:OUTCOMES.includes(event.outcome)?event.outcome:'unknown',entrypoint:event.entrypoint==='PasswordVerifierDO'?'PasswordVerifierDO':null};
}
export function summarizeTail(rows){
  const groups=[];
  for(const mode of ['http','do','do_rpc'])for(const rounds of ROUNDS){
    const selected=rows.filter(x=>x.mode===mode&&x.rounds===rounds);
    const values=selected.map(x=>x.cpuMs).filter(finite).sort((a,b)=>a-b);
    if(selected.length)groups.push({mode,rounds,events:selected.length,cpuSamples:values.length,maxCpuMs:values.at(-1)??null,p95CpuMs:values[Math.ceil(values.length*.95)-1]??null});
  }
  return {kind:'ISOLATED_LIVE_TAIL_CPU',status:groups.some(x=>x.cpuSamples>0)?'CPU_FIELDS_OBSERVED_NOT_CERTIFIED':groups.length?'EVENTS_WITHOUT_CPU_FIELDS':'NO_MATCHED_EVENTS',groups,freeCertified:false};
}
export async function openPilotTail({accountId,token,fetchImpl=fetch,WebSocketImpl=WebSocket}){
  if(!validAccount(accountId)||typeof token!=='string'||token.length<20)throw Error('TAIL_TARGET_REJECTED');
  const endpoint='https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'+NAME+'/tails';
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  let tailId=null,ws=null;
  const rows=[];
  async function close(){
    // Match Wrangler's ws transport and bound local socket lifetime.
    try{if(typeof ws?.terminate==='function')ws.terminate();else ws?.close();}catch{}
    if(tailId){
      const r=await fetchImpl(endpoint+'/'+tailId,{method:'DELETE',redirect:'error',headers,signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw Error('TAIL_DELETE_FAILED');
      tailId=null;
    }
  }
  try{
    const r=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers,body:JSON.stringify({filters:[]}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('TAIL_HTTP_'+r.status);
    const body=await r.json(),result=body?.result;
    if(body.success!==true||! /^[a-f0-9]{32}$/i.test(result?.id??''))throw Error('TAIL_INVALID_RESPONSE');
    tailId=result.id;
    const url=new URL(result.url);
    if(url.protocol!=='wss:'||url.username||url.password||url.port)throw Error('TAIL_INVALID_WEBSOCKET');
    // Cloudflare issued a transient WebSocket URL; never forward the API token.
    ws=new WebSocketImpl(url.toString(),'trace-v1');
    ws.addEventListener('message',e=>{
      const data=typeof e.data==='string'?e.data:Buffer.isBuffer(e.data)?e.data.toString('utf8'):null;
      if(rows.length>=128||!data||data.length>256000)return;
      try{const parsed=JSON.parse(data);for(const raw of (Array.isArray(parsed)?parsed:[parsed])){if(rows.length>=128)break;const row=sanitizeTailEvent(raw);if(row)rows.push(row);}}catch{}
    });
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('TAIL_CONNECT_TIMEOUT')),10000);
      ws.addEventListener('open',()=>{clearTimeout(timer);try{const message=JSON.stringify({debug:false});if(typeof ws.terminate==='function')ws.send(message,{binary:false,compress:false,mask:false,fin:true});else ws.send(message);resolve();}catch{reject(Error('TAIL_CONNECT_FAILED'));}},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('TAIL_CONNECT_FAILED'));},{once:true});
    });
    return {close,report:()=>summarizeTail(rows)};
  }catch(e){try{await close();}catch{throw Error('TAIL_OPEN_AND_CLEANUP_FAILED');}throw Error(/^[A-Z0-9_]{3,80}$/.test(e?.message??'')?e.message:'TAIL_OPEN_FAILED');}
}
