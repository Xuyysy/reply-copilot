import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { Miniflare } from "miniflare";

test("Xiaodou default fetch reaches the upstream in Workers for create and query", async () => {
  // Keep the real Workers fetch and RSA client; replace only the outbound network.
  const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const clientSource = await readFile(new URL("../src/xiaodou.js", import.meta.url), "utf8");
  const privateKeyPem = merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = platform.publicKey.export({ type: "spki", format: "pem" }).toString();
  const script = `
    import { XiaodouClient } from './xiaodou.js';
    export default { async fetch() {
      const client = new XiaodouClient({
        baseUrl: 'https://provider.invalid', appId: 'xdop_1234567890abcdef',
        keyId: 'mkid_0123456789abcdef', privateKeyPem: ${JSON.stringify(privateKeyPem)},
        platformPublicKeys: { 'test-platform': ${JSON.stringify(publicKeyPem)} },
        now: () => 1792195200000
      });
      const results = [];
      for (const method of ['create', 'query']) {
        try {
          const options = { requestId: 'runtime-request-12345678' };
          const value = method === 'query'
            ? await client.queryPayment('runtime-order-12345678', options)
            : await client.createPayment({ outTradeNo: 'runtime-order-12345678',
                channel: 'ALIPAY_H5', amountFen: 1006, currency: 'CNY', subject: 'Test',
                payerClientIp: '8.8.8.8' }, options);
          results.push({ method, status: value.status });
        } catch (error) { results.push({ method, code: error.code, stage: error.stage }); }
      }
      return Response.json(results);
    }};`;
  let outboundCalls = 0;
  const mf = new Miniflare({ workers: [{
    config: { name: "xiaodou-runtime-regression", compatibilityDate: "2026-10-14",
      manifest: { mainModule: "index.js", modules: {
        "index.js": { type: "esm", contents: script },
        "xiaodou.js": { type: "esm", contents: clientSource },
      } } },
    dev: { outboundService: { type: "fetcher", handler: (request) => {
      outboundCalls++;
      assert.equal(new URL(request.url).pathname.startsWith("/api/open/v1/payments"), true);
      const body = JSON.stringify({ status: "PAYING" });
      const requestId = request.headers.get("X-XD-Request-Id");
      const digest = createHash("sha256").update(body).digest("hex");
      const canonical = ["XD-Response-v1", "200", "application/json", requestId,
        "1792195200", "runtime_nonce_123456", "test-platform", digest].join("\n");
      return new Response(body, { headers: {
        "Content-Type": "application/json", "X-XD-Request-Id": requestId,
        "X-XD-Response-Timestamp": "1792195200", "X-XD-Response-Nonce": "runtime_nonce_123456",
        "X-XD-Response-Key-Id": "test-platform",
        "X-XD-Response-Sign": sign("RSA-SHA256", Buffer.from(canonical), platform.privateKey).toString("base64"),
      } });
    } } },
  }] });
  try {
    const response = await mf.dispatchFetch("http://local.test/");
    assert.deepEqual(await response.json(), [
      { method: "create", status: "PAYING" },
      { method: "query", status: "PAYING" },
    ]);
    assert.equal(outboundCalls, 2);
  } finally { await mf.dispose(); }
});
