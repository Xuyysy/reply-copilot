import assert from "node:assert/strict";
import test from "node:test";
import { decryptProviderApiKey, encryptProviderApiKey } from "../src/ai-model-crypto.js";

const key = Buffer.alloc(32, 0x42).toString("base64");

test("API key encryption is randomized, authenticated, and bound to config/version", async () => {
  const first = await encryptProviderApiKey(key, "config-a", 1, "provider-secret-key-value");
  const second = await encryptProviderApiKey(key, "config-a", 1, "provider-secret-key-value");
  assert.notEqual(first, second);
  assert.equal(await decryptProviderApiKey(key, "config-a", 1, first), "provider-secret-key-value");
  await assert.rejects(decryptProviderApiKey(key, "config-b", 1, first));
  await assert.rejects(decryptProviderApiKey(key, "config-a", 2, first));
  await assert.rejects(decryptProviderApiKey(Buffer.alloc(32, 0x43).toString("base64"), "config-a", 1, first));
});

test("encryption rejects short, oversized, control-character and malformed keys", async () => {
  for (const value of ["short", "x".repeat(513), "secret\nkey"]) await assert.rejects(encryptProviderApiKey(key, "id", 1, value));
  await assert.rejects(encryptProviderApiKey(Buffer.alloc(31).toString("base64"), "id", 1, "provider-secret-key-value"));
});
