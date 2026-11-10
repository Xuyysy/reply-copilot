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
  function postIdentity(article) {
    if (!article?.matches?.("article")) return null;
    // The author's timestamp is more reliable than a random /status/ link:
    // quote cards, media and link previews can contain OTHER tweet IDs.
    for (const time of article.querySelectorAll("time")) {
      if (time.closest("article") !== article) continue;
      const link = time.closest('a[href*="/status/"]');
      if (link?.closest("article") !== article) continue;
      const identity = statusLink(link);
      if (identity) return identity;
    }
    // Older X layouts may lack a time element. Fall back only if there is
    // exactly one possible post ID; never guess between a post and its quote.
    const candidates = new Map();
    for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
      if (anchor.closest("article") !== article) continue;
      const identity = statusLink(anchor);
      if (identity) candidates.set(identity.statusId, identity);
    }
    return candidates.size === 1 ? candidates.values().next().value : null;
  }
  function postText(article) {
    // Do not concatenate all tweetText nodes: the rest can belong to
    // embedded quoted posts. Only the text of the target article is sent to AI.
    const primary = [...article.querySelectorAll('[data-testid="tweetText"]')]
      .find(node => node.closest("article") === article);
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
  globalThis.ZaneReplyCopilotContent.postExtractor = { extractPost, postIdentity, postText };
})();
