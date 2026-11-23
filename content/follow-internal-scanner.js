// X web-client internal endpoint test. Explicitly initiated, same-origin,
 // read-only, and limited to the signed-in account's own follow lists.
 // Non-public X requests may stop working or be rate-limited without notice.
(() => {
  const dom = globalThis.ReplyCopilotFollowDom;
  const parser = globalThis.ReplyCopilotInternalFollowParser;
  if (!dom || !parser) return;
  const marker = Symbol.for("xrh.internal-follow-v1");
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  // This is X's web-client bearer value, not a user's secret credential.
  const WEB_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const QUERIES = Object.freeze({
    UserByScreenName:"BQ6xjFU6Mgm-WhEP3OiT9w",
    Following:"eWTmcJY3EMh-dxIR7CYTKw",
    Followers:"1cgQROvByT7VpDSj3Ps5SQ"
  });
  const FEATURES = Object.freeze({
    rweb_tipjar_consumption_enabled:true,
    responsive_web_graphql_exclude_directive_enabled:true,
    verified_phone_label_enabled:false,
    creator_subscriptions_tweet_preview_api_enabled:true,
    responsive_web_twitter_article_notes_tab_enabled:true,
    responsive_web_graphql_timeline_navigation_enabled:true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled:false,
    communities_web_enable_tweet_community_results_fetch:true,
    c9s_tweet_anatomy_moderator_badge_enabled:true,
    articles_preview_enabled:true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled:true,
    view_counts_everywhere_api_enabled:true,
    longform_notetweets_consumption_enabled:true,
    longform_notetweets_rich_text_read_enabled:true,
    responsive_web_enhance_cards_enabled:false,
    hidden_profile_subscriptions_enabled:true,
    subscriptions_verification_info_is_identity_verified_enabled:true,
    highlights_tweets_tab_ui_enabled:true,
    standardized_nudges_misinfo:true,
    rweb_video_timestamps_enabled:true
  });
  const MAX_USERS = 3000;
  const MAX_PAGES = 160;
  const MAX_MS = 5 * 60 * 1000;
  const PAGE_DELAY_MS = 1800;
  let active = null;
  const send = payload => {
    try { void chrome.runtime.sendMessage(payload).catch(() => {}); } catch {}
  };
  const originValid = () => location.protocol === "https:" &&
    ["x.com","www.x.com","twitter.com","www.twitter.com"].includes(location.hostname);
  const matches = (owner,kind) => {
    const here = dom.route(location.pathname);
    return originValid() && here?.owner === owner && here?.kind === kind;
  };
  function csrfToken() {
    // Only ct0 is used as a request header sent to X itself. Never read
    // auth_token, send any cookie to the extension, store, or log it.
    const raw = /(?:^|;)\s*ct0=([^;]+)/.exec(document.cookie)?.[1];
    if (!raw || raw.length > 512) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  function buildUrl(operation, variables) {
    if (!Object.hasOwn(QUERIES,operation)) throw new Error("schema");
    const params = new URLSearchParams({
      variables:JSON.stringify(variables),
      features:JSON.stringify(FEATURES),
      fieldToggles:JSON.stringify({withAuxiliaryUserLabels:false})
    });
    return location.origin + "/i/api/graphql/" + QUERIES[operation] + "/" + operation + "?" + params;
  }
  function validateSelf(session) {
    if (!matches(session.owner,session.kind)) throw new Error("page_changed");
    const account = dom.loggedInHandle(document);
    // Fail closed: without an unambiguous account link, cannot establish ownership.
    if (!account || account !== session.owner) throw new Error("account_mismatch");
    if (session.cancelled || session.controller.signal.aborted) throw new Error("cancelled");
  }
  async function request(operation,variables,session) {
    validateSelf(session);
    const token = csrfToken();
    if (!token) throw new Error("login_required");
    let response;
    try {
      response = await fetch(buildUrl(operation,variables),{
        method:"GET",
        credentials:"include",
        headers:{
          authorization:"Bearer " + WEB_BEARER,
          "x-csrf-token":token,
          "x-twitter-auth-type":"OAuth2Session",
          "x-twitter-active-user":"yes",
          "x-twitter-client-language":"en",
          accept:"application/json"
        },
        cache:"no-store",
        signal:session.controller.signal
      });
    } catch (error) {
      if (session.cancelled || error?.name === "AbortError") throw new Error("cancelled");
      throw new Error("network");
    }
    if (response.status === 401 || response.status === 403) throw new Error("login_required");
    if (response.status === 429) throw new Error("rate_limited");
    if (response.status === 404) throw new Error("schema");
    if (!response.ok) throw new Error("http_" + response.status);
    let payload;
    try { payload = await response.json(); } catch { throw new Error("schema"); }
    if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error("schema");
    validateSelf(session);
    return payload;
  }
  function pause(ms,session) {
    return new Promise((resolve,reject) => {
      const signal = session.controller.signal;
      if (signal.aborted) { reject(new Error("cancelled")); return; }
      const timer = setTimeout(() => { signal.removeEventListener("abort",abort);resolve(); },ms);
      function abort() { clearTimeout(timer);reject(new Error("cancelled")); }
      signal.addEventListener("abort",abort,{once:true});
    });
  }
  async function run(session) {
    let reason = "schema";
    const handles = [];
    const ids = new Set();
    try {
      validateSelf(session);
      const profile = parser.parseProfile(await request("UserByScreenName",
        {screen_name:session.owner,withSafetyModeUserFields:true},session));
      if (profile.handle !== session.owner) throw new Error("account_mismatch");
      const started = Date.now();
      const operation = session.kind === "following" ? "Following" : "Followers";
      let cursor = null;
      const seenCursors = new Set();
      for (let page = 1;page <= MAX_PAGES;page++) {
        validateSelf(session);
        if (Date.now() - started >= MAX_MS) { reason="timeout"; break; }
        const vars = {userId:profile.id,count:20,includePromotedContent:false};
        if (cursor) vars.cursor = cursor;
        const result = parser.parsePage(await request(operation,vars,session));
        for (const u of result.users) {
          if (ids.has(u.id)) continue;
          ids.add(u.id);
          handles.push(u.handle);
          if (handles.length >= MAX_USERS) break;
        }
        session.pages=page;
        send({type:"XRH_INTERNAL_PROGRESS",scanId:session.scanId,kind:session.kind,
          count:handles.length,pages:page});
        if (handles.length >= MAX_USERS) { reason="limit";break; }
        if (!result.nextCursor) {
          reason = handles.length ? "complete" : "empty";
          break;
        }
        if (seenCursors.has(result.nextCursor)) {reason="cursor_loop";break;}
        seenCursors.add(result.nextCursor);
        cursor = result.nextCursor;
        if (page === MAX_PAGES) {reason="limit";break;}
        await pause(PAGE_DELAY_MS,session);
      }
    } catch(error) {
      reason = session.cancelled ? "cancelled" : (
        ["cancelled","page_changed","account_mismatch","login_required","rate_limited",
         "schema","network"].includes(error?.message) ? error.message : "schema");
    } finally {
      if (active === session) active = null;
      // Only usernames leave this X tab. Do not transfer user session headers.
      send({type:"XRH_INTERNAL_DONE",scanId:session.scanId,kind:session.kind,reason,
        handles,pages:seenCursorsCount(session)});
    }
  }
  // Page count is already reported with progress. Terminal message is the source
  // of truth for data; it deliberately never contains headers or csrf tokens.
  function seenCursorsCount(session) { return session.pages || 0; }
  chrome.runtime.onMessage.addListener((msg,sender,respond) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg !== "object") return;
    if (msg.type === "XRH_INTERNAL_PING") {
      respond({ok:originValid(),route:dom.route(location.pathname),
        loggedIn:dom.loggedInHandle(document)});
      return;
    }
    if (msg.type === "XRH_INTERNAL_CANCEL") {
      if (active?.scanId === msg.scanId) {
        active.cancelled=true;
        active.controller.abort();
        respond({ok:true});
      } else respond({ok:false});
      return;
    }
    if (msg.type !== "XRH_INTERNAL_START") return;
    const owner = dom.normalize(msg.owner);
    const kind = msg.kind;
    if (!owner || !["following","followers"].includes(kind) ||
        !/^[0-9a-f-]{36}$/.test(String(msg.scanId)) || !matches(owner,kind)) {
      respond({ok:false,error:"当前 X 页面或账号不匹配。"});return;
    }
    const loggedIn = dom.loggedInHandle(document);
    if (!loggedIn || loggedIn !== owner) {
      respond({ok:false,error:"请在 X 登录对应账号后重试。"});return;
    }
    if (active) {respond({ok:false,error:"X 页面有正在运行的同步任务。"});return;}
    const session={scanId:msg.scanId,owner,kind,cancelled:false,
      controller:new AbortController(),pages:0};
    active=session;
    respond({ok:true});
    void run(session);
  });
})();
