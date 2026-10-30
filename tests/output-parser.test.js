import test from "node:test";
import assert from "node:assert/strict";
import { parseAIOutput } from "../utils/output-parser.js";
import { validOutput } from "./helpers.js";

test("parses valid JSON and quote response", () => { assert.equal(parseAIOutput(JSON.stringify(validOutput)).score, 91); const q = { ...validOutput, recommendation: "quote", quote_candidate: "A standalone take." }; assert.equal(parseAIOutput(JSON.stringify(q)).quote_candidate, "A standalone take."); });
test("rejects invalid JSON and invalid response fields", () => {
  for (const value of ["no", {}, { ...validOutput, recommendation: "replyy" }, { ...validOutput, score: -1 }, { ...validOutput, score: 101 }, { ...validOutput, score: 2.5 }, { ...validOutput, best_reply_style: "long" }, { ...validOutput, replies: { ...validOutput.replies, sharp: "" } }, { ...validOutput, replies: { ...validOutput.replies, funny: " " } }, { ...validOutput, replies: { sharp: "ok", funny: "ok" } }, { ...validOutput, recommendation: "quote", quote_candidate: null }]) assert.throws(() => parseAIOutput(typeof value === "string" ? value : JSON.stringify(value)));
});

test("validates required fields in the current camelCase schema", () => {
  const current = { recommendation: "reply", defaultStyle: "natural", language: "zh", replies: { natural: "好", light_humor: "哈哈", thoughtful: "也有道理" }, reason: "简短回应即可。", quoteCandidate: null };
  assert.equal(parseAIOutput(JSON.stringify(current)).language, "zh");
  for (const value of [{ ...current, language: undefined }, { ...current, quoteCandidate: undefined }, { ...current, defaultStyle: "unknown" }]) assert.throws(() => parseAIOutput(JSON.stringify(value)));
});

test("preserves duplicate sentences from AI output so duplication is not hidden in parsing", () => {
  const duplicate = "互关秒回，这条的诚意我收到了哈哈\n互关秒回，这条的诚意我收到了哈哈";
  const output = { recommendation: "reply", defaultStyle: "natural", language: "zh", replies: { natural: duplicate, light_humor: "哈哈", thoughtful: "也有道理" }, reason: "回应帖子即可。", quoteCandidate: null };
  assert.equal(parseAIOutput(JSON.stringify(output)).replies.natural, duplicate);
});

test("optional score and every normalized field survive repeated parsing", () => {
  const current = { recommendation: "reply", defaultStyle: "thoughtful", language: "en", reason: " Fits the post. ", replies: { natural: " One. ", light_humor: "Two. 🙂", thoughtful: "Three.\nMore detail." }, quoteCandidate: null };
  for (const schema of [current, validOutput, { ...current, recommendation: "quote", quoteCandidate: " A standalone idea. " }]) {
    for (const score of [undefined, null, 0, 91, 100]) {
      const normalized = parseAIOutput(JSON.stringify({ ...schema, score }));
      assert.equal(normalized.score, score ?? null);
      assert.deepEqual(parseAIOutput(JSON.stringify(normalized)), normalized);
      assert.deepEqual(parseAIOutput(JSON.stringify(parseAIOutput(JSON.stringify(normalized)))), normalized);
    }
  }
  for (const score of ["91", true, false, {}, [], -1, 101, 1.5]) {
    assert.throws(() => parseAIOutput(JSON.stringify({ ...current, score })));
  }
});
