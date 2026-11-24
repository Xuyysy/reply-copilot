// Explicit field allowlist for shareable structure-only diagnostics.
// Never copy DOM attributes, URLs, arbitrary nested objects or exception messages.
const enumOf=(v,values)=>values.includes(v)?v:'unknown';
const bool=v=>typeof v==='boolean'?v:null;
const int=(v,max=100)=>Number.isInteger(v)&&v>=0&&v<=max?v:null;
const arr=(v,max,fn)=>Array.isArray(v)?v.slice(0,max).map(fn):[];
const fields=(obj,keys,fn)=>Object.fromEntries(keys.map(k=>[k,fn(obj?.[k])]));
const tag=['none','other','button','a','div','span','svg','path','article','section','main','dialog','textarea','input','p','g','use'];
const role=['none','other','button','link','group','dialog','textbox','article','presentation','menu','menuitem','region','main'];
const testId=['none','other','reply','tweet','tweetText','tweetTextarea_0','tweetTextarea_1','tweetButton','tweetButtonInline','User-Name','cellInnerDiv','primaryColumn','layers','sheetDialog','confirmationSheetDialog','toolBar','tweetPhoto','videoPlayer','videoComponent','quoteTweet','card.wrapper','like','retweet','unretweet','unlike','bookmark','caret'];
function node(o){return o&&typeof o==='object'?{tag:enumOf(o.tag,tag),role:enumOf(o.role,role),testId:enumOf(o.testId,testId),ariaLabelPresent:bool(o.ariaLabelPresent),editable:bool(o.editable)}:null;}
function post(o){return {...fields(o,['article','tweetContainer','identityVerified','mainTextPresent','quoteTextPresent'],bool),...fields(o,['textNodes','timeNodes','statusLinks','mediaNodes'],int)};}
function gesture(o){return o&&typeof o==='object'?{target:node(o.target),nearestControl:node(o.nearestControl),ancestors:arr(o.ancestors,8,node),rule:enumOf(o.rule,['testid','label','engagement','unrecognized']),...fields(o,['replyTestIdAncestor','outerRecognized','insideDialog'],bool),post:post(o.post)}:null;}
export function sanitizeLayout(o){
 if(!o||typeof o!=='object')return null;
 return {pageType:enumOf(o.pageType,['home','post_detail','search','compose','profile','media','other']),language:enumOf(o.language,['zh','en','ja','ko','es','fr','de','it','pt','ru','ar','id','vi','th','tr','hi','pl','nl','uk','other']),
  ...fields(o,['viewportWidth','viewportHeight'],v=>int(v,10000)),
  ...fields(o,['articles','tweetContainers','standardReplyControls','standardEditors','roleDialogs','nativeDialogs','editableCandidates','inlineCandidates','nonstandardCandidates','dialogStandardEditors'],int),
  modernAppMarker:bool(o.modernAppMarker),modernReplyControls:int(o.modernReplyControls),textareaCandidates:int(o.textareaCandidates),
  focusedEditor:node(o.focusedEditor),focusedInsideDialog:bool(o.focusedInsideDialog),
  candidates:arr(o.candidates,5,e=>({node:node(e?.node),...fields(e,['standard','insideRoleDialog','insideNativeDialog','focused'],bool)}))};
}
export function sanitizeRender(o){
 if(!o||typeof o!=='object')return null;
 return {source:enumOf(o.source,['none','active','lingering']),...fields(o,['connected','intersectsViewport','displayHidden','visibilityHidden','transparent','collapsed','panelPresent'],bool),
  ...fields(o,['stylesheetCount','stylesheetsLoaded'],v=>int(v,4)),occlusion:enumOf(o.occlusion,['none','partial','all']),...fields(o,['width','height'],v=>int(v,10000))};
}
export function sanitizeReproduction(o,stage,reason){
 const state=enumOf(o?.state,['lost','recording','no_click','complete']);
 if(state!=='complete'&&state!=='no_click')return {state};
 return {state,gesture:gesture(o.gesture),click:gesture(o.click),
  samples:arr(o.samples,8,s=>({label:enumOf(s?.label,['armed','before','after_click','300ms','1500ms','4500ms','9500ms','12000ms']),atMs:int(s?.atMs,60000),layout:sanitizeLayout(s?.layout),render:sanitizeRender(s?.render)})),
  marks:arr(o.marks,40,m=>({stage:enumOf(m?.stage,stage),reason:enumOf(m?.reason,reason),atMs:int(m?.atMs,60000)})),
  facts:arr(o.facts,12,f=>({atMs:int(f?.atMs,60000),value:{...fields(f?.value,['routeAllowed','sourceUnchanged'],bool),...fields(f?.value,['candidates','dialogs'],int),
   editors:arr(f?.value?.editors,5,e=>({...fields(e,['modal','focused','empty','contextIdentityPresent','contextTextPresent','contextTextMatches'],bool),contextArticleCount:int(e?.contextArticleCount),contextMatches:enumOf(e?.contextMatches,['pending','match','mismatch'])}))}})),
  sampleErrors:int(o.sampleErrors,100)};
}
export function environment(userAgent,tab,manifest){
 const host=(()=>{try{const u=new URL(tab?.url);return u.protocol==='https:'?enumOf(u.hostname,['x.com','twitter.com','www.x.com','www.twitter.com']):'unknown';}catch{return 'unknown';}})();
 const matches=manifest?.content_scripts?.flatMap(x=>x.matches||[])||[];
 return {browserFamily:/Edg\//.test(userAgent)?'edge':/OPR\//.test(userAgent)?'opera':/Chrome\//.test(userAgent)?'chrome_compatible':/Chromium\//.test(userAgent)?'chromium':'unknown',
  os:/Android/.test(userAgent)?'android':/Windows/.test(userAgent)?'windows':/Macintosh|Mac OS X/.test(userAgent)?'macos':/CrOS/.test(userAgent)?'chromeos':/Linux/.test(userAgent)?'linux':'unknown',
  incognito:bool(tab?.incognito),pageHost:host,manifestHostMatch:host==='unknown'?null:matches.includes('https://'+host+'/*')};
}
// A hypothesis, not an instruction to loosen matching or generate from unverified posts.
export function classifyFailure(r){
 if(r.page==='other'||r.page==='no_tab')return 'wrong_tab';
 if(r.environment?.manifestHostMatch===false)return 'manifest_host_not_matched';
 if(r.contentScript!=='running')return 'content_script_unreachable';
 if(r.floatingEnabled===false)return 'floating_disabled';
 const p=r.probe,rep=r.reproduction;
 if(rep?.state==='lost')return 'capture_lost';
 if(rep?.state==='no_click')return 'no_click_captured';
 if(rep?.state!=='complete')return 'reproduction_needed';
 const g=rep.click||rep.gesture;
 if(!g)return 'click_shape_unavailable';
 if(g.rule==='unrecognized')return 'reply_control_unrecognized';
 if(g.post.article===false)return 'post_container_unrecognized';
 if(g.post.identityVerified===false)return 'post_identity_unverified';
 if(g.post.mainTextPresent===false&&g.post.quoteTextPresent!==true)return 'post_text_missing';
 const marks=rep.marks||[],has=(s,c)=>marks.some(m=>m.stage===s&&m.reason===c);
 if(!has('activated','trusted_reply_click'))return 'activation_not_completed';
 if(!has('bound','new_focused_reply_editor')&&!has('copy_only','new_editor_unverified_parent')){
   const layouts=rep.samples.map(s=>s.layout).filter(Boolean);
   const first=layouts[0],last=layouts.at(-1);
   if(last&&first&&last.inlineCandidates>first.inlineCandidates&&last.dialogStandardEditors===0)return 'inline_editor_candidate';
   if(last&&first&&last.nonstandardCandidates>first.nonstandardCandidates&&last.dialogStandardEditors===0)return 'nonstandard_editor_candidate';
   if(last&&last.nativeDialogs>0&&last.dialogStandardEditors===0)return 'native_dialog_candidate';
   return 'association_not_bound';
 }
 if(has('window','disabled_by_setting'))return 'floating_disabled';
 if(has('window','prepare_failed'))return 'prepare_failed';
 if(!has('window','mounted'))return 'window_not_mounted';
 const surfaces=rep.samples.map(s=>s.render).filter(x=>x?.source==='active'&&x.connected===true);
 if(surfaces.some(x=>x.displayHidden||x.visibilityHidden||x.transparent||x.intersectsViewport===false||x.occlusion==='all'))return 'window_render_issue';
 if(surfaces.some(x=>x.stylesheetCount>0&&x.stylesheetsLoaded===0))return 'stylesheet_not_loaded_during_capture';
 if(has('generation','failed'))return 'generation_failed';
 if(has('generation','requested')&&!has('generation','succeeded'))return 'generation_pending_at_capture_end';
 if(has('account','account_not_ready'))return 'account_not_ready_during_capture';
 return 'window_mounted_during_capture';
}
