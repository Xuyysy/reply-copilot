import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-xiaodou-webhook-"));
const bundlePath = path.join(temp, "worker.cjs");
buildSync({ entryPoints: [path.join(apiRoot, "src/index.ts")], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: bundlePath });
const loaded = await import(pathToFileURL(bundlePath));
const worker = loaded.default?.default || loaded.default;
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const platformPublicKeyPem = platform.publicKey.export({ type: "spki", format: "pem" }).toString();
const noDatabaseAccess = {
  prepare() { throw new Error("D1 must not be accessed for rejected webhook signatures"); },
};

function env(overrides = {}) {
  return {
    ENVIRONMENT: "staging",
    WEB_ORIGIN: "https://staging.x-reply-helper.top",
    API_ORIGIN: "https://api-staging.x-reply-helper.top",
    EXTENSION_ORIGIN: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    SITE_DAILY_CAP: "10",
    PAYMENT_PROVIDER: "xiaodou",
    PAYMENTS_ENABLED: "0",
    XIAODOU_WEBHOOKS_ENABLED: "1",
    XIAODOU_BASE_URL: "https://merchant.example.test",
    XIAODOU_APP_ID: "xdop_1234567890abcdef",
    XIAODOU_KEY_ID: "mkid_0123456789abcdef",
    XIAODOU_PRIVATE_KEY: privateKeyPem,
    XIAODOU_PLATFORM_PUBLIC_KEYS: JSON.stringify({ "platform-test-key": platformPublicKeyPem }),
    DB: noDatabaseAccess,
    ...overrides,
  };
}

function request(headers = {}, body = "{}") {
  return new Request("https://api-staging.x-reply-helper.top/v1/payments/xiaodou/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

function signedEvent(event, eventType=event.eventType) {
  const body=JSON.stringify(event),eventId=event.eventId,timestamp=String(Math.floor(Date.now()/1000)),nonce="abcdefghijklmnop",keyId="platform-test-key";
  const signingText=["XD-Webhook-v1",eventId,eventType,timestamp,nonce,keyId,createHash("sha256").update(body).digest("hex")].join("\n");
  const signature=sign("RSA-SHA256",Buffer.from(signingText),platform.privateKey).toString("base64");
  return request({"X-XD-Webhook-Event-Id":eventId,"X-XD-Webhook-Event-Type":eventType,"X-XD-Webhook-Timestamp":timestamp,"X-XD-Webhook-Nonce":nonce,"X-XD-Webhook-Key-Id":keyId,"X-XD-Webhook-Signature":signature},body);
}

function paymentDb() {
  const transaction={id:"tx-1",order_id:"order-1",provider:"xiaodou",amount_fen:1006,currency:"CNY",status:"pending",provider_trade_id:"XRH_trade_123",order_user_id:"user-1",order_credits:400,order_status:"awaiting_payment",credited_at:null,provider_fee_projection_status:"pending",provider_fee_projection_json:null,provider_fee_projection_issue:null};
  const state={transaction,batchCalls:0,projectionWrites:0,events:new Map()};
  return {state,prepare(sql){return {bind(...args){this.args=args;return this;},async first(){if(sql.includes("WHERE t.provider='xiaodou' AND t.merchant_provider='xiaodou' AND t.provider_trade_id=?"))return state.transaction;if(sql.includes("FROM provider_payment_events WHERE provider=? AND provider_event_id=?"))return state.events.get(`${this.args[0]}:${this.args[1]}`)??null;if(sql.includes("WHERE t.order_id=?"))return state.transaction;if(sql.includes("MAX(0,free_balance-free_generation_reserved)"))return {free_remaining:200,paid_remaining:0};return null;},async run(){if(sql.includes("provider_fee_projection_status=?")){state.projectionWrites++;Object.assign(state.transaction,{provider_fee_projection_status:this.args[0],provider_fee_projection_json:this.args[1],provider_fee_projection_issue:this.args[2]});}return {meta:{changes:1}};}};},async batch(statements){state.batchCalls++;const args=statements[0].args;state.events.set(`${args[1]}:${args[2]}`,{transaction_id:args[3],event_type:args[4],amount_fen:args[5],currency:args[6]});state.transaction.status="paid";state.transaction.order_status="paid";state.transaction.credited_at=Date.now();return [{meta:{changes:1}},...Array.from({length:8},()=>({meta:{changes:1}}))];}};
}

test.after(() => rmSync(temp, { recursive: true, force: true }));

test("unsigned webhook is rejected as a client signature error without touching D1", async () => {
  const response = await worker.fetch(request(), env());
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "INVALID_WEBHOOK_HEADERS");
  assert.match(body.message, /签名/);
});

test("bad webhook signature is rejected as 401 and does not touch D1", async () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await worker.fetch(request({
    "X-XD-Webhook-Event-Id": "evt-12345678",
    "X-XD-Webhook-Event-Type": "PAYMENT_SUCCEEDED",
    "X-XD-Webhook-Timestamp": timestamp,
    "X-XD-Webhook-Nonce": "abcdefghijklmnop",
    "X-XD-Webhook-Key-Id": "platform-test-key",
    "X-XD-Webhook-Signature": "AAAA",
  }), env());
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "INVALID_WEBHOOK_SIGNATURE");
});

