import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(path.join(root,"wrangler.jsonc"),"utf8"));
const selected=process.argv[2];
if(!["staging","production"].includes(selected))throw new Error("Specify staging or production");
const env=config.env?.[selected];
const other=config.env?.[selected==="staging"?"production":"staging"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors=[];
const db=env?.d1_databases?.[0],otherDb=other?.d1_databases?.[0];
if(!env||!db||!otherDb)errors.push("Missing named environment or D1 binding");
else {
  if(env.vars?.ENVIRONMENT!==selected)errors.push("ENVIRONMENT does not match the selected environment");
  if(env.name===other.name||db.database_name===otherDb.database_name||db.database_id===otherDb.database_id||db.database_id===config.d1_databases?.[0]?.database_id)errors.push("Worker/D1 names and IDs must be distinct");
  if(!uuid.test(db.database_id)||/^00000000-/.test(db.database_id))errors.push("Replace placeholder D1 database_id with the verified remote ID");
  for(const field of ["WEB_ORIGIN","API_ORIGIN"]){const value=env.vars?.[field];try{const url=new URL(value);if(url.protocol!=="https:"||url.origin!==value||url.hostname.endsWith(".invalid")||url.hostname==="localhost")throw new Error();}catch{errors.push(`${field} must be a real HTTPS origin`);}}
  if(env.vars.WEB_ORIGIN===env.vars.API_ORIGIN)errors.push("WEB_ORIGIN and API_ORIGIN must be separate hosts");
  for(const field of ["WEB_ORIGIN","API_ORIGIN","EXTENSION_ORIGIN"])if(env.vars?.[field]===other.vars?.[field])errors.push(`${field} must differ from the other environment`);
  if(!/^chrome-extension:\/\/[a-p]{32}$/.test(env.vars?.EXTENSION_ORIGIN||""))errors.push("EXTENSION_ORIGIN must be the exact installed Chrome extension origin");
  if(env.vars.AI_MODE!=="production")errors.push("AI_MODE must start in the approved safe mode");
  if(selected==="production"?env.vars.PAYMENTS_ENABLED!=="0":!["0","1"].includes(env.vars.PAYMENTS_ENABLED))errors.push("Production payment ceiling must remain closed; Staging needs an explicit ceiling and separately verified database purchase control");
  if(!["xiaodou","xiaodou_epay"].includes(env.vars.PAYMENT_PROVIDER))errors.push("PAYMENT_PROVIDER must explicitly identify the configured provider");
  if(selected==="production"?env.vars.ADMIN_PORTAL_ENABLED!=="0":!["0","1"].includes(env.vars.ADMIN_PORTAL_ENABLED))errors.push("Production admin must remain closed; Staging requires an explicit boolean admin setting");
  if(selected==="staging"&&env.vars.XIAODOU_NETWORK_DIAGNOSTIC_ENABLED!=="0")errors.push("Staging network diagnostics must be disabled by default");
  if(env.workers_dev!==false)errors.push("workers_dev must remain disabled");
}
if(errors.length){for(const error of errors)console.error(`✗ ${error}`);process.exitCode=1;}
else console.log(`${selected} configuration is structurally ready; verify remote resource ownership, secrets, DNS and migration state separately before deployment.`);
