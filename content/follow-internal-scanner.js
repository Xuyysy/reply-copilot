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
    creator_subscriptions_tweet_preview_api_enabled:true,
    creator_subscriptions_quote_tweet_preview_api_enabled:false,
    tweet_awards_web_tipping_enabled:false,
    freedom_of_speech_not_reach_fetch_enabled:true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:true,
    longform_notetweets_inline_media_enabled:true,
    subscriptions_verification_info_verified_since_enabled:true,
    subscriptions_feature_can_gift_premium:true,
    standardized_nudges_misinfo:true,
    rweb_video_timestamps_enabled:true
  });
  // Bounded, user-initiated batches. Reaching a batch budget pauses instead
  // of truncating the entire list or automatically bypassing a rate limit.
  const MAX_USERS = 30000;
  const MAX_BATCH_ADDED = 3000;
  const MAX_PAGES = 120;
  const MAX_MS = 4 * 60 * 1000;
  const PAGE_DELAY_MS = 1800;
  const CHECKPOINT_EVERY = 8;
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
  function currentQueryId(operation) {
    if (!Object.hasOwn(QUERIES,operation)) throw new Error("schema");
    // Prefer query IDs the signed-in X page already used. Reading same-origin
    // performance entries makes no additional requests and avoids fetching
    // executable bundles or reading hidden application state.
    try {
      const entries = typeof performance !== "undefined" &&
        typeof performance.getEntriesByType === "function" ?
        performance.getEntriesByType("resource") : [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const observed = new URL(entries[i].name);
        if (observed.origin !== location.origin) continue;
        const match = /^\/i\/api\/graphql\/([A-Za-z0-9_-]{8,100})\/([A-Za-z0-9_]+)$/.exec(observed.pathname);
        if (match && match[2] === operation) return match[1];
      }
    } catch {}
    return QUERIES[operation];
  }
  function endpoint(operation) {
    return location.origin + "/i/api/graphql/" + currentQueryId(operation) + "/" + operation;
  }
  function buildUrl(operation, variables) {
    const params = new URLSearchParams({
      variables:JSON.stringify(variables),
      features:JSON.stringify(FEATURES),
      fieldToggles:JSON.stringify({withAuxiliaryUserLabels:false})
    });
    return endpoint(operation) + "?" + params;
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
      // As observed in newer X web clients, relationship timeline *queries*
      // may use POST; this is a read-only GraphQL operation, not a mutation.
      const isList = operation === "Followers" || operation === "Following";
      const options={
        method:isList ? "POST" : "GET",
        credentials:"include",
        headers:{
          authorization:"Bearer " + WEB_BEARER,
          "x-csrf-token":token,
          "x-twitter-auth-type":"OAuth2Session",
          "x-twitter-active-user":"yes",
          "x-twitter-client-language":"en",
          accept:"application/json",
          ...(isList ? {"content-type":"application/json"} : {})
        },
        cache:"no-store",
        signal:session.controller.signal
      };
      if (isList) {
        options.body=JSON.stringify({variables,features:FEATURES});
      }
      response = await fetch(isList ? endpoint(operation) : buildUrl(operation,variables), options);
    } catch (error) {
      if (session.cancelled || error?.name === "AbortError") throw new Error("cancelled");
      throw new Error("network");
    }
    if (response.status === 401 || response.status === 403) throw new Error("login_required");
    if (response.status === 429) throw new Error("rate_limited");
    if (response.status === 404) throw new Error("query_not_found");
    if (response.status === 400 || response.status === 422) throw new Error("invalid_request");
    if (!response.ok) throw new Error("http_error");
    let payload;
    try { payload = await response.json(); } catch { throw new Error("invalid_json"); }
    if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error("graphql_error");
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
  function checkpoint(session,reason,cursor,handles,verification,ids) {
    return {
      handles:[...handles], verification:{...verification}, ids:{...ids},
      cursor:cursor || null, reason, pages:session.pages
    };
  }
  async function run(session) {
    let reason="schema";
    const saved=session.resume;
    const handles=saved?.handles ? [...saved.handles] : [];
    const ids=new Set(Object.values(saved?.ids || {}));
    const verification=Object.assign(Object.create(null),saved?.verification || {});
    const accountIds=Object.assign(Object.create(null),saved?.ids || {});
    let cursor=saved?.cursor || null;
    let pages=Number.isSafeInteger(saved?.pages) ? saved.pages : 0;
    const started=Date.now();
    const startingCount=handles.length;
    const seenCursors=new Set();
    let emptyPages=0;
    session.pages=pages;
    try {
      validateSelf(session);
      const profile=parser.parseProfile(await request("UserByScreenName",
        {screen_name:session.owner,withSafetyModeUserFields:true},session));
      if(profile.handle !== session.owner) throw new Error("account_mismatch");
      if(saved?.userId && saved.userId !== profile.id) throw new Error("account_mismatch");
      session.userId=profile.id;
      const operation=session.kind === "following" ? "Following" : "Followers";
      for(let batchPage=1;batchPage<=MAX_PAGES;batchPage++) {
        validateSelf(session);
        if(Date.now()-started >= MAX_MS) {reason="paused";break;}
        const vars={userId:profile.id,count:20,includePromotedContent:false,
          withGrokTranslatedBio:true};
        if(cursor) vars.cursor=cursor;
        const result=parser.parsePage(await request(operation,vars,session));
        let truncated=false;
        for(const u of result.users) {
          if(ids.has(u.id)) continue;
          if(handles.length>=MAX_USERS) {truncated=true;break;}
          ids.add(u.id);
          handles.push(u.handle);
          accountIds[u.handle]=u.id;
          if(typeof u.blueVerified==="boolean") verification[u.handle]=u.blueVerified;
        }
        pages++;
        session.pages=pages;
        // Save the cursor ONLY after successful parsing of this page.
        const previousCursor=cursor;
        cursor=result.nextCursor || null;
        if(result.users.length===0) emptyPages++;
        else emptyPages=0;
        const data=checkpoint(session,"paused",cursor,handles,verification,accountIds);
        data.userId=profile.id;
        const atEnd=(!cursor || (cursor && cursor.startsWith("0|"))) && result.hasEntries;
        send({
          type:"XRH_INTERNAL_PROGRESS",scanId:session.scanId,kind:session.kind,
          count:handles.length,pages,
          ...(batchPage%CHECKPOINT_EVERY===0 || atEnd ? {checkpoint:data} : {})
        });
        if(truncated) {reason="limit";break;}
        if(!cursor) {reason=atEnd ? "complete" : "schema_timeline";break;}
        if(cursor.startsWith("0|")) {reason="complete";break;}
        if(cursor===previousCursor || seenCursors.has(cursor)) {reason="cursor_loop";break;}
        seenCursors.add(cursor);
        if(emptyPages>=3) {reason="stalled";break;}
        if(handles.length>=MAX_USERS) {reason="limit";break;}
        if(handles.length-startingCount>=MAX_BATCH_ADDED || batchPage===MAX_PAGES ||
           Date.now()-started>=MAX_MS) {reason="paused";break;}
        await pause(PAGE_DELAY_MS,session);
      }
    } catch(error) {
      reason=session.cancelled ? "cancelled" : (
        ["cancelled","page_changed","account_mismatch","login_required","rate_limited",
         "schema","schema_timeline","query_not_found","invalid_request",
         "invalid_json","graphql_error","http_error","network"].includes(error?.message)
         ? error.message : "schema");
    } finally {
      if(active===session) active=null;
      const data=checkpoint(session,reason,cursor,handles,verification,accountIds);
      if(session.userId) data.userId=session.userId;
      // The private CSRF header and X cookies never cross the tab boundary.
      send({type:"XRH_INTERNAL_DONE",scanId:session.scanId,kind:session.kind,
        ...data});
    }
  }
  function validResume(state) {
    return state && typeof state==="object" && Array.isArray(state.handles) &&
      state.handles.length<=MAX_USERS &&
      state.handles.every(h=>typeof h==="string" && /^[a-z0-9_]{1,15}$/.test(h)) &&
      state.ids && typeof state.ids==="object" &&
      Object.entries(state.ids).length<=MAX_USERS &&
      Object.entries(state.ids).every(([h,id])=>/^[a-z0-9_]{1,15}$/.test(h) &&
        typeof id==="string" && /^[1-9]\d{0,19}$/.test(id)) &&
      (state.cursor===null || typeof state.cursor==="string" &&
        state.cursor.length>0 && state.cursor.length<=512) &&
      (!state.userId || typeof state.userId==="string" && /^[1-9]\d{0,19}$/.test(state.userId)) &&
      (!state.pages || Number.isSafeInteger(state.pages) && state.pages>=0) &&
      (!state.verification || Object.entries(state.verification).every(([h,v])=>
        /^[a-z0-9_]{1,15}$/.test(h) && typeof v==="boolean"));
  }
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
    const resume=msg.resume;
    if (resume && (!validResume(resume) || (resume.reason === "complete") ||
        resume.handles.length && !resume.cursor)) {
      respond({ok:false,error:"本地续传状态无效，请清除进度后重新同步。"});return;
    }
    const session={scanId:msg.scanId,owner,kind,cancelled:false,
      controller:new AbortController(),pages:resume?.pages||0,resume:resume||null};
    active=session;
    respond({ok:true});
    void run(session);
  });
})();
