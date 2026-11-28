// Ledger synchronization is a bounded authenticated reconciliation, not a
// settlement decision. Keep its exact server contract; never add a stale reason.
export function adminOperationPayload(path:string,body:object,fallbackReason:string){
 const b=body as {sync?:unknown;userId?:unknown;reason?:string};
 if(path==="/v1/admin/partners/manual-report"&&b.sync===true&&Object.keys(body).sort().join(",")==="sync,userId"&&typeof b.userId==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(b.userId))return {payload:{sync:true,userId:b.userId},valid:true};
 const reason=b.reason||fallbackReason;
 return {payload:{...body,reason},valid:reason.trim().length>=8};
}
