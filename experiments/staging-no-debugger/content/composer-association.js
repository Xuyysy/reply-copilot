(() => {
  // All references and post identities stay in this content script's isolated world.
  function create({trusted,statusId,requestId,now,baselineModalCount,baselineEditors}) {
    const startedAt=now, previousEditors=new Set(baselineEditors);
    let state='waiting',reason='awaiting_new_editor',editor=null;
    function reject(why) {state='rejected';reason=why;editor=null;return result();}
    function result() {return {state,reason,editor};}
    if (!trusted) reject('untrusted_activation');
    else if (!/^\d+$/.test(statusId||'') || !requestId || !Number.isFinite(now)) reject('source_unverified');
    else if (baselineModalCount!==0) reject('preexisting_modal');
    return Object.freeze({statusId,requestId,interrupt:reject,evaluate(f) {
      if (state==='rejected') return result();
      if (!Number.isFinite(f.now)||f.now<startedAt) return reject('clock_invalid');
      if (f.now-startedAt>(state==='bound'?60000:9000)) return reject(state==='bound'?'operation_expired':'association_expired');
      if (!f.routeAllowed) return reject('route_changed');
      if (!f.sourceUnchanged) return reject('source_changed');
      const nodes=new Map();
      for (const candidate of f.editors) nodes.set(candidate.node,candidate);
      const candidates=[...nodes.values()];
      if (candidates.length>1) return reject('multiple_editors');
      if (state==='bound') {
        if (candidates.length!==1 || candidates[0].node!==editor) return reject('editor_replaced_or_closed');
        if (candidates[0].contextStatusId && candidates[0].contextStatusId!==statusId) return reject('context_identity_conflict');
        if (!candidates[0].contextMatches) return reject('reply_context_unconfirmed');
        return result();
      }
      if (!candidates.length) return result();
      const candidate=candidates[0];
      if (previousEditors.has(candidate.node)) return reject('preexisting_editor');
      if (!candidate.modal) return reject('not_reply_modal');
      if (candidate.contextStatusId && candidate.contextStatusId!==statusId) return reject('context_identity_conflict');
      if (candidate.contextMatches===null) {reason='awaiting_reply_context';return result();}
      if (!candidate.contextMatches) return reject('reply_context_unconfirmed');
      if (!candidate.empty) return reject('existing_draft');
      if (!candidate.focused) {reason='awaiting_editor_focus';return result();}
      state='bound';reason='new_focused_reply_editor';editor=candidate.node;
      return result();
    }});
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  const editorSelector='[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]';
  function visible(node) {
    return Boolean(node?.isConnected && !node.closest('[aria-hidden="true"], [hidden]') && node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
  }
  function baseline(document) {
    return {baselineModalCount:[...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      baselineEditors:[...document.querySelectorAll(editorSelector)]};
  }
  function contextId(article) {
    const ids=new Set();
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      if (a.closest('article')!==article) continue;
      try {const u=new URL(a.href);if (u.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(u.hostname)) {
        const m=u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/);if(m)ids.add(m[1]);
      }} catch {}
    }
    return ids.size>1?'conflicting_status_links':([...ids][0]||null);
  }
  const normalized=text=>(text||'').replace(/\s+/g,' ').trim();
  function capturePost(post) {
    const hasCapturedPhoto=[...(post.article?.querySelectorAll?.('a[href*="/photo/"]')||[])].some(a=>{
      if(a.closest('article')!==post.article)return false;
      try {const u=new URL(a.href);return u.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(u.hostname) && new RegExp('^/[^/]+/status/'+post.statusId+'/photo/\\d+$').test(u.pathname);}catch{return false;}
    });
    return {...post,hasCapturedPhoto};
  }
  function sameContext(post,text) {
    const source=normalized(post.sourceText),copy=normalized(text);
    if(copy===source)return true;
    if(!post.hasCapturedPhoto || !source || !copy.startsWith(source+' '))return false;
    // X's modal can append a plain picture reference absent from feed text,
    // including a presentation space after https://. This is auxiliary text
    // comparison only: never navigate to it or treat it as identity evidence.
    return /^(?:https:\/\/ ?)?pic\.x\.com\/[A-Za-z0-9]+$/.test(copy.slice(source.length).trim());
  }
  function routeAllowed(initial,current,statusId) {
    if (initial===current) return true;
    try {const a=new URL(initial),b=new URL(current);return a.origin===b.origin && b.pathname==='/compose/post' && (!b.searchParams.has('in_reply_to')||b.searchParams.get('in_reply_to')===statusId);}catch{return false;}
  }
  function snapshot(document,post,initialUrl,currentUrl,now) {
    const api=globalThis.ZaneReplyCopilotContent;
    const original=post.article?.isConnected?api.postExtractor.extractPost(post.article):null;
    const nodes=new Set();
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (visible(dialog)) for (const editor of dialog.querySelectorAll(editorSelector)) if(visible(editor))nodes.add(editor);
    }
    const editors=[...nodes].map(node=>{
      const dialog=node.closest('[role="dialog"]');
      const articles=[...dialog.querySelectorAll('article')].filter(a=>visible(a)&&!a.contains(node));
      const primary=articles[0];
      const text=primary?[...primary.querySelectorAll('[data-testid="tweetText"]')].filter(n=>n.closest('article')===primary).map(n=>n.innerText).join('\n'):'';
      return {node,modal:Boolean(dialog),focused:node===document.activeElement,
        empty:!api.composerAdapter.hasContent(node),contextStatusId:primary?contextId(primary):null,
        contextMatches:!primary||!normalized(text)?null:articles.length===1&&sameContext(post,text)};
    });
    return {now,editors,routeAllowed:routeAllowed(initialUrl,currentUrl,post.statusId),
      sourceUnchanged:!post.article?.isConnected||Boolean(original?.ok&&original.statusId===post.statusId&&original.sourceText===post.sourceText)};
  }
  globalThis.ZaneReplyCopilotContent.composerAssociation={create,baseline,snapshot,capturePost};
})();
