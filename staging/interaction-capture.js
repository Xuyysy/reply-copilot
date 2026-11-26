// Staging only. No observer, timer, network, credential access or page-world hook.
// Read only when the user presses the button in the extension panel.
(() => {
  const profile = value => {
    try {
      const u = new URL(value, 'https://x.com');
      if (!['https://x.com','https://twitter.com'].includes(u.origin)) return null;
      const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);
      return m && !/^(home|notifications|explore|messages|search|settings|i|compose)$/i.test(m[1]) ? m[1].toLowerCase() : null;
    } catch { return null; }
  };
  const status = value => {
    try {
      const u = new URL(value,'https://x.com');
      if (!['https://x.com','https://twitter.com'].includes(u.origin)) return null;
      const m = /^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,19})\/?$/.exec(u.pathname);
      return m ? {handle:m[1].toLowerCase(),id:m[2]} : null;
    } catch { return null; }
  };
  const action = text => {
    const s = String(text || '').trim();
    if (/^(?:liked your (?:post|tweet)|赞了你的(?:帖子|推文)|喜欢了你的(?:帖子|推文))[.!。！]?$/i.test(s)) return 'like';
    if (/^(?:reposted your (?:post|tweet)|retweeted your (?:post|tweet)|转发了你的(?:帖子|推文)|转载了你的(?:帖子|推文))[.!。！]?$/i.test(s)) return 'repost';
    return null;
  };
  function visible(el) {
    return !!el && el.getClientRects().length > 0 && !el.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden';
  }
  function collect(doc, loc) {
    if (!['https://x.com','https://twitter.com'].includes(loc.origin) || !/^\/notifications(?:\/(?:mentions|verified))?\/?$/.test(loc.pathname))
      return {ok:false,reason:'open_notifications'};
    const self = new Set([...doc.querySelectorAll('a[data-testid="AppTabBar_Profile_Link"][href]')].filter(visible).map(a=>profile(a.getAttribute('href'))).filter(Boolean));
    if (self.size !== 1) return {ok:false,reason:'owner_unknown'};
    const owner = [...self][0];
    const rows = [...doc.querySelectorAll('[data-testid="notification"],article[data-testid="tweet"]')].filter(el=>visible(el)&&!el.parentElement?.closest('[data-testid="notification"],article[data-testid="tweet"]'));
    const events = [];
    let unresolved = 0;
    for (const [rowIndex,row] of rows.slice(0,200).entries()) {
      const anchors = [...row.querySelectorAll('a[href]')].filter(visible);
      const refs = anchors.map(a=>status(a.getAttribute('href'))).filter(Boolean);
      if (row.matches('[data-testid="notification"]')) {
        // Only exact action labels, never classify from embedded tweet text.
        const labels = [...row.querySelectorAll('span')].slice(0,150).filter(s=>s.children.length===0 && visible(s) && !s.closest('[data-testid="tweetText"],article,[data-testid="card.wrapper"]') && action(s.textContent));
        const types = new Set(labels.map(s=>action(s.textContent)));
        if (types.size!==1) { unresolved++; continue; }
        const label=labels[0], type=[...types][0];
        // Only profile links before the action label and outside embedded content.
        const actors = new Set(anchors.filter(a=>!a.closest('article,[data-testid="tweetText"],[data-testid="card.wrapper"]') && (a.compareDocumentPosition(label)&4)).map(a=>profile(a.getAttribute('href'))).filter(h=>h&&h!==owner));
        if (!actors.size || actors.size>50) { unresolved++; continue; }
        const targets = [...new Set(refs.filter(r=>r.handle===owner).map(r=>r.id))];
        for (const actor of actors) events.push({actor,type,row:rowIndex,postId:targets.length===1?targets[0]:null});
      } else {
        // Confirm a reply only if the visible reply-context explicitly names the owner.
        const authors = [...new Set([...row.querySelectorAll('[data-testid="User-Name"] a[href]')].filter(visible).map(a=>profile(a.getAttribute('href'))).filter(Boolean))];
        if (authors.length!==1 || authors[0]===owner) {unresolved++;continue;}
        const actor=authors[0];
        const context=[...row.querySelectorAll('div,span')].slice(0,300).filter(el=>{
          if (!visible(el)||el.closest('[data-testid="tweetText"],[data-testid="card.wrapper"],[data-testid="User-Name"]')) return false;
          const text=(el.innerText||'').trim();
          return /^(?:Replying to|回复)\s+@/i.test(text)&&text.length<=180&&[...el.querySelectorAll('a[href]')].some(a=>profile(a.getAttribute('href'))===owner);
        });
        const ids=[...new Set([...row.querySelectorAll('[data-testid="User-Name"] a[href]')].map(a=>status(a.getAttribute('href'))).filter(r=>r?.handle===actor).map(r=>r.id))];
        if (!context.length||ids.length!==1) {unresolved++;continue;}
        events.push({actor,type:'reply',row:rowIndex,postId:ids[0]});
      }
    }
    return {ok:true,owner,events,scanned:Math.min(rows.length,200),unresolved,truncated:rows.length>200};
  }
  // Expose pure helpers only to the isolated world and local tests.
  globalThis.ReplyCopilotInteractionCapture=Object.freeze({profile,status,action,collect});
  if (typeof chrome!=='undefined'&&chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (message?.type!=='REPLY_COPILOT_STAGING_READ_VISIBLE_INTERACTIONS') return;
    if (sender.id!==chrome.runtime.id) return;
    try {respond(collect(document,location));} catch {respond({ok:false,reason:'parse_failed'});}
  });
})();
