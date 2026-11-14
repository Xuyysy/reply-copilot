# Quote card research and minimal Staging fallback

Sources inspected (for architecture, not copied):
- https://github.com/Christian-von-Uffel/x-feed-analyzer/blob/main/content.js — author-bearing `div[role=link]` quote cards, separate main tweet text/ID. No LICENSE file found; no source code copied.
- https://github.com/nirholas/XActions/blob/main/src/timelineScraper.js — multiple quote DOM shapes and stable data-testid selectors; Apache 2.0.
- https://github.com/zendegani/XClipper/blob/main/src/content/dom-to-ast/quote.ts — independent quote node model; **PolyForm Noncommercial** and excluded from all code reuse.

User reports prior `[data-testid=quoteTweet]`-only Staging fix did not work. Code inspection shows an erroneous second-outer-text requirement that breaks quote-only role=link cards and sometimes confuses outer with quoted status ID. This experiment adds role=link boundaries only when the card has an author and tweetText and another outer timestamp exists. The modal binds only on verified outer status ID **plus** matching quoted preview for quote-only posts. Ambiguous cases still fail closed.

No extra network/model calls, no new timers, no new DOM mutation on successful regular posts. Local-only text-free diagnostics: open Chrome devtools in x-Reply-Helper isolated script context after a failed click and evaluate `replyCopilotAssociationReport()`; it returns stage/reason/timing only, no post content or usernames. A real failing quoted-post URL/DOM remains needed for definitive validation.
