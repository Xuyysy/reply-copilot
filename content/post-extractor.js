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
  function isQuoteContent(node, article) {
    const quote = node?.closest?.(QUOTE_CONTENT);
    if (quote && quote !== article && article?.contains?.(quote)) return true;
    // Some X layouts render a quote as a role=link card without
    // data-testid=quoteTweet. Require a distinct main text node OUTSIDE
    // that card, so we never mistake the whole main article for a quote.
    const card = node?.closest?.('[role="link"]');
    if (!card || card===article || !article?.contains?.(card) ||
        !card.querySelector?.('[data-testid="User-Name"]') ||
        !card.querySelector?.('[data-testid="tweetText"]')) return false;
    return [...(article.querySelectorAll?.('[data-testid="tweetText"]')||[])]
      .some(text => text.closest("article")===article && !card.contains(text));
  }
  function postIdentity(article) {
    if (!article?.matches?.("article")) return null;
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
  function postText(article) {
    // Never select a nested quoted post as the reply target.
    const primary=[...article.querySelectorAll('[data-testid="tweetText"]')]
      .find(node=>node.closest("article")===article&&!isQuoteContent(node,article));
    return originalPostText(primary);
  }
  function quoteText(article) {
    // Fast path for normal tweets: only read nested content if a real X
    // quote card exists. No permalink lookup, network, or unrelated card.
    const card=article?.querySelector?.('[data-testid="quoteTweet"]');
    if (!card || card===article || !article.contains?.(card)) return "";
    const quoted=card.querySelector?.('[data-testid="tweetText"]');
    return originalPostText(quoted);
  }
  function extractPost(article) {
    if (!article?.matches?.("article")) return { ok: false, reason: "no-post" };
    const identity = postIdentity(article);
    const ownText = postText(article);
    // A quote-only post has a canonical OUTER post ID but no own tweetText.
    // Use the visibly attached quote as context, never its ID as the target.
    const quotedText = ownText ? "" : quoteText(article);
    const sourceText = ownText || quotedText;
    if (!identity || !sourceText) return { ok: false, reason: "post-context-incomplete" };
    return { ok: true, article, ...identity, sourceText,
      quoteOnly: !ownText && Boolean(quotedText), quotedText: quotedText || null };
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.postExtractor = { extractPost, postIdentity, postText, isQuoteContent };
})();
