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
  // The social context banner identifies the REPOSTER, never the underlying
  // tweet that X's Reply control actually addresses.
  const REPOST_BANNER = '[data-testid="socialContext"]';
  function isRepostBanner(node, article) {
    const banner=node?.closest?.(REPOST_BANNER);
    return Boolean(banner && banner!==article && article?.contains?.(banner));
  }
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
    for (const time of article.querySelectorAll("time")) {
      if (time.closest("article") !== article || isQuoteContent(time, article) || isRepostBanner(time,article)) continue;
      const link = time.closest('a[href*="/status/"]');
      if (!link?.href || (typeof link.closest === "function" && link.closest("article") !== article)) continue;
      const identity = statusLink(link);
      if (identity) return identity;
    }
    // Older X layouts may lack a time element. Fall back only if there is
    // exactly one possible post ID; never guess between a post and its quote.
    const candidates = new Map();
    for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
      if (anchor.closest("article") !== article || isQuoteContent(anchor, article) || isRepostBanner(anchor,article)) continue;
      const identity = statusLink(anchor);
      if (identity) candidates.set(identity.statusId, identity);
    }
    return candidates.size === 1 ? candidates.values().next().value : null;
  }
  function postText(article) {
    // Do not concatenate all tweetText nodes: the rest can belong to
    // embedded quoted posts. Only the text of the target article is sent to AI.
    const primary = [...article.querySelectorAll('[data-testid="tweetText"]')]
      .find(node => node.closest("article") === article && !isQuoteContent(node, article) && !isRepostBanner(node,article));
    return (primary?.innerText || primary?.textContent || "").trim();
  }
  function extractPost(article) {
    if (!article?.matches?.("article")) return { ok: false, reason: "no-post" };
    const identity = postIdentity(article);
    const sourceText = postText(article);
    if (!identity || !sourceText) return { ok: false, reason: "post-context-incomplete" };
    return { ok: true, article, ...identity, sourceText };
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.postExtractor = { extractPost, postIdentity, postText, isQuoteContent, isRepostBanner };
})();
