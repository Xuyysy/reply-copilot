# V4 fast prompt experiment (not released)

Base: Production Worker release source 5f93a93282290fb9fca90b025f929a9ca75df645. No route wiring, environment binding, provider configuration, Chrome, D1, subscription, credit, or live deployment changes. Preserve the exact V1 payload and all V2 schema and language settings. One model call; no additional retrieval, agents, reranking, online judging, or retries. No external runtime dependency.

## Inspiration
- DSPy zero-shot instruction optimization / MIPROv2: https://github.com/stanfordnlp/dspy — optimize offline only; small instructions, held-out examples.
- Promptfoo: https://github.com/promptfoo/promptfoo — paired evaluation, deterministic assertions, latency and cost, with human review for social voice.
- OpenAI latency and prefix-caching guidance: https://developers.openai.com/api/docs/guides/latency-optimization and https://developers.openai.com/api/docs/guides/prompt-caching. Actual cache behavior depends on the configured provider; no cache-speed claim.

## Offline commands

    node --test tests/prompt-v4-fast.test.js tests/prompt-builder.test.js
    node scripts/compare-reply-prompts.mjs
    node scripts/compare-reply-prompts.mjs --pairs > /tmp/reply-prompt-v4-pairs.json

Synthetic fixtures are not real X quality evidence. Byte counts are not token counts or latency. No model calls are made by these commands.

## Release gate (requires separate measured experiment)
1. Use the same actual model, endpoint, temperature, max tokens, timeout, JSON schema and requested user settings for both variants. Alternate V3/V4 order and repeat with representative consented posts across zh/en/ja/ko; use >=100 paired posts for a meaningful p95 and retain a held-out group. Do not send private user data into a new provider. Separate cold/warm cache results and record actual input/output tokens. Use a development evaluation credential and explicit spend limit; no customer credits or production payment writes.
2. Record complete-valid-JSON provider latency, end-to-end latency when tested in Staging, p50/p95, failures, timeouts, output length, token costs and any truncation. Speed is a hard gate: V4 p50 AND p95 must not regress on comparable requests; no increase in failure fraction or retry rate. If measurement uncertainty is high, collect more evidence rather than release.
3. Blind human compare naturalness, grounding, three-angle diversity, native language, and would-send preference; reject invented firsthand facts and injection-following. A few sincere words can beat a polished paragraph. No fabricated metrics or examples presented as model results.
4. Only after the above, route V4 in a separately reviewed Staging-only experiment, verify authenticated generation/ACK and no balance changes beyond existing normal consumption. Production stays V3 until explicit approval and verified release.
