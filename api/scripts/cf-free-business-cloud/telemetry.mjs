// Fail-closed join of structured case markers and official invocation logs.
const validCpu=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const validCase=v=>typeof v==='string'&&/^case-[1-9]\d{0,3}$/.test(v);
export function correlateInvocationLogs(events,{script,version,cases}){
 const known=new Set(cases.map(c=>c.id)),byRequest=new Map(),ambiguous=new Set(),cron=[],samples=[],warnings=[];
 for(const e of events){
  const m=e?.$metadata,w=e?.$workers;
  if(!m||!w||m.service!==script||w.scriptName!==script)continue;
  const id=m.requestId??w.requestId;
  if(typeof id!=='string'||!id||m.requestId&&w.requestId&&m.requestId!==w.requestId)continue;
  if(w.scriptVersion?.id!==version)continue;
  const g=byRequest.get(id)??{markers:[],invocations:[]};byRequest.set(id,g);
  // Workers Observability currently returns structured console.log fields in
  // source (verified on the isolated v6 deployment). Older shapes are retained.
  const candidates=[e,e.source,e.body].filter(x=>x&&typeof x==='object');
  const caseValues=[...new Set(candidates.map(x=>x.xrhAcceptanceCase).filter(x=>x!==undefined))];
  const cronValues=[...new Set(candidates.map(x=>x.xrhAcceptanceCron).filter(x=>x!==undefined))];
  if(caseValues.length>1||cronValues.length>1||(caseValues.length&&cronValues.length)){g.invalid=true;continue;}
  const marker=caseValues[0],scheduled=cronValues[0];
  if(validCase(marker)&&known.has(marker))g.markers.push({kind:'case',value:marker});
  if(Number.isSafeInteger(scheduled)&&scheduled>0)g.markers.push({kind:'cron',value:scheduled});
  if(validCpu(w.cpuTimeMs)&&typeof w.outcome==='string')g.invocations.push({cpuMs:w.cpuTimeMs,outcome:['ok','exception','exceededCpu','exceededMemory'].includes(w.outcome)?w.outcome:'other',eventType:w.eventType});
 }
 const matched=new Map(),scheduleMap=new Map();
 for(const g of byRequest.values()){
  if(g.invalid||g.markers.length!==1||g.invocations.length!==1)continue;
  const m=g.markers[0],v=g.invocations[0],a=m.kind==='case'?matched:scheduleMap;
  if(m.kind==='case'&&v.eventType!=='fetch'||m.kind==='cron'&&!['cron','scheduled'].includes(v.eventType))continue;
  const key=m.kind+':'+m.value;
  if(a.has(m.value)){ambiguous.add(key);continue;}a.set(m.value,{...v});
 }
 for(const [id,v] of matched)if(!ambiguous.has('case:'+id))samples.push({id,cpuMs:v.cpuMs,outcome:v.outcome});
 for(const [scheduledTime,v] of scheduleMap)if(!ambiguous.has('cron:'+scheduledTime))cron.push({scheduledTime,cpuMs:v.cpuMs,outcome:v.outcome});
 if(ambiguous.size)warnings.push('AMBIGUOUS_INVOCATION_ASSOCIATIONS');
 return {samples,cron,warnings};
}
