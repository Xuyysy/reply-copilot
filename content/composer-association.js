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
  const modernEditorSelector=editorSelector+',textarea';
  // The timeline and composer can roll out independently. A legacy post
  // may use a native XDS editor only with an independently verified reply
  // anchor and positive structural evidence; never widen legacy textboxes.
  function hybridNativeEditor(node) {
    if(node?.localName!=='textarea')return false;
    const dialog=node.closest?.('[role="dialog"]');
    const form=node?.closest?.('form');
    return Boolean(dialog?.matches?.('[data-slot="xds-modal-surface"]')&&
      form&&dialog.contains(form)&&form.closest('[data-media-upload-dropzone]')&&
      dialog.contains(form.closest('[data-media-upload-dropzone]')));
  }
  function selectorFor(doc,post) {
    return (post?post.modernLayout===true||post.replyRouteVerified===true:globalThis.ZaneReplyCopilotContent.postExtractor?.modernPage?.(doc))?modernEditorSelector:editorSelector;
  }
  function eligibleEditor(node,post){
    return (!post||post.modernLayout||node.localName!=='textarea'||(post.replyRouteVerified&&hybridNativeEditor(node)))&&visible(node);
  }
  function baseline(document,post) {
    const selector=selectorFor(document,post);
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const editors=[...document.querySelectorAll(selector)];
    // Media viewers and non-composer overlays are not existing reply
    // dialogs. Only a dialog with a visible editable target blocks a fresh
    // verified Reply click.
    const visibleEditors=editors.filter(node=>eligibleEditor(node,post));
    const composerDialogs=dialogs.filter(dialog=>visibleEditors.some(node=>dialog.contains(node)));
    return {baselineModalCount:composerDialogs.length,visibleEditorCount:visibleEditors.length,
      visibleReplyEditorCount:visibleEditors.filter(node=>node.closest('[role="dialog"]')).length,
      baselineEditors:editors};
  }
  function contextId(article,modernLayout=false,detailReference=null,expectedDetailId=null) {
    // Canonical ID from the author's timestamp, never a random quote link.
    const extractor=globalThis.ZaneReplyCopilotContent.postExtractor;
    if(detailReference){
      // A recovered source needs independent evidence inside the modal;
      // never reuse the detail route or the ordinary text-only fallback.
      const evidence=extractor.legacyDetailEvidence(article,detailReference);
      return evidence.conflict||(evidence.otherCanonicalId&&evidence.otherCanonicalId!==expectedDetailId)?
        'conflicting_status_links':evidence.statusId;
    }
    if(modernLayout||extractor.isModernPost?.(article)){
      const evidence=extractor.modernIdentityEvidence(article);
      return evidence.identity?.statusId||(evidence.conflict?'conflicting_status_links':null);
    }
    const identity=extractor.postIdentity?.(article);
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
  // Exclude embedded quote nodes consistently from modal parent candidates.
  // Read-only DOM inspection, never a guessed reply-target ID.
  function inQuotedCard(node) {
    if(node?.closest?.('[data-testid="quoteTweet"], [data-testid="card.wrapper"]'))return true;
    const card=node?.closest?.('div[role="link"]');
    return Boolean(card?.querySelector?.('[data-testid="User-Name"]') &&
      card?.querySelector?.('[data-testid="tweetText"]'));
  }
  function capturePost(post) {
    // Captioned quotes require extra hydration patience, ordinary posts do not.
    // Discover the quote only on the trusted capture, not on every modal scan.
    const markedQuote=Boolean(post.article?.querySelector?.('[data-testid="quoteTweet"]'));
    const roleLinkQuote=!markedQuote&&[...(post.article?.querySelectorAll?.('div[role="link"]')||[])]
      .some(card=>card.querySelector?.('[data-testid="User-Name"]')&&card.querySelector?.('[data-testid="tweetText"]'));
    const hasCapturedQuote=markedQuote||roleLinkQuote||
      Boolean(post.modernLayout&&post.article?.querySelector?.('[data-slot="embedded-tweet-frame"]'));
    const hasCapturedMedia=Boolean(post.article?.querySelector?.('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'));
    const hasCapturedPhoto=[...(post.article?.querySelectorAll?.('a[href*="/photo/"]')||[])].some(a=>{
      if(a.closest('article')!==post.article)return false;
      try {const u=new URL(a.href);return u.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(u.hostname) && new RegExp('^/[^/]+/status/'+post.statusId+'/photo/\\d+$').test(u.pathname);}catch{return false;}
    });
    // The rebuilt feed marks the quoted card, but its reply dialog may
    // render that same card as a plain article without a frame/permalink.
    // Capture only a single explicit immediate quote with its own identity.
    let modernCaptionQuote=null;
    if(post.modernLayout&&post.replyRouteVerified&&post.article){
      const frames=[...post.article.querySelectorAll(MODERN_FRAME)];
      if(frames.length===1){
        const frame=frames[0],articles=[...frame.querySelectorAll('article')];
        const bodies=[...frame.querySelectorAll(MODERN_BODY)];
        if(articles.length===1&&bodies.length===1&&articles[0].contains(bodies[0])&&
           frame.closest('article')===post.article&&frame.matches('[role="link"][data-href]')){
          try{
            const base=new URL(post.article.ownerDocument.baseURI),url=new URL(frame.getAttribute('data-href'),base);
            const id=url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1];
            const text=normalized(globalThis.ZaneReplyCopilotContent.postExtractor.readOriginalText(bodies[0]));
            if(url.origin===base.origin&&url.protocol==='https:'&&id&&id!==post.statusId&&text&&(post.quoteOnly?text===normalized(post.quotedText):text!==normalized(post.sourceText))){
              const links=[...frame.querySelectorAll('a[aria-hidden="true"][href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"]')].filter(a=>!a.closest(MODERN_BODY));
              if(links.every(a=>{const u=new URL(a.getAttribute('href'),base);return u.origin===base.origin&&u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1]===id;}))
                modernCaptionQuote=Object.freeze({id,text});
            }
          }catch{}
        }
      }
    }
    return {...post,hasCapturedPhoto,hasCapturedQuote,hasCapturedMedia:hasCapturedMedia||hasCapturedPhoto,...(modernCaptionQuote?(post.quoteOnly?{modernQuoteOnly:modernCaptionQuote}:{modernCaptionQuote}):{})};
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
  function routeAllowed(initial,current,statusId,modern=false) {
    if(!modern&&initial===current)return true;
    try {
      const a=new URL(initial),b=new URL(current);
      if(!modern)return a.origin===b.origin&&b.pathname==='/compose/post'&&(!b.searchParams.has('in_reply_to')||b.searchParams.get('in_reply_to')===statusId);
      if(a.origin!==b.origin)return false;
      if(b.pathname!=='/compose/post')return initial===current;
      if(b.searchParams.has('quote')||b.searchParams.has('quote_tweet_id'))return false;
      return !b.searchParams.has('in_reply_to')||
        globalThis.ZaneReplyCopilotContent.replyDetector.replyRouteId(current,initial)===statusId;
    }catch{return false;}
  }
  const MODERN_BODY='div[dir="auto"].whitespace-pre-wrap';
  const MODERN_FRAME='[data-slot="embedded-tweet-frame"]';
  // Only the preview BEFORE the editor can be the original post. Exclude
  // nested dialogs, quotes, the textarea's visual mirror, and our own UI.
  function beforeEditor(node,editor,dialog) {
    return visible(node)&&node.closest('[role="dialog"]')===dialog&&
      !node.contains(editor)&&!node.closest('[inert],[contenteditable="true"],[data-zane-reply-copilot]')&&
      Boolean(node.compareDocumentPosition(editor)&4);
  }
  function linklessPreviewConflict(dialog,editor,post,initialUrl) {
    for(const node of dialog.querySelectorAll('a[aria-hidden="true"][href*="/status/"],[data-href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"]')){
      if(node.closest('article')||node.closest(MODERN_FRAME)||inQuotedCard(node)||
         node.closest(MODERN_BODY)||node.contains(editor)||
         node.closest('[role="dialog"]')!==dialog||!(node.compareDocumentPosition(editor)&4))continue;
      try {
        const url=new URL(node.getAttribute('data-href')||node.getAttribute('href'),initialUrl);
        const base=new URL(initialUrl),id=url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1];
        if(url.origin!==base.origin||id!==post.statusId)return true;
      }catch{return true;}
    }
    return false;
  }
  function snapshot(document,post,initialUrl,currentUrl,now,quarantinedPosts=[]) {
    const api=globalThis.ZaneReplyCopilotContent;
    const original=post.article?.isConnected&&!post.legacyDetailIdentity?api.postExtractor.extractPost(post.article):null;
    const sourceUnchanged=!post.article?.isConnected||(post.legacyDetailIdentity?
      api.postExtractor.revalidateLegacyDetailSource(post,initialUrl):Boolean(original?.ok&&original.statusId===post.statusId));
    const nodes=new Set();
    const selector=selectorFor(document,post);
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    let visibleDialogCount=0;
    for (const dialog of dialogs) {
      let found=false;
      for (const editor of dialog.querySelectorAll(selector)) if(nodes.has(editor)||eligibleEditor(editor,post)){nodes.add(editor);found=true;}
      if(found)visibleDialogCount++;
    }
    const editors=[...nodes].map(node=>{
      const dialog=node.closest('[role="dialog"]');
      const modernContext=post.modernLayout===true||Boolean(post.replyRouteVerified&&hybridNativeEditor(node));
      const routeId=modernContext&&post.replyRouteVerified?api.replyDetector.replyRouteId(currentUrl,initialUrl):null;
      const articles=[...dialog.querySelectorAll('article')].filter(a=>visible(a)&&!a.contains(node)
        && !inQuotedCard(a) &&
        (!modernContext||!a.closest?.('[data-slot="embedded-tweet-frame"]')));
      // Quoted posts/media can add extra article nodes in the modal.
      // Identify the ONE article whose canonical status ID matches the
      // clicked target; never equate the first article with the parent.
      let candidates=articles.map(article=>({
        article, id:contextId(article,post.modernLayout===true,post.legacyDetailIdentity?initialUrl:null,post.statusId), text:api.postExtractor.postText(article)
      }));
      // On some rich-media reply modals X renders the original tweetText
      // directly in the dialog, without wrapping it in an article. The
      // fallback is STRICTLY scoped to this opened reply dialog, never
      // the feed behind it. A quoted preview cannot masquerade as the root.
      const bareTexts=[...dialog.querySelectorAll('[data-testid="tweetText"]')]
        .filter(textNode=>visible(textNode)&&!textNode.closest('article')&&
          !inQuotedCard(textNode)&&!textNode.closest('[contenteditable="true"]')&&(!modernContext||beforeEditor(textNode,node,dialog)));
      for(const textNode of bareTexts){
        const text=normalized(api.postExtractor.readOriginalText?.(textNode)||textNode.innerText||textNode.textContent);
        if(text)candidates.push({article:null,id:null,text});
      }
      // Real rebuilt X can show an unlinked DIV preview rather than an
      // article. This is supplementary evidence, never a text-only ID.
      if(modernContext)for(const textNode of dialog.querySelectorAll(MODERN_BODY)){
        if(!beforeEditor(textNode,node,dialog)||textNode.closest('article')||
           textNode.closest(MODERN_FRAME)||inQuotedCard(textNode))continue;
        const text=normalized(api.postExtractor.readOriginalText(textNode));
        if(text)candidates.push({article:null,id:null,text,node:textNode});
      }
      // Real captioned quote reply: linkless outer caption + one plain
      // embedded article BEFORE the same textarea. Do not discard arbitrary
      // extra articles. Require the trusted native route, exact two texts,
      // distinct captured quote ID, no conflicting canonical identity and
      // caption-before-quote ordering. Keep all ordinary/legacy rules intact.
      const routeQuote=post.modernLayout&&post.replyRouteVerified&&!post.quoteOnly&&post.modernCaptionQuote;
      const matchesCapturedQuote=(candidate,evidence)=>{
        const article=candidate?.article;
        if(!article||!evidence||normalized(candidate.text)!==evidence.text||
           (candidate.id!==null&&candidate.id!==evidence.id)||
           !beforeEditor(article,node,dialog)||article.querySelector('article,[data-slot="embedded-tweet-frame"]')||
           article.querySelectorAll(MODERN_BODY).length!==1)return false;
        const links=[...article.querySelectorAll('a[aria-hidden="true"][href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"],[data-href*="/status/"]')].filter(a=>!a.closest(MODERN_BODY));
        return links.every(a=>{try{
          const u=new URL(a.getAttribute('data-href')||a.getAttribute('href'),initialUrl);
          return u.origin===new URL(initialUrl).origin&&u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1]===evidence.id;
        }catch{return false;}});
      };
      const outOfOrderArticle=modernContext&&articles.some(article=>!beforeEditor(article,node,dialog));
      // A positively identified quote may hydrate before its caption.
      if(routeQuote&&routeId===post.statusId&&candidates.length===1&&articles.length===1&&
         matchesCapturedQuote(candidates[0],routeQuote))candidates=[];
      if(routeQuote&&routeId===post.statusId&&
         candidates.length===2&&articles.length===1){
        const quoted=candidates.find(c=>c.article),caption=candidates.find(c=>!c.article);
        const article=quoted?.article;
        if(article&&caption?.node&&caption.id===null&&sameContext(post,caption.text)&&
           matchesCapturedQuote(quoted,routeQuote)&&
           !article.contains(caption.node)&&Boolean(caption.node.compareDocumentPosition(article)&4)&&
           !quarantinedPosts.some(old=>old?.statusId!==post.statusId&&sameContext(old,caption.text)))candidates=[caption];
      }
      let unmarkedQuoteText='';
      const quoteOnlyEvidence=post.modernQuoteOnly;
      if(modernContext&&post.quoteOnly&&quoteOnlyEvidence&&routeId===post.statusId&&
         candidates.length===1&&articles.length===1&&matchesCapturedQuote(candidates[0],quoteOnlyEvidence)){
        unmarkedQuoteText=quoteOnlyEvidence.text;candidates=[];
      }
      const matching=candidates.filter(item=>item.id===post.statusId);
      // Only quote-only posts need this extra DOM check. X can show the
      // outer author/timestamp without an outer tweetText in the modal.
      // Require BOTH the verified outer ID and the same quoted preview.
      const quotePreview=post.quoteOnly && post.quotedText ? (()=>{
        // The modal can mount the parent timestamp before the embedded quote.
        // A missing preview is not a contradiction of an EXACT parent ID;
        // a visible, different preview remains a hard conflict.
        const marked=[...dialog.querySelectorAll('[data-testid="quoteTweet"] [data-testid="tweetText"]')];
        const roleCards=[...dialog.querySelectorAll('div[role="link"]')]
          .filter(card=>card.querySelector?.('[data-testid="User-Name"]'))
          .map(card=>card.querySelector?.('[data-testid="tweetText"]')).filter(Boolean);
        const nodes=[...new Set([...marked,...roleCards])];
        return {seen:nodes.length>0,matches:nodes.some(node=>
          normalized(api.postExtractor.readOriginalText?.(node)||node.innerText||node.textContent)===normalized(post.quotedText))};
      })() : {seen:false,matches:false};
      const quotedPreviewMatches=quotePreview.matches;
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
      let statusId=primary?.id||null;
      const quarantinedContextMatch=Boolean(primary&&text&&quarantinedPosts.some(old=>
        old?.statusId!==post.statusId&&sameContext(old,text)&&statusId!==post.statusId));
      // If the post ID is present it wins, even if X changed the display
      // text for translation. Otherwise demand a unique original-text match;
      // missing modal context should WAIT for React, not be rejected.
      // Require either the original exact parent ID in the dialog, or
      // the independently verified click-link AND current route ID with a
      // unique matching, linkless preview. Never bind by text alone.
      const modernQuotes=post.modernLayout&&post.quoteOnly?
        articles.flatMap(a=>api.postExtractor.modernQuoteTexts?.(a)||[]):[];
      const routeConflict=Boolean(modernContext&&linklessPreviewConflict(dialog,node,post,initialUrl));
      const editorUnsafe=modernContext&&node.localName==='textarea'&&
        (node.disabled||node.readOnly||node.getAttribute('aria-disabled')==='true'||
         node.getAttribute('aria-readonly')==='true'||!node.getAttribute('aria-label')||
         node.closest('[inert],[data-slot="embedded-tweet-frame"]')||node.closest('article'));
      const routeQuoteNodes=post.modernLayout&&post.quoteOnly?
        [...dialog.querySelectorAll(MODERN_FRAME+' '+MODERN_BODY)].filter(n=>beforeEditor(n,node,dialog)):[];
      const routeQuoteText=routeQuoteNodes.length===1&&!unmarkedQuoteText?normalized(api.postExtractor.readOriginalText(routeQuoteNodes[0])):routeQuoteNodes.length===0?unmarkedQuoteText:'';
      const quoteRoutePreview=post.modernLayout&&post.quoteOnly&&candidates.length===0&&routeQuoteText&&
        routeQuoteText===normalized(post.quotedText)&&!quarantinedPosts.some(old=>old?.statusId!==post.statusId&&sameContext(old,routeQuoteText));
      const ownRoutePreview=modernContext&&!post.quoteOnly&&candidates.length===1&&primary?.article===null&&
        primary?.id===null&&sameContext(post,primary.text);
      const linkless=modernContext&&post.replyRouteVerified&&routeId===post.statusId&&
        !routeConflict&&!quarantinedContextMatch&&(ownRoutePreview||quoteRoutePreview);
      const modernMatch=!modernContext?null:
        editorUnsafe||routeConflict||outOfOrderArticle||candidates.some(c=>c.id&&c.id!==post.statusId)||candidates.length>1?false:
        post.replyRouteVerified&&routeId!==post.statusId?null:
        linkless?true:
        matching.length!==1?null:
        modernQuotes.length>0&&!modernQuotes.every(t=>normalized(t)===normalized(post.quotedText))?false:true;
      if(linkless&&modernMatch===true)statusId=routeId;
      const detailMatch=post.legacyDetailIdentity?
        candidates.some(c=>(c.id&&c.id!==post.statusId)||(c.article&&!beforeEditor(c.article,node,dialog)))||matching.length>1?false:
        candidates.length!==1||matching.length!==1||!normalized(text)?null:
        sameContext(post,text):null;
      const contextMatches=post.legacyDetailIdentity?detailMatch:modernContext?modernMatch:post.quoteOnly
        ? !candidates.length?null
          :matching.length>1?false
          :matching.length===1?(!quotePreview.seen || quotedPreviewMatches)
          // Quote text alone cannot identify the reply target. Wait for
          // X's outer parent to hydrate instead of rejecting prematurely.
          :candidates.some(item=>Boolean(item.id))?false:null
        :!candidates.length?null
          :matching.length>1?false
          // A uniquely verified parent status ID is the strongest evidence.
        // X may hydrate its caption text later, especially around quotes.
        :matching.length===1?true
          // An explicit other parent/status identity must still fail closed.
          :candidates.some(item=>Boolean(item.id))?false
          // Preserve the original, unique exact-text fallback only when
          // no conflicting status IDs appear in the opened reply dialog.
          :uniqueText&&!uniqueText.id&&exactText.length===1?true
          // Only captioned quote layouts get a hydration grace; unrelated
          // non-quote or media text mismatches stay strict/fail-closed.
          :post.hasCapturedQuote?null
          :candidates.length===1&&!normalized(text)&&!statusId?null
          :false;
      const contextDetail=routeConflict?"route_preview_conflict":
        linkless&&contextMatches===true?"verified_route_preview":
        modernContext&&post.replyRouteVerified&&contextMatches===null?"awaiting_route_preview":
        contextMatches===true?"verified_context"
        :matching.length>1?"duplicate_parent_identity"
        :matching.length===1&&post.quoteOnly&&quotePreview.seen&&!quotedPreviewMatches?"quote_preview_mismatch"
        :!candidates.length?"awaiting_parent_article"
        :matching.length===0&&candidates.some(item=>Boolean(item.id))?"different_parent_identity"
        :post.quoteOnly?"awaiting_verified_parent"
        :post.hasCapturedQuote?"awaiting_captioned_quote_parent":"unconfirmed_context";
      return {node,dialog,modal:Boolean(dialog),focused:node===document.activeElement,
        empty:!api.composerAdapter.hasContent(node),contextStatusId:statusId,
        quarantinedContextMatch,
        contextArticleCount:articles.length,contextTextPresent:Boolean(normalized(text)||routeQuoteText),
        contextTextMatches:Boolean(primary&&sameContext(post,text)||quoteRoutePreview),
        contextMatches,contextDetail};
    });
    return {now,editors,visibleDialogCount,routeAllowed:routeAllowed(initialUrl,currentUrl,post.statusId,post.modernLayout===true||post.legacyDetailIdentity===true),
      sourceUnchanged};
  }
  globalThis.ZaneReplyCopilotContent.composerAssociation={create,baseline,snapshot,capturePost};
})();