test("unknown platform key is a client verification failure", async () => {
  const response = await worker.fetch(request({
    "X-XD-Webhook-Event-Id": "evt-12345678",
    "X-XD-Webhook-Event-Type": "PAYMENT_SUCCEEDED",
    "X-XD-Webhook-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-XD-Webhook-Nonce": "abcdefghijklmnop",
    "X-XD-Webhook-Key-Id": "unknown-platform-key",
    "X-XD-Webhook-Signature": "AAAA",
  }), env());
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "UNKNOWN_PLATFORM_KEY");
});

test("verification infrastructure errors remain server errors", async () => {
  const response = await worker.fetch(request({
    "X-XD-Webhook-Event-Id": "evt-12345678",
    "X-XD-Webhook-Event-Type": "PAYMENT_SUCCEEDED",
    "X-XD-Webhook-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-XD-Webhook-Nonce": "abcdefghijklmnop",
    "X-XD-Webhook-Key-Id": "platform-test-key",
    "X-XD-Webhook-Signature": "AAAA",
  }), env({ XIAODOU_PLATFORM_PUBLIC_KEYS: JSON.stringify({ "platform-test-key": "not-a-valid-public-key" }) }));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "SERVER_UNAVAILABLE");
});

test("WebCrypto verification runtime errors remain server errors", async () => {
  const subtlePrototype = Object.getPrototypeOf(globalThis.crypto.subtle);
  const originalVerify = subtlePrototype.verify;
  subtlePrototype.verify = async () => { throw new Error("private runtime detail"); };
  try {
    const response = await worker.fetch(request({
      "X-XD-Webhook-Event-Id": "evt-12345678",
      "X-XD-Webhook-Event-Type": "PAYMENT_SUCCEEDED",
      "X-XD-Webhook-Timestamp": String(Math.floor(Date.now() / 1000)),
      "X-XD-Webhook-Nonce": "abcdefghijklmnop",
      "X-XD-Webhook-Key-Id": "platform-test-key",
      "X-XD-Webhook-Signature": Buffer.alloc(256).toString("base64"),
    }), env());
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "SERVER_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(body), /private runtime detail/);
  } finally {
    subtlePrototype.verify = originalVerify;
  }
});

test("a correctly signed paid webhook validates status and settlement projection before one credit batch",async()=>{
  const db=paymentDb(),projection={ruleVersion:"2026-10",thresholdFen:0,tier:"STANDARD",merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:976,companyServiceFeeFen:30};
  const response=await worker.fetch(signedEvent({eventId:"evt-valid-123456",eventType:"PAYMENT_SUCCEEDED",status:"SUCCEEDED",appId:"xdop_1234567890abcdef",outTradeNo:"XRH_trade_123",currency:"CNY",grossAmountFen:1006,eventAmountFen:1006,feeProjection:projection}),env({DB:db}));
  const body=await response.text();
  assert.equal(response.status,200,body);
  assert.equal(body,"success");
  assert.equal(db.state.batchCalls,1);
  assert.equal(db.state.projectionWrites,1);
  assert.equal(db.state.transaction.provider_fee_projection_status,"verified");
  assert.equal(db.state.transaction.status,"paid");
});

test("replaying the same valid paid webhook does not run a second credit batch",async()=>{
  const db=paymentDb(),projection={ruleVersion:"2026-10",thresholdFen:0,tier:"STANDARD",merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:976,companyServiceFeeFen:30};
  const event={eventId:"evt-repeat-paid-123",eventType:"PAYMENT_SUCCEEDED",status:"SUCCEEDED",appId:"xdop_1234567890abcdef",outTradeNo:"XRH_trade_123",currency:"CNY",grossAmountFen:1006,eventAmountFen:1006,feeProjection:projection};
  const first=await worker.fetch(signedEvent(event),env({DB:db}));
  const replay=await worker.fetch(signedEvent(event),env({DB:db}));
  assert.equal(first.status,200);
  assert.equal(replay.status,200);
  assert.equal(db.state.batchCalls,1);
  assert.equal(db.state.events.size,1);
});

test("a correctly signed event with a mismatched status is rejected before D1 mutation",async()=>{
  const db=paymentDb();
  const response=await worker.fetch(signedEvent({eventId:"evt-bad-status-123",eventType:"PAYMENT_SUCCEEDED",status:"FAILED",appId:"xdop_1234567890abcdef",outTradeNo:"XRH_trade_123",currency:"CNY",grossAmountFen:1006,eventAmountFen:1006}),env({DB:db}));
  const body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.code,"PAYMENT_EVENT_STATUS_MISMATCH");
  assert.equal(db.state.batchCalls,0);
  assert.equal(db.state.projectionWrites,0);
  assert.equal(db.state.transaction.status,"pending");
});

test("a signed success with a broken feeProjection is visibly held for reconciliation",async()=>{
  const db=paymentDb(),projection={ruleVersion:"2026-10",thresholdFen:0,tier:"STANDARD",merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:975,companyServiceFeeFen:30};
  const response=await worker.fetch(signedEvent({eventId:"evt-bad-fee-123456",eventType:"PAYMENT_SUCCEEDED",status:"SUCCEEDED",appId:"xdop_1234567890abcdef",outTradeNo:"XRH_trade_123",currency:"CNY",grossAmountFen:1006,eventAmountFen:1006,feeProjection:projection}),env({DB:db}));
  assert.equal(response.status,200,"verified paid status is still acknowledged to avoid retry storms");
  assert.equal(db.state.transaction.provider_fee_projection_status,"review");
  assert.equal(db.state.transaction.provider_fee_projection_issue,"invalid");
  assert.equal(db.state.transaction.status,"paid","entitlement follows the verified paid amount, not the separate settlement projection");
  assert.equal(db.state.batchCalls,1);
});
