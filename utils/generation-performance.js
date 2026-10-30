// Shared by isolated content scripts, the extension worker and the API Worker.
// Disabled by default. No identifier, text or arbitrary error is accepted.
(() => {
  const marks = new Set(['reply_click','editor_bound','precheck_complete','background_dispatch','background_return','candidates_shown','insert_started','editor_verified']);
  const durations = new Set(['precheck','background_prepare','history_context','router_account','owner_check','delivery_storage','cloud_generate','ack','local_bookkeeping','account_label','background_total','worker_prepare','worker_reserve','dns','model','worker_finish','worker_total']);
  const outcomes = new Set(['success','failed','cancelled','incomplete']);
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3_600_000;
  const clean = (values, allowed) => Object.fromEntries(Object.entries(values || {}).filter(([key,value]) => allowed.has(key) && valid(value)).map(([key,value])=>[key,Math.round(value*100)/100]));
  const sanitize = sample => sample && outcomes.has(sample.outcome) && valid(sample.elapsedMs) ? {
    outcome:sample.outcome,marks:clean(sample.marks,marks),durations:clean(sample.durations,durations),elapsedMs:Math.round(sample.elapsedMs*100)/100,
  } : null;
  function createTrace({enabled=false,now=()=>performance.now(),startAt=null}={}) {
    const observed=enabled?now():0;
    const start=typeof startAt==='number'&&Number.isFinite(startAt)&&startAt>=0&&startAt<=observed?startAt:observed, points={},spans={};
    return {
      enabled,
      mark(name,at=null){if(enabled&&marks.has(name)&&points[name]===undefined)points[name]=Math.max(0,(typeof at==='number'&&Number.isFinite(at)?at:now())-start);},
      addDurations(values){if(enabled)for(const [key,value] of Object.entries(clean(values,durations)))spans[key]=(spans[key]||0)+value;},
      async measure(name,fn){
        if(!enabled||!durations.has(name))return fn();
        const at=now();try{return await fn();}finally{const ms=now()-at;if(valid(ms))spans[name]=(spans[name]||0)+ms;}
      },
      snapshot(outcome='incomplete'){return enabled?sanitize({outcome,marks:points,durations:spans,elapsedMs:Math.max(0,now()-start)}):null;},
    };
  }
  function summarize(values) {
    const sorted=values.filter(valid).sort((a,b)=>a-b),n=sorted.length;
    if(!n)return null;
    const q=p=>sorted[Math.max(0,Math.ceil(n*p)-1)];
    return {n,mean:Math.round(sorted.reduce((a,b)=>a+b,0)/n*100)/100,p50:q(.5),p90:q(.9),p95:q(.95)};
  }
  function createCollector({limit=100}={}) {
    const samples=[],max=Math.min(500,Math.max(1,Number.isSafeInteger(limit)?limit:100));
    return {
      record(value){const sample=sanitize(value);if(sample){samples.push(sample);if(samples.length>max)samples.shift();}},
      clear(){samples.length=0;},
      report(){
        const metrics={},counts={},group={};
        for(const sample of samples){
          counts[sample.outcome]=(counts[sample.outcome]||0)+1;
          // Failures are counted, never mixed into success latency percentiles.
          if(sample.outcome!=='success')continue;
          const derived={};
          for(const [key,from,to] of [['reply_to_bind','reply_click','editor_bound'],['bind_to_precheck','editor_bound','precheck_complete'],['dispatch_to_return','background_dispatch','background_return'],['return_to_candidates','background_return','candidates_shown'],['insert_verification','insert_started','editor_verified']]) {
            if(valid(sample.marks[from])&&valid(sample.marks[to])&&sample.marks[to]>=sample.marks[from])derived[key]=sample.marks[to]-sample.marks[from];
          }
          for(const [key,value] of Object.entries({...sample.marks,...sample.durations,...derived,elapsedMs:sample.elapsedMs}))(group[key]||=[]).push(value);
        }
        for(const [key,values] of Object.entries(group))metrics[key]=summarize(values);
        return {samples:samples.length,outcomes:counts,metrics};
      },
    };
  }
  globalThis.ReplyCopilotPerformance=Object.freeze({createTrace,createCollector,summarize});
})();
