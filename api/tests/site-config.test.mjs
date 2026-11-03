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

// Both layers consume the same explicit X post/article URL contract.
const validTutorials=[
 'https://x.com/example/status/1234567890123456789',
 'https://www.x.com/example/status/1234567890123456789?s=20&t=abc_DEF-123',
 'https://x.com/i/status/1234567890123456789',
 'https://x.com/i/web/status/1234567890123456789',
 'https://x.com/i/article/1234567890123456789',
 'https://x.com/i/articles/1234567890123456789/',
 'https://x.com/example/article/1234567890123456789',
];
const invalidTutorials=[
 'javascript:alert(1)','http://x.com/example/status/123','//x.com/example/status/123',
 'https://x.com.evil.test/example/status/123','https://user:pass@x.com/example/status/123',
 'https://x.com:8443/example/status/123','https://x.com:443/example/status/123',
 'https://x.com/example','https://x.com/home','https://x.com/i/articles',
 'https://x.com/example/status/not-a-number','https://x.com/example/status/0',
 'https://x.com/example/status/123/photo/1','https://x.com/example/article/123/edit',
 'https://x.com/example/status/123?redirect=https://evil.test','https://x.com/example/status/123#fragment',
 'https://x.com/example/status/123?s=20&s=21','https://x.com/example/status/123?t='+ 'x'.repeat(129),
 'https://x.com/other/../example/status/123','https://x.com/example/%73tatus/123',
 'https://x.com/example/status/123\n','https://x.com/example/status/123?next=/home',
];
test('tutorial accepts explicit X article and post routes and optional clearing',()=>{
 for(const url of validTutorials)assert.equal(validateContent({xTutorialUrl:url}).xTutorialUrl,url);
 assert.equal(validateContent({}).xTutorialUrl,'');
 assert.equal(validateContent({xTutorialUrl:'   '}).xTutorialUrl,'');
 assert.throws(()=>validateContent({xTutorialUrl:7}));
});
test('tutorial frontend and backend agree on every accepted and rejected URL',async()=>{
 const {safeSiteLink}=await import('../../web/src/lib/site-content.mjs');
 for(const url of validTutorials)assert.equal(safeSiteLink(url,'xTutorialUrl'),new URL(url).href);
 for(const url of invalidTutorials)assert.equal(safeSiteLink(url,'xTutorialUrl'),'');
});
test('tutorial rejects disguised hosts, credentials, ports and non-content paths',()=>{
 for(const url of invalidTutorials.filter(v=>!v.endsWith('\n')))assert.throws(()=>validateContent({xTutorialUrl:url}),url);
});
