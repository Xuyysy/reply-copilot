import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
const require=createRequire(import.meta.url);
function load(file){const m={exports:{}};const out=buildSync({entryPoints:[fileURLToPath(new URL('../src/'+file,import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});new Function('module','exports','require',out.outputFiles[0].text)(m,m.exports,require);return m.exports;}
const security=load('security.ts'),http=load('http.ts'),device=load('device.ts');
const env=JSON.parse(readFileSync(new URL('../deploy/production.wrangler.json',import.meta.url))).vars;
const staging=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url))).env.staging.vars;
const request=origin=>new Request(env.API_ORIGIN+'/v1/device/code',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
test('Production extension binding accepts only the assigned store origin, independent from Staging',async()=>{
 assert.equal(security.extensionOriginAllowed(request(env.EXTENSION_ORIGIN),env),true);
 for(const origin of [staging.EXTENSION_ORIGIN,env.EXTENSION_ORIGIN+'.evil',env.WEB_ORIGIN,'null']){
  assert.equal(security.extensionOriginAllowed(request(origin),env),false);
  await assert.rejects(()=>device.requestDeviceCode(request(origin),env),e=>e.code==='ORIGIN_DENIED');
 }
 await assert.rejects(()=>device.requestDeviceCode(request(env.EXTENSION_ORIGIN),env),e=>e.code==='INVALID_DEVICE');
 assert.notEqual(staging.EXTENSION_ORIGIN,env.EXTENSION_ORIGIN);
 assert.equal(security.extensionOriginAllowed(request(staging.EXTENSION_ORIGIN),staging),true);
 assert.equal(security.extensionOriginAllowed(request(env.EXTENSION_ORIGIN),staging),false);
});
test('website authentication stays on its website origin; CORS never accepts a spoofed extension',()=>{
 assert.doesNotThrow(()=>security.requireWebOrigin(request(env.WEB_ORIGIN),env));
 assert.throws(()=>security.requireWebOrigin(request(env.EXTENSION_ORIGIN),env));
 const allowed=http.response({ok:true},200,env,request(env.EXTENSION_ORIGIN));
 assert.equal(http.options(request(env.EXTENSION_ORIGIN),env).status,204);
 assert.equal(http.options(request(staging.EXTENSION_ORIGIN),env).status,403);
 assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),env.EXTENSION_ORIGIN);
 assert.equal(http.response({ok:true},200,env,request(staging.EXTENSION_ORIGIN)).headers.get('Access-Control-Allow-Origin'),null);
});
