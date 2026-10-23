import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extensionIdentity } from './extension-identity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const website='https://app.x-reply-helper.top',api='https://api.x-reply-helper.top';
export function auditStorePackage(manifest,runtime){
 if(manifest.manifest_version!==3)throw new Error('Store package requires MV3');
 if(JSON.stringify(manifest.host_permissions)!==JSON.stringify([api+'/*']))throw new Error('Unexpected API permission');
 if((manifest.permissions||[]).some(p=>['<all_urls>','webRequest','cookies'].includes(p)))throw new Error('Unexpected permission');
 for(const expected of ['production',website,api])if(!runtime.includes(expected))throw new Error('Missing production runtime destination');
 if(/staging|localhost|127\.0\.0\.1|example\.invalid/i.test(runtime))throw new Error('Non-production runtime destination');
}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 execFileSync(process.execPath,['scripts/build.js','production'],{cwd:root,env:{...process.env,REPLY_COPILOT_WEBSITE_URL:website,REPLY_COPILOT_API_URL:api},stdio:'inherit'});
 const folder=path.join(root,'dist/production'),manifest=JSON.parse(readFileSync(path.join(folder,'manifest.json')));
 const store=JSON.parse(readFileSync(path.join(root,'config/extension-store-identity.json')));
 if(extensionIdentity(manifest.key,store.id).key!==store.publicKey)throw new Error('Store public key changed');
 auditStorePackage(manifest,readFileSync(path.join(folder,'config/runtime.js'),'utf8'));
 const files=walk(folder);
 for(const file of files){
  if(/\.(pem|env|map|sql)$|secrets|node_modules|\.git\//i.test(path.relative(folder,file)))throw new Error('Forbidden packaged file');
  if(/\.(js|html|json|css)$/.test(file)&&/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|(?:XIAODOU_EPAY_KEY|DEEPSEEK_API_KEY)\s*[:=]/.test(readFileSync(file,'utf8')))throw new Error('Potential credential in artifact');
 }
 const release=path.join(root,'dist/release');mkdirSync(release,{recursive:true});
 const productionPackage=process.argv.includes('--production');
 const zip=path.join(release,productionPackage?`reply-copilot-production-${manifest.version}.zip`:`reply-copilot-store-DRAFT-${manifest.version}.zip`);
 // zip never includes source files outside the production artifact.
 execFileSync('python3',['-c','import os,sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for base,dirs,files in os.walk(sys.argv[1]):\n  for name in sorted(files):\n   p=os.path.join(base,name);z.write(p,os.path.relpath(p,sys.argv[1]))',folder,zip]);
 execFileSync('unzip',['-t',zip],{stdio:'ignore'});
 const hashes=Object.fromEntries(files.map(f=>[path.relative(folder,f),createHash('sha256').update(readFileSync(f)).digest('hex')]));
 const report={status:productionPackage?'PRODUCTION_IDENTITY_BOUND_NOT_READY_TO_PUBLISH':'DRAFT_ONLY_NOT_READY_TO_PUBLISH',builtAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:true,website,api,version:manifest.version,extensionId:store.id,identityBound:Boolean(manifest.key),files:files.length,zip:path.basename(zip),sha256:createHash('sha256').update(readFileSync(zip)).digest('hex'),hashes};
 writeFileSync(path.join(release,productionPackage?'production-package-audit.json':'store-draft-audit.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,hashes:undefined},null,2));
}
