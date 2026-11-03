import type {Env} from './types';

// Non-realtime historical counters only. Auth, balance, active model, settings,
// costs and the shared budget are ALWAYS read fresh by adminDashboard.
const TTL_MS=30_000;
type History={users:number;verifiedUsers:number;todayUsers:number;newUsers7d:number;totalFreeGranted:number;
  paidCreditsSpent:number;totalIssued:number;totalUsed:number;paidUsers:number;successfulOrders:number;
  totalRevenueFen:number;revenue7dFen:number};
const cache=new WeakMap<D1Database,{at:number;day:string;value:Promise<History>}>();
let isolate:string|undefined;
function diagnose(env:Env,status:'hit'|'miss'|'failed',ageMs:number){
 if(env.ENVIRONMENT!=='staging'||env.AI_PERFORMANCE_DIAGNOSTICS!=='1')return;
 isolate??=crypto.randomUUID();
 console.log({event:'admin_history_cache',isolate,status,ageMs:Math.max(0,ageMs),ttlMs:TTL_MS});
}
export async function adminHistoricalStats(env:Env,now:number,day:string):Promise<History>{
 const old=cache.get(env.DB);
 if(old&&old.day===day&&now>=old.at&&now-old.at<TTL_MS){diagnose(env,'hit',now-old.at);return old.value;}
 diagnose(env,'miss',old?now-old.at:0);
 const value=(async()=>{
  const [users,grants,ledger,orders]=await Promise.all([
   env.DB.prepare(`SELECT COUNT(*) users,
    COALESCE(SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END),0) verifiedUsers,
    COALESCE(SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END),0) todayUsers,
    COALESCE(SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END),0) newUsers7d FROM users`).bind(Date.parse(day+'T00:00:00Z'),now-7*86400000).first(),
   env.DB.prepare('SELECT COALESCE(SUM(amount),0) totalFreeGranted FROM credit_grants').first(),
   env.DB.prepare(`SELECT COALESCE(-SUM(CASE WHEN kind='generation_debit' THEN paid_delta ELSE 0 END),0) paidCreditsSpent,
    COALESCE(SUM(CASE WHEN free_delta>0 THEN free_delta ELSE 0 END+CASE WHEN paid_delta>0 THEN paid_delta ELSE 0 END),0) totalIssued,
    COALESCE(-SUM(CASE WHEN kind='generation_debit' THEN free_delta+paid_delta ELSE 0 END),0) totalUsed FROM credit_ledger`).first(),
   env.DB.prepare(`SELECT COUNT(DISTINCT o.user_id) paidUsers,COUNT(*) successfulOrders,
    COALESCE(SUM(t.amount_fen),0) totalRevenueFen,
    COALESCE(SUM(CASE WHEN o.paid_at>=? THEN t.amount_fen ELSE 0 END),0) revenue7dFen
    FROM recharge_orders o LEFT JOIN payment_transactions t ON t.order_id=o.id WHERE o.credited_at IS NOT NULL`).bind(now-7*86400000).first(),
  ]);
  return {...users,...grants,...ledger,...orders} as History;
 })();
 const entry={at:now,day,value};cache.set(env.DB,entry);
 try{return await value;}catch(error){if(cache.get(env.DB)===entry)cache.delete(env.DB);diagnose(env,'failed',0);throw error;}
}
