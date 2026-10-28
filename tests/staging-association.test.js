import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx={};vm.createContext(ctx);
try {vm.runInContext(readFileSync(new URL('../experiments/staging-no-debugger/content/composer-association.js',import.meta.url),'utf8'),ctx);} catch(e) {if(e.code!=='ENOENT')throw e;}
function session(overrides={}) {return ctx.ZaneReplyCopilotContent?.composerAssociation?.create({trusted:true,statusId:'101',requestId:'r1',now:0,baselineModalCount:0,baselineEditors:[],...overrides});}
const editor={},other={};
function facts(overrides={}) {return {now:100,routeAllowed:true,sourceUnchanged:true,editors:[{node:editor,focused:true,empty:true,modal:true,contextMatches:true,contextStatusId:null}],...overrides};}
function resolve(s,f) {assert.ok(s,'association module must create a session');return s.evaluate(f);}
test('trusted click and a new focused modal associate without a dialog status link',()=>{assert.equal(resolve(session(),facts()).reason,'new_focused_reply_editor');});
test('original DOM removal preserves captured identity without reading a substitute post',()=>{const s=session();assert.equal(resolve(s,facts({sourceUnchanged:true})).editor,editor);assert.equal(s.statusId,'101');});
test('nested dialogs sharing one editor do not create ambiguity',()=>{const x=facts().editors[0];assert.equal(resolve(session(),facts({editors:[x,x]})).editor,editor);});
test('same text never overrides a different captured status identity',()=>{assert.equal(resolve(session(),facts({editors:[{...facts().editors[0],contextStatusId:'102'}]})).reason,'context_identity_conflict');});
test('untrusted activation cannot associate even if text and timing match',()=>{assert.equal(resolve(session({trusted:false}),facts()).reason,'untrusted_activation');});
test('an already open modal blocks association permanently',()=>{assert.equal(resolve(session({baselineModalCount:1}),facts()).reason,'preexisting_modal');});
test('an editor that existed before activation cannot be reused',()=>{assert.equal(resolve(session({baselineEditors:[editor]}),facts()).reason,'preexisting_editor');});
test('two independent modal editors reject rather than selecting the focused one',()=>{const x=facts().editors[0];assert.equal(resolve(session(),facts({editors:[x,{...x,node:other,focused:false}]})).reason,'multiple_editors');});
test('focus must enter the new editor before confirmation',()=>{const s=session();assert.equal(resolve(s,facts({editors:[{...facts().editors[0],focused:false}]})).state,'waiting');assert.equal(resolve(s,facts()).state,'bound');});
test('same text alone does not associate an editor outside a modal',()=>{assert.equal(resolve(session(),facts({editors:[{...facts().editors[0],modal:false}]})).reason,'not_reply_modal');});
test('missing or conflicting reply context rejects',()=>{assert.equal(resolve(session(),facts({editors:[{...facts().editors[0],contextMatches:false}]})).reason,'reply_context_unconfirmed');});
test('rapid second activation interrupts the first operation and cannot rebind it',()=>{const s=session();s.interrupt('competing_activation');assert.equal(resolve(s,facts()).reason,'competing_activation');});
test('source node recycling and unrelated route changes reject',()=>{assert.equal(resolve(session(),facts({sourceUnchanged:false})).reason,'source_changed');assert.equal(resolve(session(),facts({routeAllowed:false})).reason,'route_changed');});
test('late editor creation cannot revive an expired operation',()=>{const s=session();assert.equal(resolve(s,facts({now:9001})).reason,'association_expired');assert.equal(resolve(s,facts()).state,'rejected');});
test('draft content is preserved and blocks binding',()=>{assert.equal(resolve(session(),facts({editors:[{...facts().editors[0],empty:false}]})).reason,'existing_draft');});
test('a quarantined same-text modal cannot be claimed by a later activation without a status identity',()=>{assert.equal(resolve(session(),facts({editors:[{...facts().editors[0],quarantinedContextMatch:true}]})).reason,'stale_activation_ambiguous');});
test('closing and rebuilding a bound editor invalidates the operation',()=>{for(const editors of [[],[{...facts().editors[0],node:other}]]){const s=session();resolve(s,facts());assert.equal(resolve(s,facts({editors})).reason,'editor_replaced_or_closed');}});
test('adding another editor after binding revokes the association',()=>{const s=session(),x=facts().editors[0];resolve(s,facts());assert.equal(resolve(s,facts({editors:[x,{...x,node:other}]})).reason,'multiple_editors');});
test('bound operation has a finite lifetime and never rebinds',()=>{const s=session();resolve(s,facts());assert.equal(resolve(s,facts({now:60001})).reason,'operation_expired');});
