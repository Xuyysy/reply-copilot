# Quote card research and minimal Staging fallback

Sources inspected (for architecture, not copied):
- https://github.com/Christian-von-Uffel/x-feed-analyzer/blob/main/content.js — author-bearing `div[role=link]` quote cards, separate main tweet text/ID. No LICENSE file found; no source code copied.
- https://github.com/nirholas/XActions/blob/main/src/timelineScraper.js — multiple quote DOM shapes and stable data-testid selectors; Apache 2.0.
- https://github.com/zendegani/XClipper/blob/main/src/content/dom-to-ast/quote.ts — independent quote node model; **PolyForm Noncommercial** and excluded from all code reuse.

User reports prior `[data-testid=quoteTweet]`-only Staging fix did not work. Code inspection shows an erroneous second-outer-text requirement that breaks quote-only role=link cards and sometimes confuses outer with quoted status ID. This experiment adds role=link boundaries only when the card has an author and tweetText and another outer timestamp exists. The modal binds only on verified outer status ID **plus** matching quoted preview for quote-only posts. Ambiguous cases still fail closed.

No extra network/model calls, no new timers, no new DOM mutation on successful regular posts. Local-only text-free diagnostics: open Chrome devtools in x-Reply-Helper isolated script context after a failed click and evaluate `replyCopilotAssociationReport()`; it returns stage/reason/timing only, no post content or usernames. A real failing quoted-post URL/DOM remains needed for definitive validation.

## 2026-11-14 reported X quote reply issue (Staging follow-up)

Public report: https://x.com/pigeontwting/status/2121135421413613951 . Real user's local diagnostic gave two `activated/trusted_reply_click` → `rejected/reply_context_unconfirmed` sequences within approximately 189–213 ms. Thus source capture worked, but modal binding failed. The public X page DOM was inaccessible from this environment, so the fix is a code-based hypothesis, not real-X verification.

Modal parent discovery now excludes both marked cards and author-bearing `div[role=link]` quote descendants (article and bare tweetText). Quote-only modal hydration waits until a verified outer parent appears rather than binding on quote text alone or prematurely rejecting. When the modal's OUTER canonical parent ID uniquely matches, a temporarily absent quoted preview is no longer a veto; an explicitly different quoted preview remains a failure. Failed context matches now record a text-free `context_detail` reason. No new model calls, telemetry, database or Production changes. Do not merge until human verified on the linked X post.
