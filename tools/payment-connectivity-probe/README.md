# Temporary payment connectivity probe

This is a standalone, disposable Cloudflare Worker for comparing two outbound HTTPS requests:

1. A fixed public endpoint, `https://example.com/`.
2. The root path of an operator-configured Xiaodou Base URL.

It does not import the payment client, use D1, read orders, or carry payment credentials. It only issues one unauthenticated `GET` per target when an authorized operator calls `POST /run`. It does not retry. The configured target is a Worker Secret and cannot be supplied through the request path, query, or body.

## Local checks

From this directory:

```sh
npm test
npm run typecheck
```

The tests inject Mock Fetch and never access the public internet or Xiaodou. Build validation from the repository root:

```sh
api/node_modules/.bin/wrangler deploy --config tools/payment-connectivity-probe/wrangler.jsonc --dry-run --outdir /private/tmp/xrh-payment-connectivity-probe-dry-run
```

## Temporary Staging setup (requires separate approval)

The isolated script is `xrh-payment-connectivity-probe-staging`. It has no D1 or other resource bindings, no custom domain or routes, and uses its own `workers.dev` address. The trigger is disabled by default (`PROBE_ENABLED=0`). Do not deploy it until deployment is explicitly authorized.

After authorization, deploy the disabled Worker first. In that Worker's configuration only, set these independent Secrets using the interactive Wrangler prompt:

- `PROBE_TRIGGER_TOKEN`: a fresh random value of at least 32 characters; keep it in a password manager.
- `XIAODOU_PROBE_BASE_URL`: copy the Base URL privately from the Xiaodou merchant portal. Do not put it in Git, ordinary vars, logs, or chat.

Then, with separate authorization for enabling the probe, change only this probe Worker's `PROBE_ENABLED` to `1` and deploy its own config. This does not alter the payment Worker. The operator should make exactly one authenticated `POST /run` request and should not retry it automatically. Each invocation performs at most one GET to each fixed/configured target.

For a manual Mac terminal trigger, read the token without echo, then use its shell variable (never paste the token into a command or chat):

```zsh
read -s 'PROBE_TOKEN?Probe trigger token: '; print
curl --silent --show-error --request POST \
  --header "Authorization: Bearer $PROBE_TOKEN" \
  "https://<the-probe-workers-dev-host>/run"
unset PROBE_TOKEN
```

The response contains only each test name, outcome, HTTP status, elapsed time, and a fixed error category. It does not include either URL, host, response body, or exception text. `3xx` responses are returned as `http_response` with `errorCategory: "redirect_rejected"`; redirect destinations are never followed. `404` and `403` count as successful HTTP connectivity observations, not payment API success.

## Cleanup

Immediately after the one authorized run, set this probe Worker's `PROBE_ENABLED` back to `0` and deploy its own config. Then delete only `xrh-payment-connectivity-probe-staging` using its config. Deleting the Worker removes its independently configured Secrets. Verify deletion in Cloudflare. Do not use the production payment Worker, production config, or production secrets for this probe.
