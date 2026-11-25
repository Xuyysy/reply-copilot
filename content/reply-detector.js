(() => {
  // X exposes stable data-testid=reply even when the UI is localized.
  const labels = new Set([
    "reply", "回复", "回覆", "返信", "답글", "답글 달기",
    "responder", "répondre", "antworten", "rispondi", "ответить",
    "رد", "balas", "trả lời", "ตอบกลับ", "yanıtla", "जवाब दें",
    "odpowiedz", "beantwoorden", "відповісти"
  ]);
  const X_HOSTS=new Set(['x.com','twitter.com','www.x.com','www.twitter.com']);
  // Parse only native, same-origin reply routes. Duplicate parameters,
  // quote/new-post routes and off-site links cannot identify a reply.
  function replyRouteId(raw,base) {
    if(!raw||!base)return null;
    try {
      const from=new URL(base),url=new URL(raw,from);
      const ids=url.searchParams.getAll('in_reply_to');
      if(from.protocol!=='https:'||!X_HOSTS.has(from.hostname)||
         url.origin!==from.origin||url.username||url.password||url.hash||
         url.pathname!=='/compose/post'||ids.length!==1||!/^\d+$/.test(ids[0])||
         url.searchParams.has('quote')||url.searchParams.has('quote_tweet_id'))return null;
      return ids[0];
    }catch{return null;}
  }
  function replyTargetId(element) {
    if(element?.localName!=='a')return null;
    return replyRouteId(element.getAttribute('href'),element.ownerDocument?.baseURI);
  }
  function isReplyControl(element) {
    if (!element?.matches?.('button,[role="button"],a')) return false;
    if (element.getAttribute("data-testid") === "reply") return true;
    // New X Web exposes explicit engagement actions, not legacy testids.
    // Do not treat submit buttons or unrelated engagement actions as Reply.
    // In the rebuilt UI the marker lives on a wrapping div, while the
    // actual click is an anchor (possibly through SVG/span descendants).
    const article=element.closest?.("article");
    const modern=globalThis.ZaneReplyCopilotContent?.postExtractor?.isModernPost?.(article)===true;
    const ownAction=element.getAttribute("data-engagement-action");
    // Keep 0.3.15 legacy/hybrid behavior exactly, even when a surrounding
    // modern page exposes engagement attributes on unrelated ancestors.
    if(!modern&&ownAction) {
      return ownAction==="reply" && Boolean(article) &&
        !article.parentElement?.closest?.('article,[data-slot="embedded-tweet-frame"]');
    }
    // A native anchor can roll out on a legacy article. Only accept an
    // explicit own reply wrapper, independently parsed exact native href;
    // legacy label/testid behavior stays unchanged.
    if(!modern&&article&&element.localName==='a'&&replyTargetId(element)){
      const hybridOwner=element.closest('[data-engagement-action]');
      if(hybridOwner?.getAttribute('data-engagement-action')==='reply'&&hybridOwner.closest('article')===article&&
         !element.closest('[data-slot="embedded-tweet-frame"],[data-testid="quoteTweet"],[data-testid="card.wrapper"]')&&
         !article.parentElement?.closest('article,[data-slot="embedded-tweet-frame"]')&&
         !globalThis.ZaneReplyCopilotContent?.postExtractor?.isQuoteContent?.(element,article))return true;
    }
    const owner=modern?element.closest?.('[data-engagement-action]'):null;
    const action=modern&&(ownAction||owner?.getAttribute?.("data-engagement-action"));
    if(action) {
      if(action!=="reply"||!article||
         (owner&&owner.closest?.('article')!==article)||
         element.closest?.('[data-slot="embedded-tweet-frame"],[data-testid="quoteTweet"],[data-testid="card.wrapper"]')||
         article.parentElement?.closest?.('article,[data-slot="embedded-tweet-frame"]'))return false;
      return element.localName!=='a'||Boolean(replyTargetId(element));
    }
    // Exact UI labels only: never treat "Replying to", a user bio, or a
    // nearby translation/action menu as a reply click.
    for (const label of [element.getAttribute("aria-label"), element.innerText || element.textContent]) {
      const normalized = (label || "").normalize("NFKC").trim().toLocaleLowerCase();
      if (labels.has(normalized) || /^reply\s+\d+(?:[.,]\d+)?$/i.test(normalized)) return true;
    }
    return false;
  }
  function findReplyControl(target, event) {
    // Preserve the original element API for existing callers. Only when the
    // event target is retargeted by translation/shadow wrappers, inspect the
    // original browser event's composed path for a verified X Reply control.
    const direct=target?.closest?.('button,[role="button"],a');
    if(isReplyControl(direct))return direct;
    const path=typeof event?.composedPath==="function" ? event.composedPath():[];
    for(const node of path) {
      const control=node?.closest?.('button,[role="button"],a');
      if(isReplyControl(control))return control;
    }
    return null;
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.replyDetector = { isReplyControl, findReplyControl, replyTargetId, replyRouteId };
})();
