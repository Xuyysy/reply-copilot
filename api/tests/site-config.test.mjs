import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=mkdtempSync(path.join(tmpdir(),'site-config-'));
buildSync({entryPoints:[fileURLToPath(new URL('../src/site-config.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',outfile:path.join(directory,'config.cjs')});
const {validateContent,DEFAULT_NAVIGATION}=createRequire(import.meta.url)(path.join(directory,'config.cjs'));
test('navigation has fixed IDs and rejects sensitive or unsafe targets',()=>{
 for(const href of ['javascript:alert(1)','//evil.test','https://127.0.0.1','/admin','/account','/login','/guide?next=/admin'])assert.throws(()=>validateContent({navigation:DEFAULT_NAVIGATION.map(item=>({...item,href:item.id==='guide'?href:item.href}))}));
 assert.throws(()=>validateContent({navigation:DEFAULT_NAVIGATION.map(item=>({...item,id:'guide'}))}));
 assert.throws(()=>validateContent({navigation:[]}));
 assert.equal(validateContent({navigation:DEFAULT_NAVIGATION}).navigation.length,5);
});
test('plain text persists without executing or interpreting markup and old content keys survive',()=>{
 const result=validateContent({homeTitleZh:' <script>alert(1)</script> ',guideEn:'Existing guide',footerTextEn:'Footer'});
 assert.equal(result.homeTitleZh,'<script>alert(1)</script>');assert.equal(result.guideEn,'Existing guide');assert.equal(result.footerTextEn,'Footer');
 assert.equal(validateContent({homeCtaHref:'/login?mode=register'}).homeCtaHref,'/login?mode=register');
 assert.throws(()=>validateContent({homeCtaHref:'/login?next=https://evil.test'}));
 assert.throws(()=>validateContent({xProfileUrl:'https://x.com.evil.test/test'}));
});
test('checkout presentation can be customized without changing payment protocol',()=>{
 const input={checkoutPaymentTitleZh:'支付方式',checkoutPaymentNoteEn:'Secure Alipay checkout',checkoutPayButtonZh:'使用支付宝付款'};
 const result=validateContent(input);for(const [key,value] of Object.entries(input))assert.equal(result[key],value);
 assert.throws(()=>validateContent({checkoutPayButtonZh:'a'.repeat(121)}));
});
