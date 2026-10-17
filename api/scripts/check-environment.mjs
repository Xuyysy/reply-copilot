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
  if(env.vars.AI_MODE!==(selected==="staging"?"mock":"production"))errors.push("AI_MODE must start in the approved safe mode");
  if(env.vars.PAYMENTS_ENABLED!=="0")errors.push("PAYMENTS_ENABLED must stay disabled until a separate payment launch approval");
  if(env.vars.PAYMENT_PROVIDER!=="xiaodou")errors.push("PAYMENT_PROVIDER must explicitly identify the configured provider");
  if(env.vars.ADMIN_PORTAL_ENABLED!=="0")errors.push("ADMIN_PORTAL_ENABLED must stay closed for initial deployment");
  if(selected==="staging"&&(!Number.isInteger(Number(env.vars.SITE_DAILY_CAP))||Number(env.vars.SITE_DAILY_CAP)>10))errors.push("Staging SITE_DAILY_CAP must be at most 10");
  if(env.workers_dev!==false)errors.push("workers_dev must remain disabled");
}
if(errors.length){for(const error of errors)console.error(`✗ ${error}`);process.exitCode=1;}
else console.log(`${selected} configuration is structurally ready; verify remote resource ownership, secrets, DNS and migration state separately before deployment.`);
