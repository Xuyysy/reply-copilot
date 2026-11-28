import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMomentumBrowser} from '../helpers/momentum-browser.js';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('partner header button stays visible next to settings in compact light and dark sidebars',{timeout:30000},async()=>{
 const html=read('sidepanel/sidepanel.html');
 const header=html.match(/<header class="app-header">[^]*?<\/header>/)?.[0];
 assert.ok(header);
 const css=read('content/design-tokens.css')+'\n'+read('sidepanel/sidepanel.css');
 await withMomentumBrowser('<style>'+css+'</style>'+header+'<script>window.momentumReady=true;</script>',async({evaluate,call})=>{
  for(const theme of ['light','dark']){
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
   for(const width of [270,320,375,520]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    const layout=await evaluate(`(()=>{const h=document.querySelector('.app-header'),brand=h.querySelector('.app-brand'),p=h.querySelector('#nav-partners'),s=h.querySelector('#settings'),a=brand.getBoundingClientRect(),b=p.getBoundingClientRect(),c=s.getBoundingClientRect();return {fits:document.documentElement.scrollWidth<=innerWidth,brandFits:brand.scrollWidth<=brand.clientWidth,ordered:a.right<=b.left&&b.right<=c.left,visible:c.right<=innerWidth&&b.width>0&&b.height>=32,label:p.textContent,settings:s.getAttribute('aria-label')};})()`);
    assert.deepEqual(layout,{fits:true,brandFits:true,ordered:true,visible:true,label:'赚佣金',settings:'设置'},theme+' '+width);
   }
  }
 });
});
