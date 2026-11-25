import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,pbkdf2Sync} from 'node:crypto';
import {readFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
const api=fileURLToPath(new URL('../',import.meta.url));
const root=resolve(api,'prototypes/cf-free-private-verifier');
const artifact=readFileSync(resolve(root,'src/legacy-210k.wasm'));
const sha='2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838';
const hash=(password,pepper,n=210000)=>'pbkdf2-sha256:'+n+':'+('ab'.repeat(16))+':'+pbkdf2Sync(password+'\0'+pepper,Buffer.alloc(16,0xab),n,32,'sha256').toString('hex');
const entry=buildSync({entryPoints:[resolve(root,'src/index.ts')],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','./legacy-210k.wasm']}).outputFiles[0].text;
const name='xrh-private-verifier-local';
const caller='xrh-private-verifier-rpc-harness';
function manifest(contents,wasm=false){return {mainModule:'index.js',modules:{'index.js':{type:'esm',contents},...(wasm?{'legacy-210k.wasm':{type:'wasm',contents:new Uint8Array(artifact)}}:{})}};}
async function fixture(pepper){
 let outbound=0;
 const deny=()=>{outbound++;throw Error('External network denied');};
 const code='export default {async fetch(r,e){try{const b=await r.json(),s=e.V.getByName("synthetic");return Response.json({value:b.op==="hash"?await s.hash(b.password,b.rounds):await s.verify(b.password,b.stored)})}catch{return Response.json({error:"UNAVAILABLE"},{status:503})}}}';
 const mf=new Miniflare({workers:[
  {config:{name:caller,compatibilityDate:'2026-10-14',env:{V:{type:'durable-object',worker:name,exportName:'PasswordVerifierDO'}},manifest:manifest(code)},dev:{outboundService:{type:'fetcher',handler:deny}}},
  {config:{name,compatibilityDate:'2026-10-14',env:pepper===undefined?{}:{PASSWORD_PEPPER:{type:'text',value:pepper}},manifest:manifest(entry,true),exports:{PasswordVerifierDO:{type:'durable-object',storage:'sqlite'}}},dev:{outboundService:{type:'fetcher',handler:deny}}}
 ]});
 return {mf,external:()=>outbound,call:async b=>{const r=await mf.dispatchFetch('https://local.example.test/',{method:'POST',body:JSON.stringify(b)});return {status:r.status,...await r.json()};}};
}
test('private configuration and exact artifact are credential-free, with public access disabled',()=>{
 const cfg=JSON.parse(readFileSync(resolve(root,'wrangler.candidate.jsonc'),'utf8'));
 assert.deepEqual(cfg,{name:'xrh-password-verifier-offline-candidate',main:'./src/index.ts',compatibility_date:'2026-10-14',workers_dev:false,preview_urls:false,observability:{enabled:false},durable_objects:{bindings:[{name:'PASSWORD_VERIFY_DO',class_name:'PasswordVerifierDO'}]},migrations:[{tag:'private-verifier-v1',new_sqlite_classes:['PasswordVerifierDO']}]});
 assert.equal(createHash('sha256').update(artifact).digest('hex'),sha);
 assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(artifact)).length,0);
 assert.doesNotMatch(entry,/XRH_PILOT_CPU|xrh-cf-free-isolated-probe|\/__pilot/);
});
test('actual private DO: native and RustCrypto factors, malformed inputs, long UTF-8 keys and fresh salt',{timeout:120000},async()=>{
 let vectors=0;
 for(const [pepper,passwords] of [
  ['synthetic-pepper-'.repeat(2),['ordinary passphrase','漢'.repeat(256),'🙂'.repeat(128),'a'.repeat(256),'\ud800'+'z'.repeat(12)]],
  ['p'.repeat(1024),['ordinary passphrase','漢'.repeat(256)]],
  ['p'.repeat(255),['漢'.repeat(256)]], // exactly 1024 bytes including NUL
  ['p'.repeat(256),['漢'.repeat(256)]] // 1025 bytes
 ]){
  const f=await fixture(pepper);try{
   for(const password of passwords){
    const stored=hash(password,pepper);
    assert.deepEqual(await f.call({password,stored}),{status:200,value:true});
    assert.deepEqual(await f.call({password:'incorrect',stored}),{status:200,value:false});
    vectors+=2;
   }
   const pw='ordinary passphrase';
   for(const rounds of [10000,60000,100000]){
    const r=await f.call({password:pw,stored:hash(pw,pepper,rounds)});
    assert.deepEqual(r,{status:200,value:true});
    const h=await f.call({op:'hash',password:pw,rounds});
    assert.equal(h.status,200);const [,factor,salt,digest]=h.value.split(':');
    assert.equal(Number(factor),rounds);
    assert.equal(digest,pbkdf2Sync(pw+'\0'+pepper,Buffer.from(salt,'hex'),rounds,32,'sha256').toString('hex'));
    assert.notEqual((await f.call({op:'hash',password:pw,rounds})).value,h.value);
   }
   for(const stored of ['invalid',hash(pw,pepper).replace(':210000:',':0210000:'),hash(pw,pepper).toUpperCase(),hash(pw,pepper)+':extra',null]){
    assert.deepEqual(await f.call({password:pw,stored}),{status:200,value:false});
   }
   assert.deepEqual(await f.call({password:'x'.repeat(257),stored:hash(pw,pepper)}),{status:200,value:false});
   assert.equal((await f.call({op:'hash',password:pw,rounds:210000})).status,503);
   assert.equal(f.external(),0);
  }finally{await f.mf.dispose();}
 }
 const noSecret=await fixture(undefined);try{
  assert.equal((await noSecret.call({password:'ordinary passphrase',stored:hash('ordinary passphrase','synthetic-pepper-'.repeat(2))})).status,503);
 }finally{await noSecret.mf.dispose();}
 console.log('CF_FREE_PRIVATE_VERIFIER_VECTORS '+JSON.stringify({legacyCorrectWrong:vectors,freeCertified:false,networkCalls:0}));
});
test('credential-free private Wrangler dry-run emits exactly pinned WASM and no probe routes',{timeout:120000},()=>{
 const temp=mkdtempSync(join(tmpdir(),'xrh-private-dry-'));try{
  const out=join(temp,'out');
  const p=spawnSync(process.execPath,[resolve(api,'node_modules/.bin/wrangler'),'deploy','--dry-run','--config',resolve(root,'wrangler.candidate.jsonc'),'--outdir',out],{cwd:api,encoding:'utf8',timeout:90000,maxBuffer:2000000,env:{PATH:process.env.PATH||'',HOME:temp,CI:'true',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'}});
  assert.equal(p.status,0,'private dry-run failed: '+p.stderr?.slice(-1000));
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):e.isFile()?[join(dir,e.name)]:[]);
  const files=walk(out),wasm=files.filter(x=>x.endsWith('.wasm'));
  assert.equal(wasm.length,1);assert.equal(createHash('sha256').update(readFileSync(wasm[0])).digest('hex'),sha);
  const js=files.filter(x=>x.endsWith('.js')).map(x=>readFileSync(x,'utf8')).join('\n');
  assert.match(js,/PasswordVerifierDO/);assert.doesNotMatch(js,/XRH_PILOT_CPU|xrh-cf-free-isolated-probe|\/__pilot/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
