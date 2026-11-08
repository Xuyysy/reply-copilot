# Reply speed round 1

Baseline: `e4e407b813a69b6b99e0240dd2ab2d7b5630dcff` on `codex/creator-momentum-official-copy-v1`.

The candidate reused the managed provider's already validated parse when serializing. It is discarded: the alternating mock benchmark showed sub-millisecond improvement at P95, while P90 regressed for display and verified fill. Runtime source stays at baseline. See [summary.json](summary.json) for P50/P90/P95 in milliseconds. Actual insertion and its later verification are tracked independently; the verification timer protects the editor rather than delaying the first write.

The 40 measured pairs rotate short/long Chinese and English inputs. Each pair used identical request bodies and the same fixed provider outputs. Every success generated, acknowledged, debited and inserted once, with ACK preceding insertion. The fixture checks five HTTP requests per run. Token usage (979 input, 149 output) and cost (113 micro-USD) are fixed mock metadata. Synthetic successful results had zero format failures. These samples cannot establish live quality, cache hit rate, format failure rates or vendor cost. The generate transport duration includes simulated network and Worker-side fixture steps; it is not real Worker CPU. The DNS sum includes both parallel simulated queries.

The prompt repeats some instructions about fabricated claims, authentic tone and untrusted post content. The stable system opening precedes the Voice Profile, which interrupts the otherwise stable rules and schema. Moving the profile later could lengthen the shared prefix for providers supporting exact-prefix caches, but it changes instruction ordering and requires provider-specific cache evidence and a blinded bilingual quality evaluation. Keep the current profile, examples, role boundaries, output cap and JSON schema until such an evaluation is available. No remote D1 or paid model was used.

References and applicability:
- [Vercel AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data): distinguish partial data, final validation and errors. Keep the existing parser contract and wait for ACK before exposing replies.
- [Cloudflare LLM chat template](https://github.com/cloudflare/llm-chat-app-template): SSE is viable transport for a separate experiment. It cannot independently shorten time to the last valid candidate and ACK.
- [Page Assist](https://github.com/n4ze3m/page-assist): responsive extension UI around asynchronous model work is applicable. Local-model execution is not applicable to the hosted billing path.
- [OpenSidekick](https://github.com/esterhuizen/opensidekick/tree/6f11eeea677864a0ef6c0852de77c26a3ad337e9): its background worker scopes AbortController to the run, while the provider buffers partial JSON before parsing. Request-scoped cancellation fits a separate experiment, while replay and ACK remain specific to this product.

For an optional streaming experiment, report first progress separately from final validated and acknowledged output. An interrupted stream should resume via the same request ID and never expose partial drafts, create a second paid attempt or bypass the final schema. DNS validation stays in front of credential-bearing requests. There is no evidence here to justify caching away DNS checks or weakening DB preflight and quota checks.
