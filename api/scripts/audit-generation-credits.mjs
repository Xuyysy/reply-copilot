import {DatabaseSync} from 'node:sqlite';
import {chmodSync,writeFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {runCreditAudit,auditOptions} from './lib/credit-audit.mjs';

// Deliberately accepts a LOCAL SQLite path only. No --remote, environment,
// Worker token, database UUID or API URL can execute a remote query here.
export async function main(argv=process.argv.slice(2)){
 const {values}=parseArgs({args:argv,options:{database:{type:'string'},since:{type:'string'},until:{type:'string'},limit:{type:'string'},pages:{type:'string'},'rows-read-budget':{type:'string'},'confirm-expanded-window':{type:'boolean'},'report-file':{type:'string'}}});
 if(!values.database||/^[a-z][a-z0-9+.-]*:\/\//i.test(values.database)||/^[a-f0-9-]{36}$/i.test(values.database))throw new Error('Provide an existing local SQLite export copy with --database');
 const number=(key)=>values[key]===undefined?undefined:Number(values[key]);
 const options={since:number('since'),until:number('until'),limit:number('limit'),pages:number('pages'),rowsReadBudget:number('rows-read-budget'),confirmExpandedWindow:values['confirm-expanded-window']};
 auditOptions(options); // Reject unsafe ranges BEFORE opening the database.
 const filename=realpathSync(values.database),db=new DatabaseSync(filename,{readOnly:true});
 try{
  const adapter={prepare(sql){let args=[];return{bind(...v){args=v;return this},async all(){return{success:true,results:db.prepare(sql).all(...args)}}}}};
  const report=await runCreditAudit(adapter,options);
  // Cursors identify users/requests: keep them in a private file, never stdout.
  if(values['report-file']){writeFileSync(values['report-file'],JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});chmodSync(values['report-file'],0o600);}
  const {nextCursor,...safe}=report;
  console.log(JSON.stringify({...safe,hasNextPage:Boolean(nextCursor)},null,2));
  return report;
 }finally{db.close()}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(()=>{console.error('Audit refused or failed. Check local database, bounds and private report destination. No changes were made.');process.exitCode=1;});
