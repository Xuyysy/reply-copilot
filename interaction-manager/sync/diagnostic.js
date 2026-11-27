// Strict allowlist: no owner, URL, cursor, credentials, raw response, or error text.
const STAGES=new Set(['connect','identity','checkpoint','read','validate','commit']);
const CODES=new Set(['cancelled','time_limit','identity_changed','unauthenticated','forbidden','rate_limited','source_error','source_unavailable','response_mismatch','invalid_response','invalid_pagination','schema_changed','page_limit','cursor_cycle','stale_session','stale_checkpoint','history_limit','invalid_job','invalid_checkpoint','open_notifications','owner_unverified','endpoint_not_observed','owner_mismatch','session_limit','invalid_cursor','ambiguous_cursor','terminal_unverified','workspace_limit','sync_failed']);
export function safeSyncDiagnostic(stage,reason,status=null){
 return {stage:STAGES.has(stage)?stage:'read',reason:CODES.has(reason)?reason:'sync_failed',httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null};
}
export function diagnosticSummary(task){
 const format=(source,d)=>{const v=safeSyncDiagnostic(d.stage,d.reason,d.httpStatus);return source+' | '+v.stage+' | '+v.reason+' | HTTP '+(v.httpStatus??'unknown');};
 const lines=[];
 if(task?.diagnostic)lines.push(format('task',task.diagnostic));
 if(Array.isArray(task?.sources))for(const s of task.sources){if(['notification','post'].includes(s?.source)&&s.diagnostic)lines.push(format(s.source,s.diagnostic));}
 return lines.join('\n');
}
