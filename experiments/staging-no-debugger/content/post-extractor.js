(() => {
  const STATUS_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
  const STATUS_PATH = /^\/(?:([^/]+)\/status|(i\/web)\/status)\/(\d+)(?:\/(?:photo\/\d+|video\/\d+))?\/?$/;

  function ownNodes(article, selector) {
    return [...article.querySelectorAll(selector)].filter(node => node.closest('article') === article);
  }

  function statusIdentity(article) {
    for (const anchor of ownNodes(article, 'a[href*="/status/"]')) {
      try {
        const url = new URL(anchor.href, location.href);
        if (url.protocol !== 'https:' || !STATUS_HOSTS.has(url.hostname.toLowerCase())) continue;
        const match = url.pathname.match(STATUS_PATH);
        if (!match) continue;
        const id = match[3];
        const path = match[2] ? `/i/web/status/${id}` : `/${match[1]}/status/${id}`;
        return { statusId: id, sourceUrl: `https://x.com${path}` };
      } catch { /* malformed or non-X link */ }
    }
    return null;
  }

  function detectPostKinds(article) {
    const kinds = [];
    if (article.querySelectorAll('article').length) kinds.push('quote');
    if (ownNodes(article, 'a[href*="/photo/"]').length) kinds.push('photo');
    if (ownNodes(article, '[data-testid="videoPlayer"], video').length) kinds.push('video');
    if (ownNodes(article, '[data-testid="poll"], [role="group"][aria-label*="poll" i]').length) kinds.push('poll');
    if (ownNodes(article, '[data-testid*="longform" i], [data-testid="longformRichText"]').length) kinds.push('longform');
    if (!kinds.length) kinds.push('text');
    return kinds;
  }

  function extractPost(article) {
    if (!article?.matches?.('article')) return { ok: false, reason: 'no_post', statusLinkCount: 0, textNodeCount: 0, postKinds: [] };
    const identity = statusIdentity(article);
    const tweetNodes = ownNodes(article, '[data-testid="tweetText"]');
    const longformNodes = tweetNodes.length ? [] : ownNodes(article, '[data-testid="longformRichText"]');
    const textNodes = tweetNodes.length ? tweetNodes : longformNodes;
    const sourceText = textNodes.map(node => (node.innerText || node.textContent || '').trim()).filter(Boolean).join('\n').trim();
    const postKinds = detectPostKinds(article);
    const evidence = {
      statusLinkCount: ownNodes(article, 'a[href*="/status/"]').length,
      validStatus: Boolean(identity),
      textNodeCount: textNodes.length,
      textPresent: Boolean(sourceText),
      postKinds
    };
    if (!identity) return { ok: false, reason: 'status_id_unavailable', ...evidence };
    if (!sourceText) return { ok: false, reason: 'post_text_unavailable', statusId: identity.statusId, sourceUrl: identity.sourceUrl, ...evidence };
    return { ok: true, article, sourceUrl: identity.sourceUrl, sourceText, statusId: identity.statusId, postKinds, evidence };
  }

  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.postExtractor = { extractPost };
})();
