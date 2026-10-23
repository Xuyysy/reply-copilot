import test from "node:test";
import assert from "node:assert/strict";
import { VoiceProfileService, VOICE_PROFILE_KEY } from "../services/voice-profile-service.js";
import { DEFAULT_VOICE_PROFILE, validateVoiceProfile } from "../domain/voice-profile.js";
import { StorageService, API_KEY_KEY } from "../services/storage-service.js";
import { memoryStorage } from "./helpers.js";

test("default Voice Profile is valid and generic", () => {
  assert.deepEqual(validateVoiceProfile(DEFAULT_VOICE_PROFILE).name, "My Voice");
  assert.deepEqual(DEFAULT_VOICE_PROFILE.writingSamples, []);
});

test("profile saves, reloads, and removes an individual writing sample", async () => {
  const store = memoryStorage(), service = new VoiceProfileService(store);
  const custom = await service.save({ ...DEFAULT_VOICE_PROFILE, name: "Ari", language: "zh", writingSamples: ["先留个真实的样本"] });
  assert.equal((await service.get()).name, "Ari");
  assert.equal((await service.removeWritingSample(0)).writingSamples.length, 0);
  assert.ok(store.data[VOICE_PROFILE_KEY]);
});

test("legacy migration is idempotent and preserves legacy user data", async () => {
  const store = memoryStorage(), service = new VoiceProfileService(store);
  const first = await service.migrateLegacy({ apiKeyExists: true });
  const again = await service.migrateLegacy({ apiKeyExists: true });
  assert.equal(first.profile.name, "My Voice"); assert.equal(again.migrated, false);
  assert.equal(again.profile.name, "My Voice");
});

test("key-only legacy profile is migrated before retired key removal", async () => {
  const store = memoryStorage(); store.data[API_KEY_KEY] = "old-personal-secret";
  const old = await store.get(API_KEY_KEY);
  await new VoiceProfileService(store).migrateLegacy({ apiKeyExists: Boolean(old[API_KEY_KEY]) });
  await new StorageService({ local: store }).migrateSchema();
  assert.equal((await new VoiceProfileService(store).get()).name, "My Voice");
  assert.equal(API_KEY_KEY in store.data, false);
});

test("invalid profile values are rejected and stored corrupt profile falls back", async () => {
  assert.throws(() => validateVoiceProfile({ ...DEFAULT_VOICE_PROFILE, tone: "unknown" }));
  const store = memoryStorage(); store.data[VOICE_PROFILE_KEY] = { tone: "bad" };
  assert.equal((await new VoiceProfileService(store).get()).name, "My Voice");
});

 test("migration preserves an existing personal profile and samples", async () => {
  const store = memoryStorage();
  store.data[VOICE_PROFILE_KEY] = { ...DEFAULT_VOICE_PROFILE, name: "Personal", writingSamples: ["My own words"] };
  const service = new VoiceProfileService(store);
  await service.migrateLegacy({ historyExists: true });
  assert.equal((await service.get()).name, "Personal");
  assert.deepEqual((await service.get()).writingSamples, ["My own words"]);
 });
