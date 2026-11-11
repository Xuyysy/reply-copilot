(() => {
  // All references and post identities stay in this content script's isolated world.
  function create({trusted,statusId,requestId,now,baselineModalCount,baselineEditors}) {
    const startedAt=now, previousEditors=new Set(baselineEditors);
    let state='waiting',reason='awaiting_new_editor',editor=null,boundDialog=null;
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
        // React may briefly unmount the editor while mounting media/quote
        // attachments. The surrounding dialog can also disappear for a
        // frame. Wait for the caller's short close-grace check instead of
        // treating one empty snapshot as a permanent user cancellation.
        if (!candidates.length) {
          reason='awaiting_editor_remount';
          return {state,reason,editor:null};
        }
        const candidate=candidates[0];
        if (candidate.contextStatusId && candidate.contextStatusId!==statusId) return reject('context_identity_conflict');
        if (candidate.quarantinedContextMatch && candidate.contextStatusId!==statusId) return reject('stale_activation_ambiguous');
        if (candidate.contextMatches===null) {
          reason='awaiting_reply_context';
          return {state,reason,editor:null};
        }
        if (!candidate.contextMatches) return reject('reply_context_unconfirmed');
        if (candidate.node!==editor) {
          // A new *focused, empty* editor is safe to rebind only when it is
          // the same reply dialog or has the exact verified target status ID.
          // Never revive a pre-existing editor, carry a user's draft across,
          // or follow a different post.
          const sameDialog=Boolean(boundDialog && candidate.dialog===boundDialog);
          const verifiedId=candidate.contextStatusId===statusId;
          if (!candidate.modal || !candidate.empty ||
              previousEditors.has(candidate.node) || (!sameDialog && !verifiedId) ||
              (editor?.isConnected && globalThis.ZaneReplyCopilotContent?.composerAdapter?.hasContent?.(editor)))
            return reject('editor_replaced_or_closed');
          // The new editor can appear before it receives keyboard focus.
          // Wait for focusin just like initial binding, without switching
          // insertion targets or triggering another generation meanwhile.
          if(!candidate.focused){
            reason='awaiting_editor_focus';
            return {state,reason,editor:null};
          }
          editor=candidate.node;
          boundDialog=candidate.dialog||null;
          reason='verified_editor_remount';
          return result();
        }
        return result();
      }
      if (!candidates.length) return result();
      const candidate=candidates[0];
      if (previousEditors.has(candidate.node)) return reject('preexisting_editor');
      if (!candidate.modal) return reject('not_reply_modal');
      if (candidate.contextStatusId && candidate.contextStatusId!==statusId) return reject('context_identity_conflict');
      if (candidate.quarantinedContextMatch && candidate.contextStatusId!==statusId) return reject('stale_activation_ambiguous');
      if (candidate.contextMatches===null) {reason='awaiting_reply_context';return result();}
      if (!candidate.contextMatches) return reject('reply_context_unconfirmed');
      if (!candidate.empty) return reject('existing_draft');
      if (!candidate.focused) {reason='awaiting_editor_focus';return result();}
      state='bound';reason='new_focused_reply_editor';editor=candidate.node;boundDialog=candidate.dialog||null;
      return result();
    }});
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  const editorSelector='[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]';
  function visible(node) {
    return Boolean(node?.isConnected && !node.closest('[aria-hidden="true"], [hidden]') && node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
  }
  function baseline(document) {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const editors=[...document.querySelectorAll(editorSelector)];
    // Media viewers and non-composer overlays are not existing reply
    // dialogs. Only a dialog with a visible editable target blocks a fresh
    // verified Reply click.
    const composerDialogs=dialogs.filter(dialog=>[...dialog.querySelectorAll(editorSelector)].some(visible));
    return {baselineModalCount:composerDialogs.length,visibleEditorCount:editors.filter(visible).length,
      visibleReplyEditorCount:editors.filter(node=>visible(node)&&node.closest('[role="dialog"]')).length,
      baselineEditors:editors};
  }
  function contextId(article) {
    // Canonical ID from the author's timestamp, never a random quote link.
    const identity=globalThis.ZaneReplyCopilotContent.postExtractor.postIdentity?.(article);
    if (identity?.statusId) return identity.statusId;
    // Preserve fail-closed behavior for a modal with conflicting post links.
    // An unknown parent can use verified text; conflicting IDs cannot.
    const ids=new Set();
    for(const anchor of article?.querySelectorAll?.('a[href*="/status/"]')||[]) {
      if(anchor.closest?.('article')!==article || globalThis.ZaneReplyCopilotContent.postExtractor.isQuoteContent?.(anchor,article))continue;
      try{
        const url=new URL(anchor.href);
        const match=url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/);
        if(url.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(url.hostname) && match)ids.add(match[1]);
      }catch{}
    }
    return ids.size>1?'conflicting_status_links':null;
  }
  const normalized=text=>(text||'').replace(/\s+/g,' ').trim();
  function capturePost(post) {
    const hasCapturedMedia=Boolean(post.article?.querySelector?.('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'));
    const hasCapturedPhoto=[...(post.article?.querySelectorAll?.('a[href*="/photo/"]')||[])].some(a=>{
      if(a.closest('article')!==post.article)return false;
      try {const u=new URL(a.href);return u.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(u.hostname) && new RegExp('^/[^/]+/status/'+post.statusId+'/photo/\\d+$').test(u.pathname);}catch{return false;}
    });
    return {...post,hasCapturedPhoto,hasCapturedMedia:hasCapturedMedia||hasCapturedPhoto};
  }
  function sameContext(post,text) {
    const source=normalized(post.sourceText),copy=normalized(text);
    if(copy===source)return true;
    if(!(post.hasCapturedPhoto||post.hasCapturedMedia) || !source || !copy.startsWith(source+' '))return false;
    // X's modal can append a plain picture reference absent from feed text,
    // including a presentation space after https://. This is auxiliary text
    // comparison only: never navigate to it or treat it as identity evidence.
    return /^(?:(?:https:\/\/ ?)?pic\.x\.com\/[A-Za-z0-9]+\s*){1,4}$/.test(copy.slice(source.length).trim());
  }
  function routeAllowed(initial,current,statusId) {
    if (initial===current) return true;
    try {const a=new URL(initial),b=new URL(current);return a.origin===b.origin && b.pathname==='/compose/post' && (!b.searchParams.has('in_reply_to')||b.searchParams.get('in_reply_to')===statusId);}catch{return false;}
  }
  function snapshot(document,post,initialUrl,currentUrl,now,quarantinedPosts=[]) {
    const api=globalThis.ZaneReplyCopilotContent;
    const original=post.article?.isConnected?api.postExtractor.extractPost(post.article):null;
    const nodes=new Set();
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    for (const dialog of dialogs) {
      for (const editor of dialog.querySelectorAll(editorSelector)) if(visible(editor))nodes.add(editor);
    }
    const editors=[...nodes].map(node=>{
      const dialog=node.closest('[role="dialog"]');
      const articles=[...dialog.querySelectorAll('article')].filter(a=>visible(a)&&!a.contains(node)
        && !a.closest?.('[data-testid="quoteTweet"], [data-testid="card.wrapper"]'));
      // Quoted posts/media can add extra article nodes in the modal.
      // Identify the ONE article whose canonical status ID matches the
      // clicked target; never equate the first article with the parent.
      const candidates=articles.map(article=>({
        article, id:contextId(article), text:api.postExtractor.postText(article)
      }));
      // On some rich-media reply modals X renders the original tweetText
      // directly in the dialog, without wrapping it in an article. The
      // fallback is STRICTLY scoped to this opened reply dialog, never
      // the feed behind it. A quoted preview cannot masquerade as the root.
      const bareTexts=[...dialog.querySelectorAll('[data-testid="tweetText"]')]
        .filter(textNode=>visible(textNode)&&!textNode.closest('article')&&
          !textNode.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"]')&&
          !textNode.closest('[contenteditable="true"]'));
      for(const textNode of bareTexts){
        const card=textNode.closest('[role="link"]');
        if(card?.querySelector?.('[data-testid="User-Name"]') &&
           bareTexts.some(other=>other!==textNode && !card.contains(other)))continue;
        const text=normalized(textNode.innerText||textNode.textContent);
        if(text)candidates.push({article:null,id:null,text});
      }
      const matching=candidates.filter(item=>item.id===post.statusId);
      const exactText=candidates.filter(item=>sameContext(post,item.text));
      // X sometimes omits the parent permalink in a quote/video reply modal,
      // while leaving a separate quoted article. A UNIQUE source-text match
      // is valid fallback evidence, even when the modal has several articles.
      // An explicitly identified DIFFERENT parent never becomes a match.
      const uniqueText=exactText.length===1?exactText[0]:null;
      const primary=matching.length===1?matching[0]
        :uniqueText&&(uniqueText.id===null)?uniqueText
        :candidates.length===1?candidates[0]:null;
      const text=primary?.text||'';
      const statusId=primary?.id||null;
      const quarantinedContextMatch=Boolean(primary&&text&&quarantinedPosts.some(old=>
        old?.statusId!==post.statusId&&sameContext(old,text)&&statusId!==post.statusId));
      // If the post ID is present it wins, even if X changed the display
      // text for translation. Otherwise demand a unique original-text match;
      // missing modal context should WAIT for React, not be rejected.
      const contextMatches=!candidates.length?null
        :matching.length>1?false
        :matching.length===1?Boolean(normalized(text))
        :uniqueText&&!uniqueText.id&&exactText.length===1?true
        :candidates.length===1&&!normalized(text)&&!statusId?null
        :false;
      return {node,dialog,modal:Boolean(dialog),focused:node===document.activeElement,
        empty:!api.composerAdapter.hasContent(node),contextStatusId:statusId,
        quarantinedContextMatch,
        contextArticleCount:articles.length,contextTextPresent:Boolean(normalized(text)),
        contextTextMatches:Boolean(primary&&sameContext(post,text)),
        contextMatches};
    });
    const composerDialogs=dialogs.filter(dialog=>[...dialog.querySelectorAll(editorSelector)].some(visible));
    return {now,editors,visibleDialogCount:composerDialogs.length,routeAllowed:routeAllowed(initialUrl,currentUrl,post.statusId),
      sourceUnchanged:!post.article?.isConnected||Boolean(original?.ok&&original.statusId===post.statusId)};
  }
  globalThis.ZaneReplyCopilotContent.composerAssociation={create,baseline,snapshot,capturePost};
})();
