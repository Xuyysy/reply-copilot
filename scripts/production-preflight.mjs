import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Source-level safe-off: runtime Cloudflare authorization and D1 migrations
// require their own owner approvals and are never performed by this script.
export const BOLTUTIL_PRODUCTION_SOURCE_OFF_KEYS=Object.freeze([
 'BOLTUTIL_ENABLED','BOLTUTIL_SCHEMA_READY','BOLTUTIL_STAGING_CREATE_ENABLED',
 'BOLTUTIL_PRODUCTION_CREATE_ENABLED','BOLTUTIL_TRC20_ENABLED',
 'BOLTUTIL_POLYGON_ENABLED','BOLTUTIL_BEP20_ENABLED',
 'BOLTUTIL_ERC20_ENABLED','BOLTUTIL_SOLANA_ENABLED'
]);
export function productionBlockers(config,staging){
 const errors=[],v=config.vars||{},db=config.d1_databases?.[0];
 const store=JSON.parse(readFileSync(path.join(root,'config/extension-store-identity.json')));
 if(config.name!=='reply-copilot-api-production'||v.ENVIRONMENT!=='production')errors.push('Wrong Production Worker identity');
 if(!db||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db.database_id||'')||/^00000000-/.test(db.database_id)||db.database_id===staging.d1_databases[0].database_id)errors.push('Verified isolated Production D1 UUID is missing');
 if(v.EXTENSION_ORIGIN!=='chrome-extension://'+store.id)errors.push('Chrome Web Store Extension ID is missing');
 if(v.PAYMENTS_ENABLED!=='1'||v.ADMIN_PORTAL_ENABLED!=='1')errors.push('Production must preserve enabled payments and administrator access');
 if(v.XIAODOU_WEBHOOKS_ENABLED!=='1')errors.push('Production payment notifications must remain available for verified existing orders');
 for(const key of BOLTUTIL_PRODUCTION_SOURCE_OFF_KEYS)
  if(v[key]==='1')errors.push('Production source cannot activate USDT without separate approval: '+key);
 for(const key of ['BOLTUTIL_API_KEY','BOLTUTIL_WEBHOOK_SECRET','BOLTUTIL_CNY_PER_USDT_MICROS',
   'BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED','BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED',
   'BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS'])
  if(Object.hasOwn(v,key))errors.push('Version-controlled Production vars cannot include merchant secrets or FX: '+key);
 if(v.AI_MODE!=='production'||!(Number(v.DEEPSEEK_INPUT_USD_PER_MILLION)>0)||!(Number(v.DEEPSEEK_OUTPUT_USD_PER_MILLION)>0))errors.push('Real AI mode and conservative pricing required');
 for(const k of ['WEB_ORIGIN','API_ORIGIN']){try{const u=new URL(v[k]);if(u.protocol!=='https:'||u.origin!==v[k]||v[k]===staging.vars[k]||/staging|\.invalid/.test(u.hostname))throw new Error();}catch{errors.push('Invalid Production '+k);}}
 if(config.observability?.logs?.invocation_logs!==false||config.observability?.redact_query_string!==true)errors.push('Payment callback query logging must be redacted and invocation logs disabled');
 if(config.services?.length||config.kv_namespaces?.length)errors.push('Unexpected business binding');
 return errors;
}
export function verifyFreshMigrations(){
 const db=new DatabaseSync(':memory:');const names=readdirSync(path.join(root,'api/migrations')).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();
 try{
  for(const name of names)db.exec(readFileSync(path.join(root,'api/migrations',name),'utf8'));
  const count=table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
  for(const t of ['users','recharge_orders','credit_ledger','credit_batches','site_administrator','provider_payment_events'])if(count(t)!==0)throw new Error('Fresh Production contains business data: '+t);
  const buying=db.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get();
  if(buying?.value!=='0')throw new Error('Fresh Production purchasing is not closed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign-key integrity failure');
  return {migrationCount:names.length,names,integrity:db.prepare('PRAGMA integrity_check').get(),businessTablesEmpty:true,purchaseEnabled:false,defaultBudgetMicroUsd:db.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").get().value};
 }finally{db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=JSON.parse(readFileSync(path.join(root,'api/deploy/production.wrangler.json'))),staging=JSON.parse(readFileSync(path.join(root,'api/wrangler.jsonc'))).env.staging;
 console.log(JSON.stringify({localMigrations:verifyFreshMigrations(),blockers:productionBlockers(config,staging),remoteOperationsExecuted:false},null,2));
 if(productionBlockers(config,staging).length)process.exitCode=2;
}
