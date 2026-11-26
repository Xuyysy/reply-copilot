import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const source=readFileSync(new URL('../staging/interaction-capture.js',import.meta.url),'utf8');
const html='<a data-testid="AppTabBar_Profile_Link" href="/me">Me</a><main><div data-testid="primaryColumn"><div data-testid="notification"><a href="/alice">Alice</a><a href="/bob">Bob</a><span>and 3 others liked your post</span><a href="/me/status/123">post</a><div data-testid="tweetText"><a href="/unrelated">Unrelated</a></div></div><div data-testid="notification"><a href="/charlie">Charlie</a><span>reposted your post</span></div><article data-testid="tweet"><div data-testid="User-Name"><a href="/dana">Dana</a><a href="/dana/status/456"><time>now</time></a></div><div>Replying to <a href="/me">@me</a></div><div data-testid="tweetText">Hello</div></article><article data-testid="tweet"><div data-testid="User-Name"><a href="/eva">Eva</a><a href="/eva/status/789"><time>now</time></a></div><div data-testid="tweetText">Replying to <a href="/me">@me</a></div></article></div></main><script>'+source+';window.momentumReady=true;</script>';
test('Chromium visible notification DOM: explicit grouped actors, missing target, reply and embedded text exclusion',{timeout:30000},async()=>{
 await withMomentumBrowser(html,async({evaluate})=>{
  const r=await evaluate("ReplyCopilotInteractionCapture.collect(document,{origin:'https://x.com',pathname:'/notifications'})");
  assert.equal(r.ok,true);assert.equal(r.owner,'me');assert.equal(r.scanned,4);assert.equal(r.unresolved,1);assert.equal(r.missingTargetRows,1);
  assert.deepEqual(r.events.map(e=>[e.actor,e.type,e.postId]),[['alice','like','123'],['bob','like','123'],['charlie','repost',null],['dana','reply','456']]);
  const invalid=await evaluate("document.querySelector('main').remove();ReplyCopilotInteractionCapture.collect(document,{origin:'https://x.com',pathname:'/notifications'})");
  assert.equal(invalid.reason,'notification_layout_unknown');
 });
});
