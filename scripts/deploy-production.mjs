// Preparation is local. --worker / --pages are ONLY for a separately authorized release.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(args,cwd=root)=>execFileSync(args[0],args.slice(1),{cwd,stdio:'inherit'});
try { run([process.execPath,'scripts/production-preflight.mjs']); } catch (error) { process.exit(Number.isInteger(error.status) ? error.status : 1); }
const action=process.argv[2]||'--check';
if(action==='--check')process.exit(0);
if(!['--worker','--pages'].includes(action))throw new Error('Use --check, --worker or --pages');
if(process.env.CONFIRM_PRODUCTION_RELEASE!=='reply-copilot-api-production')throw new Error('Separate Production release authorization required; set explicit target confirmation only after approval');
if(action==='--worker'){
 run(['npm','run','typecheck'],path.join(root,'api'));
 run(['npx','--no-install','wrangler','deploy','--config','deploy/production.wrangler.json','--keep-vars','--dry-run'],path.join(root,'api'));
 run(['npx','--no-install','wrangler','deploy','--config','deploy/production.wrangler.json','--keep-vars'],path.join(root,'api'));
}else{
 if(!process.env.PUBLIC_TURNSTILE_SITE_KEY)throw new Error('A verified Production Turnstile public site key is required');
 run(['npm','run','build:production'],path.join(root,'web')); // Validate before building and verify the generated API origin.
 const {readFileSync}=await import('node:fs');
 const files=execFileSync('find',['dist','-type','f','-name','*.js'],{cwd:path.join(root,'web'),encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const content=files.map(f=>readFileSync(path.join(root,'web',f),'utf8')).join('\n');
 if(process.env.PUBLIC_API_BASE_URL!=='https://api.x-reply-helper.top'||content.includes('api-staging.x-reply-helper.top'))throw new Error('Pages must use verified Production API');
 run(['npx','--no-install','wrangler','pages','deploy',path.join(root,'web/dist'),'--project-name','x-reply-helper-production','--branch','main'],path.join(root,'api'));
}
