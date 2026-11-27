// Strict allowlist: no owner, URL, cursor, credentials, raw response, or error text.
const STAGES=new Set(['connect','identity','checkpoint','read','validate','commit']);
const ROUTES=new Set(['rest','graphql','search']);
const READ_PHASES=new Set(['prepare','request','response','body','decode','project','validate']);
const CODES=new Set(['cancelled','time_limit','identity_changed','unauthenticated','forbidden','rate_limited','source_error','source_unavailable','response_mismatch','invalid_response','invalid_pagination','schema_changed','page_limit','cursor_cycle','stale_session','stale_checkpoint','history_limit','invalid_job','invalid_checkpoint','open_notifications','owner_unverified','endpoint_not_observed','owner_mismatch','session_limit','invalid_cursor','ambiguous_cursor','terminal_unverified','workspace_limit','sync_failed']);
export function safeSyncDiagnostic(stage,reason,status=null,detail=null){
 const safeStage=STAGES.has(stage)?stage:'read';
 const base={stage:safeStage,reason:CODES.has(reason)?reason:'sync_failed',httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null};
 // The only persisted source metadata is two bounded enums; never raw body/URL.
 return safeStage==='read'&&ROUTES.has(detail?.routeKind)&&READ_PHASES.has(detail?.readPhase)?{...base,routeKind:detail.routeKind,readPhase:detail.readPhase}:base;
}
export function diagnosticSummary(task){
 const format=(source,d)=>{const v=safeSyncDiagnostic(d.stage,d.reason,d.httpStatus,d);return source+' | '+v.stage+' | '+v.reason+' | HTTP '+(v.httpStatus??'unknown')+(v.routeKind?' | '+v.routeKind+' | '+v.readPhase:'');};
 const lines=[];
 if(task?.diagnostic)lines.push(format('task',task.diagnostic));
 if(Array.isArray(task?.sources))for(const s of task.sources){if(['notification','post'].includes(s?.source)&&s.diagnostic)lines.push(format(s.source,s.diagnostic));}
 return lines.join('\n');
}
