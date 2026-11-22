import { buildPrompts } from "./prompt-builder.js";
import { buildLiveProductionV3Prompts } from "./prompt-v3-live-parity.js";
import { buildFastV4Prompts } from "./prompt-v4-fast.js";
import { buildHumanV5Prompts } from "./prompt-v5-human.js";

/** Pure, synchronous, server-controlled switch. No extra model calls, DB,
 * client input, or request-hash change. Preserve the existing protocol. */
export function selectStagingReplyPrompts(env, args) {
  if (env?.ENVIRONMENT !== "staging") return buildPrompts(args);
  if (args?.outputSchemaVersion === 1) return buildPrompts(args);
  const version = env.STAGING_REPLY_PROMPT_VERSION;
  if (version === "v5") return buildHumanV5Prompts({...args,outputSchemaVersion:2});
  if (version === "v3") return buildLiveProductionV3Prompts({...args,outputSchemaVersion:2});
  if (version === undefined || version === "v4") return buildFastV4Prompts({...args,outputSchemaVersion:2});
  return buildPrompts(args); // legacy or unexpected value: exact old prompt
}
