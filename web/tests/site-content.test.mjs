import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSiteLink, safeSupportEmail, createSiteContentLoader, applySiteContent } from '../src/lib/site-content.mjs';
test('public links only accept exact HTTPS hosts', () => {
  assert.equal(safeSiteLink('https://x.com/example', 'xProfileUrl'), 'https://x.com/example');
  assert.ok(safeSiteLink('https://chromewebstore.google.com/detail/a/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'chromeStoreUrl'));
  for (const url of ['javascript:alert(1)', 'https://x.com.evil.test/a', 'https://x.com@evil.test', 'http://x.com/a', 'https://user@x.com/a', 'https://x.com:8443/a']) assert.equal(safeSiteLink(url, 'xProfileUrl'), '');
  assert.equal(safeSiteLink('https://chrome.google.com/webstore', 'chromeStoreUrl'), '');
  assert.equal(safeSupportEmail('support@example.com'), 'support@example.com');
  assert.equal(safeSupportEmail('support@example.com?subject=bad'), '');
});
test('configuration fetch is shared and failures use fallbacks', async () => {
  let calls = 0;
  const load = createSiteContentLoader(async () => { calls++; return {content:{homeTitleEn:'Hello'}}; });
  assert.deepEqual(await load(), {homeTitleEn:'Hello'}); await load(); assert.equal(calls, 1); await load(true); assert.equal(calls, 2);
  assert.deepEqual(await createSiteContentLoader(async () => { throw Error(); })(), {});
});
test('localized configuration is assigned as text and blanks retain existing copy', () => {
  const element = {dataset:{siteText:'homeTitle',zh:'原文'},textContent:'Original', hidden:false};
  const doc = {querySelectorAll: selector => selector === '[data-site-text]' ? [element] : []};
  applySiteContent(doc, {homeTitleEn:'<img src=x onerror=alert(1)>',homeTitleZh:''}, 'en');
  assert.equal(element.textContent, '<img src=x onerror=alert(1)>');
  applySiteContent(doc, {homeTitleZh:''}, 'zh'); assert.equal(element.textContent, '原文');
});

test('site copy cannot override payment-channel labels managed by checkout state',()=>{
 const label={dataset:{siteText:'checkoutPayButton',siteDynamicText:'true',zh:'使用支付宝付款',en:'Pay with Alipay'},textContent:'使用微信支付'};
 const doc={querySelectorAll:s=>s==='[data-site-text]'?[label]:[]};
 applySiteContent(doc,{checkoutPayButtonZh:'通用付款',checkoutPayButtonEn:'Pay now'},'en');
 assert.equal(label.textContent,'使用微信支付');
});
test('configuration removal disables links and hides support contact', () => {
  const link = {dataset:{siteLink:'chromeStoreUrl'},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};
  const email = {attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};
  const doc = {querySelectorAll: selector => selector === '[data-site-link]' ? [link] : selector === '[data-site-email]' ? [email] : []};
  applySiteContent(doc, {chromeStoreUrl:'https://chromewebstore.google.com/detail/a/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',supportEmail:'help@example.com'}, 'en');
  assert.equal(link.attrs['aria-disabled'], undefined);
  assert.equal(email.attrs.href, 'mailto:help@example.com');
  applySiteContent(doc, {}, 'en');
  assert.equal(link.attrs.href, undefined); assert.equal(link.attrs['aria-disabled'], 'true');
  assert.equal(email.hidden, true); assert.equal(email.attrs.href, undefined);
});

test('configured FAQ replaces defaults and removing it restores defaults',()=>{const fallback={hidden:false};const doc={querySelectorAll:s=>s==='[data-site-faq-default]'?[fallback]:[]};applySiteContent(doc,{faqZh:'问题\n回答'},'zh');assert.equal(fallback.hidden,true);applySiteContent(doc,{},'zh');assert.equal(fallback.hidden,false);});

test('stable navigation limits targets and respects ordering and visibility', async()=>{
 const {siteNavigation,DEFAULT_NAVIGATION,safeInternalLink}=await import('../src/lib/site-content.mjs');
 const nav=siteNavigation({navigation:DEFAULT_NAVIGATION.map(item=>({...item,href:item.id==='guide'?'javascript:alert(1)':item.href,sortOrder:item.id==='faq'?0:5,visible:item.id!=='pricing'}))});
 assert.equal(nav.length,5);assert.equal(nav[0].id,'faq');assert.equal(nav.find(item=>item.id==='guide').href,'');assert.equal(nav.find(item=>item.id==='pricing').visible,false);
 for(const href of ['/admin','/login','/account','//evil.test','https://127.0.0.1','/guide?next=https://evil.test'])assert.equal(safeInternalLink(href),'');
 assert.equal(safeInternalLink('/guide'),'/guide');
});

test('footer and CTA translations plus navigation changes apply without changing account entry',async()=>{
 const {DEFAULT_NAVIGATION}=await import('../src/lib/site-content.mjs');
 const footer={dataset:{siteText:'footerText',zh:'原页脚'},textContent:'Original footer'};
 const cta={dataset:{siteInternal:'homeCtaHref'},attrs:{href:'/guide'},getAttribute(key){return this.attrs[key]},setAttribute(key,value){this.attrs[key]=value}};
 const nodes=Object.fromEntries(DEFAULT_NAVIGATION.map(item=>[item.id,{dataset:{},style:{},attrs:{},setAttribute(key,value){this.attrs[key]=value},removeAttribute(key){delete this.attrs[key]}}]));
 const ordered=[];const nav={querySelector(selector){return nodes[selector.match(/"([^"]+)"/)[1]]},append(element){ordered.push(element)}};
 const account={href:'/account'};
 const doc={querySelector:selector=>selector==='[data-site-navigation]'?nav:null,querySelectorAll:selector=>selector==='[data-site-text]'?[footer]:selector==='[data-site-internal]'?[cta]:[]};
 applySiteContent(doc,{footerTextEn:'<b>Custom footer</b>',homeCtaHref:'/pricing',navigation:DEFAULT_NAVIGATION.map(item=>({...item,labelEn:'New '+item.id,visible:item.id!=='faq',sortOrder:item.id==='pricing'?0:5}))},'en');
 assert.equal(footer.textContent,'<b>Custom footer</b>');assert.equal(cta.attrs.href,'/pricing');assert.equal(nodes.faq.hidden,true);assert.equal(ordered[0],nodes.pricing);assert.equal(nodes.guide.textContent,'New guide');assert.equal(account.href,'/account');
 applySiteContent(doc,{homeCtaHref:'/admin'},'zh');assert.equal(cta.attrs.href,'/guide');assert.equal(footer.textContent,'原页脚');
});

test('primary CTA replaces account CTA per locale and blank restores account behavior',async()=>{
 const {safeCtaLink,shouldHideAccountCta}=await import('../src/lib/site-content.mjs');
 const custom={dataset:{siteText:'homeCta'},textContent:'',attrs:{},setAttribute(key,value){this.attrs[key]=value}};
 const original={dataset:{},hidden:false,href:'/account'};
 const accountEntry={href:'/account'};
 const doc={querySelector:selector=>selector==='[data-site-primary]'?custom:null,querySelectorAll:selector=>selector==='[data-site-text]'?[custom]:selector==='[data-default-primary]'?[original]:[],dispatchEvent(){original.hidden=shouldHideAccountCta('ready',original.dataset.sitePrimaryOverride)}};
 applySiteContent(doc,{homeCtaEn:'Register now',homeCtaHref:'/login?mode=register'},'en');
 assert.equal(custom.hidden,false);assert.equal(original.hidden,true);assert.equal(custom.attrs.href,'/login?mode=register');assert.equal(custom.textContent,'Register now');
 applySiteContent(doc,{homeCtaEn:'',homeCtaHref:'/account'},'en');
 assert.equal(custom.hidden,true);assert.equal(original.hidden,false);assert.equal(original.href,'/account');assert.equal(accountEntry.href,'/account');
 assert.equal(shouldHideAccountCta('loading','false'),true);assert.equal(shouldHideAccountCta('guest','false'),false);
 for(const url of ['/login','/login?mode=register','/login?mode=login','/account'])assert.equal(safeCtaLink(url),url);
 for(const url of ['/admin','/login?next=https://evil.test','javascript:alert(1)','//evil.test'])assert.equal(safeCtaLink(url),'');
});
