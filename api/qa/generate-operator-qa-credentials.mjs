// Run manually on the operator's computer, NOT in CI or in the hosted Worker.
// Generates only local files; never calls Cloudflare, GitHub or any network.
// Keep output outside the repository and delete after secure configuration.
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
const dir=resolve(process.argv[2]||join(homedir(),'partners-qa-private-'+Date.now()));
mkdirSync(dir,{mode:0o700}); // refuse to overwrite any existing directory
const put=(name,data)=>writeFileSync(join(dir,name),data,{mode:0o600,flag:'wx'});
const secret=()=>randomBytes(32).toString('hex');
const gate=secret(),pepper=secret();
const ids=['qa-admin','qa-partner-a','qa-buyer-b','qa-buyer-c','qa-outsider-d','qa-excluded-e','qa-partner-f'];
const accounts=ids.map(id=>({id,email:id+'@example.test',password:secret()}));
const guard="(SELECT COUNT(*) FROM qa_schema_migrations)=33 AND (SELECT COUNT(*) FROM users)=7 AND NOT EXISTS(SELECT 1 FROM partner_commissions) AND NOT EXISTS(SELECT 1 FROM sessions) AND NOT EXISTS(SELECT 1 FROM system_settings WHERE key LIKE 'partner_%_enabled' AND value<>'0')";
const sql=accounts.map(({id,email,password})=>{
 const salt=randomBytes(16),hash=pbkdf2Sync(password+'\u0000'+pepper,salt,100000,32,'sha256').toString('hex');
 return "UPDATE users SET password_hash='pbkdf2-sha256:100000:"+salt.toString('hex')+":"+hash+"' WHERE id='"+id+"' AND email='"+email+"' AND password_hash IS NULL AND "+guard+";";
}).join('\n');
put('QA_ACCESS_SECRET.txt',gate);
put('PASSWORD_PEPPER.txt',pepper);
put('PARTNERS_QA_CREDENTIALS.json',JSON.stringify({access:gate,accounts}));
put('initialize-qa-only.sql',"-- ONLY reply-copilot-partners-qa-20261125 / 22f7a8f1-28c1-42ad-a69d-54ee8bc7e5dc. Never shared Staging or production.\n"+sql+"\nSELECT COUNT(*) AS initialized_qa_profiles FROM users WHERE id LIKE 'qa-%' AND password_hash IS NOT NULL;\n");
console.log('Created private QA configuration files at '+dir+' (no secrets printed; no remote changes).');
