import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function productionBlockers(config,staging){
 const errors=[],v=config.vars||{},db=config.d1_databases?.[0];
 const store=JSON.parse(readFileSync(path.join(root,'config/extension-store-identity.json')));
 if(config.name!=='reply-copilot-api-production'||v.ENVIRONMENT!=='production')errors.push('Wrong Production Worker identity');
 if(!db||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db.database_id||'')||/^00000000-/.test(db.database_id)||db.database_id===staging.d1_databases[0].database_id)errors.push('Verified isolated Production D1 UUID is missing');
 if(v.EXTENSION_ORIGIN!=='chrome-extension://'+store.id)errors.push('Chrome Web Store Extension ID is missing');
 if(v.PAYMENT_PROVIDER!=='xiaodou'||v.PAYMENTS_ENABLED!=='0')errors.push('Production must use the RSA2 provider with the environment purchase ceiling closed until merchant credentials and channel approval are verified');
 if(v.XIAODOU_WEBHOOKS_ENABLED!=='1')errors.push('Production payment notifications must remain available for verified existing orders');
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
