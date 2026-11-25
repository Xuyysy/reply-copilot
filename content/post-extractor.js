(() => {
  const STATUS_HOSTS = new Set(["x.com", "twitter.com", "www.x.com", "www.twitter.com"]);
  function statusLink(anchor) {
    if (!anchor?.href) return null;
    try {
      const url = new URL(anchor.href, location.href);
      const match = url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/);
      if (url.protocol !== "https:" || !STATUS_HOSTS.has(url.hostname) || !match) return null;
      return { sourceUrl: url.origin + url.pathname.replace(/\/$/, ""), statusId: match[1] };
    } catch { return null; }
  }
  // X can put a quoted tweet inside the OUTER article without a nested
  // <article>. Such links/timestamps/text are not evidence of the post being
  // replied to. These selectors follow X's public DOM testid conventions.
  const QUOTE_CONTENT = '[data-testid="quoteTweet"], [data-testid="card.wrapper"]';
  // X sometimes uses a quoted DIV role=link card without quoteTweet.
  // Multiple public X extensions identify it by nested author + tweetText.
  // Requiring a separate outer tweetText was incorrect for quote-only posts.
  function roleLinkQuoteCard(card, article) {
    if(!card || card===article || !article?.contains?.(card) ||
       !card.querySelector?.('[data-testid="User-Name"]') ||
       !card.querySelector?.('[data-testid="tweetText"]')) return false;
    // A quote card is not proof of the OUTER post identity. If no distinct
    // parent timestamp/link exists, the postIdentity extractor still fails
    // closed rather than reusing the quoted author's status ID.
    return true;
  }
  function quoteCard(article) {
    const marked=article?.querySelector?.('[data-testid="quoteTweet"]');
    if(marked && marked!==article && article.contains?.(marked))return marked;
    for(const card of article?.querySelectorAll?.('div[role="link"]')||[]) {
      if(roleLinkQuoteCard(card,article))return card;
    }
    return null;
  }
  function isQuoteContent(node, article) {
    const quote=node?.closest?.(QUOTE_CONTENT);
    if(quote && quote!==article && article?.contains?.(quote))return true;
    const card=node?.closest?.('div[role="link"]');
    if(roleLinkQuoteCard(card,article))return true;
    // Older marked-up cards without a timestamp remain recognizable only
    // when there is distinct outer text, never from a lone ambiguous quote.
    if(!card || card===article || !article?.contains?.(card) ||
       !card.querySelector?.('[data-testid="User-Name"]') ||
       !card.querySelector?.('[data-testid="tweetText"]'))return false;
    return [...(article.querySelectorAll?.('[data-testid="tweetText"]')||[])]
      .some(text=>text.closest("article")===article&&!card.contains(text));
  }
  // New X Web adapter. Legacy posts keep their existing testid/timestamp
  // path; do not infer a status ID from arbitrary links or CSS alone.
  const MODERN_BODY='div[dir="auto"].whitespace-pre-wrap';
  const MODERN_FRAME='[data-slot="embedded-tweet-frame"]';
  function modernPage(doc) {
    return Boolean(doc?.documentElement?.getAttribute?.('data-app-version'));
  }
  function isModernPost(article) {
    if(!article?.matches?.('article')||article.matches?.('[data-testid="tweet"]'))return false;
    if(!(modernPage(article.ownerDocument) ||
       article.closest?.('div[role="link"][data-href]') ||
       article.querySelector?.('[data-engagement-action]')))return false;
    // Mixed/hybrid pages still use the legacy adapter for their own old
    // body markup. A nested quoted legacy body is not the outer post.
    return ![...(article.querySelectorAll?.('[data-testid="tweetText"]')||[])]
      .some(node=>node.closest('article')===article&&!isQuoteContent(node,article));
  }
  // Secondary evidence is deliberately local to an independently owned
  // native Reply anchor. Never derive a post identity from the page URL.
  function modernNativeReply(article) {
    const links=[...article.querySelectorAll('[data-engagement-action="reply"] a[href],a[data-engagement-action="reply"][href]')].filter(a=>
      modernOwned(a,article)&&a.closest('[data-engagement-action]')?.getAttribute('data-engagement-action')==='reply'&&
      !a.closest('form,[inert],[hidden],[aria-hidden="true"],[data-anchor-to-hovered-child],'+MODERN_BODY+',div[dir="auto"][lang]'));
    if(links.length!==1)return null;
    const id=globalThis.ZaneReplyCopilotContent?.replyDetector?.replyTargetId?.(links[0]);
    return id?{id,node:links[0]}:null;
  }
  function modernIdentityEvidence(article) {
    const ids=new Map();
    let invalid=false;
    const add=raw=>{
      if(!raw){invalid=true;return;}
      try {
        const u=new URL(raw,article.ownerDocument?.baseURI||location.href);
        const identity=statusLink({href:u.href});
        if(!identity){invalid=true;return;}
        ids.set(identity.statusId,identity);
      } catch {invalid=true;}
    };
    const wrapper=article.closest?.('div[role="link"][data-href]');
    if(wrapper && !article.contains?.(wrapper)) {
      const owned=[...wrapper.querySelectorAll('article')].filter(a=>
        a.closest('div[role="link"][data-href]')===wrapper &&
        !a.parentElement?.closest?.('article'));
      if(owned.length!==1||owned[0]!==article)invalid=true;
      else {
        add(wrapper.getAttribute('data-href'));
        for(const a of wrapper.querySelectorAll('a[aria-hidden="true"][href*="/status/"]')){
          if(a.closest('article')||a.closest(MODERN_FRAME)||
             a.closest('div[role="link"][data-href]')!==wrapper)continue;
          add(a.getAttribute('href'));
        }
      }
    }
    // A focal post can carry a hidden canonical permalink inside its
    // article; exclude embedded quote and ordinary content links.
    for(const a of article.querySelectorAll('a[aria-hidden="true"][href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"],a[href*="/status/"]:has(time)')){
      if(!modernOwned(a,article)||a.closest(MODERN_FRAME)||a.closest(MODERN_BODY+',div[dir="auto"][lang]')||
         a.closest('[data-engagement-action]'))continue;
      add(a.getAttribute('href'));
    }
    // Focal XDS markup can omit the hidden permalink, tooltip and <time>.
    // The active timestamp alone is insufficient: require the sole owned
    // native reply route to independently corroborate it. Fast-path
    // timeline/legacy evidence never incurs this fallback scan.
    if(!invalid&&ids.size===0){
      const links=[...article.querySelectorAll('a[data-status="active"][href*="/status/"]')].filter(a=>
        modernOwned(a,article)&&!a.closest('form,[inert],[hidden],[aria-hidden="true"],[data-engagement-action],[data-anchor-to-hovered-child],'+MODERN_BODY+',div[dir="auto"][lang]'));
      if(links.length){
        const reply=modernNativeReply(article);
        if(reply&&links.length===1){
          try{
            const base=new URL(article.ownerDocument.baseURI),url=new URL(links[0].getAttribute('href'),base);
            const identity=statusLink({href:url.href});
            if(url.origin!==base.origin||url.username||url.password||!identity||identity.statusId!==reply.id)invalid=true;
            else add(url.href);
          }catch{invalid=true;}
        }else if(links.length>1)invalid=true;
      }
    }
    return {identity:!invalid&&ids.size===1?ids.values().next().value:null,
      conflict:invalid||ids.size>1};
  }
  function modernOwned(node,article) {
    if(node.closest('article')!==article||isQuoteContent(node,article))return false;
    const frame=node.closest(MODERN_FRAME);
    return !frame||!article.contains(frame);
  }
  function modernBodyNodes(article) {
    const primary=[...article.querySelectorAll(MODERN_BODY)].filter(node=>modernOwned(node,article));
    if(primary.length)return primary;
    // Narrow secondary path for class-renamed feed/focal bodies. Require
    // positive native action ownership; never guess from arbitrary dir=auto
    // nodes, dialog contents, profile names, or the inline composer.
    const possible=[...article.querySelectorAll('div[dir="auto"][lang]')].filter(node=>
      modernOwned(node,article)&&Boolean(node.getAttribute('lang')?.trim())&&
      !node.closest('a,button,[role="button"],[role="group"],form,textarea,[contenteditable="true"],[data-media-upload-dropzone],[data-anchor-to-hovered-child],[data-post-avatar],aside,[hidden],[aria-hidden="true"],[inert]')&&
      node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
    if(possible.length!==1)return possible.length>1?possible:[];
    const reply=modernNativeReply(article);
    return reply&&(possible[0].compareDocumentPosition(reply.node)&4)?possible:[];
  }
  function modernBody(article) {
    const nodes=modernBodyNodes(article);
    return nodes.length===1?originalPostText(nodes[0]):"";
  }
  function modernQuoteTexts(article) {
    const cards=[...article.querySelectorAll(MODERN_FRAME+' article')].filter(a=>
      a.parentElement?.closest('article')===article);
    return cards.map(modernBody).filter(Boolean);
  }
  function legacyPostIdentity(article) {
    // The author's timestamp is more reliable than a random /status/ link:
    // quote cards, media and link previews can contain OTHER tweet IDs.
    const timed=new Map();
    for (const time of article.querySelectorAll("time")) {
      if (time.closest("article") !== article || isQuoteContent(time, article)) continue;
      const link = time.closest('a[href*="/status/"]');
      if (!link?.href || (typeof link.closest === "function" && link.closest("article") !== article)) continue;
      const identity = statusLink(link);
      if (identity) timed.set(identity.statusId,identity);
      // If a quote card loses its wrapper marker, never guess its timestamp
      // belongs to the outer post. Conflicting IDs fail closed.
      if (timed.size>1) return null;
    }
    if(timed.size===1)return timed.values().next().value;
    // Older X layouts may lack a time element. Fall back only if there is
    // exactly one possible post ID; never guess between a post and its quote.
    const candidates = new Map();
    for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
      if (anchor.closest("article") !== article || isQuoteContent(anchor, article)) continue;
      const identity = statusLink(anchor);
      if (identity) candidates.set(identity.statusId, identity);
    }
    return candidates.size === 1 ? candidates.values().next().value : null;
  }
  function postIdentity(article) {
    if (!article?.matches?.("article")) return null;
    return isModernPost(article)?modernIdentityEvidence(article).identity:legacyPostIdentity(article);
  }
  // In bilingual mode, use the original tweet, not an appended translation.
  // A translation-only rewrite cannot be reversed reliably; never fabricate.
  const TRANSLATION_ADDITIONS=[
    ".immersive-translate-translation",
    ".immersive-translate-translation-wrapper",
    // Current Immersive Translate page CSS uses these target wrappers.
    ".immersive-translate-target-translation-block-wrapper",
    ".immersive-translate-target-translation-inline-wrapper",
    "[data-imt-translation-only='1']",
    "[data-immersive-translate-translation]",
    "[data-immersive-translate-translation-element]"
  ].join(",");
  function originalPostText(node) {
    if(!node)return "";
    if(node.querySelector?.(TRANSLATION_ADDITIONS)) {
      const clone=node.cloneNode?.(true);
      if(clone) {
        for(const translation of clone.querySelectorAll(TRANSLATION_ADDITIONS))translation.remove();
        const original=(clone.innerText||clone.textContent||"").trim();
        if(original)return original;
      }
    }
    return (node.innerText||node.textContent||"").trim();
  }
  function legacyPostText(article) {
    // Never select a nested quoted post as the reply target.
    const primary=[...article.querySelectorAll('[data-testid="tweetText"]')]
      .find(node=>node.closest("article")===article&&!isQuoteContent(node,article));
    return originalPostText(primary);
  }
  function postText(article) {
    return isModernPost(article)?modernBody(article):legacyPostText(article);
  }
  function legacyQuoteText(article) {
    // Only read nested content if a real X quote card exists.
    const card=quoteCard(article);
    if (!card) return "";
    const quoted=card.querySelector?.('[data-testid="tweetText"]');
    return originalPostText(quoted);
  }
  function extractPost(article) {
    if (!article?.matches?.("article")) return { ok: false, reason: "no-post" };
    const modernLayout=isModernPost(article);
    // Resolve the modern path once: the hot activation/snapshot path used
    // to classify the same article repeatedly and scan body nodes twice.
    // Leave the established legacy extractor below untouched.
    if(modernLayout){
      if(article.parentElement?.closest?.('article,[data-slot="embedded-tweet-frame"]'))return {ok:false,reason:"post-context-incomplete"};
      const bodies=modernBodyNodes(article);
      if(bodies.length>1)return {ok:false,reason:"post-context-incomplete"};
      const identity=modernIdentityEvidence(article).identity;
      if(!identity)return {ok:false,reason:"post-context-incomplete"};
      const ownText=bodies.length===1?originalPostText(bodies[0]):"";
      const quotes=ownText?[]:modernQuoteTexts(article);
      const quotedText=quotes.length===1?quotes[0]:"";
      const sourceText=ownText||quotedText;
      if(!sourceText)return {ok:false,reason:"post-context-incomplete"};
      return {ok:true,article,...identity,sourceText,modernLayout:true,quoteOnly:!ownText&&Boolean(quotedText),quotedText:quotedText||null};
    }
    const identity = legacyPostIdentity(article);
    const ownText = legacyPostText(article);
    // A quote-only post has a canonical OUTER post ID but no own tweetText.
    // Use the visibly attached quote as context, never its ID as the target.
    const quotedText = ownText ? "" : legacyQuoteText(article);
    const sourceText = ownText || quotedText;
    if (!identity || !sourceText) return { ok: false, reason: "post-context-incomplete" };
    return { ok: true, article, ...identity, sourceText,
      quoteOnly: !ownText && Boolean(quotedText), quotedText: quotedText || null };
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.postExtractor = { extractPost, postIdentity, postText, isQuoteContent, readOriginalText: originalPostText, isModernPost, modernPage, modernIdentityEvidence, modernQuoteTexts };
})();
