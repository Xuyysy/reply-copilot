/**
 * Shared generation orchestration seam. Keeping reservation, provider execution,
 * validation, and settlement explicit makes replay/refund behavior testable
 * without contacting an external model.
 */
export async function executeAiGeneration({ reserve, provider, validate, finish }) {
  const reservation = await reserve();
  if (reservation.kind === "replay") {
    return { kind: "replay", raw: reservation.raw, quota: reservation.quota };
  }

  let result;
  try {
    result = await provider();
    validate(result);
  } catch (error) {
    // A confirmed provider/validation failure refunds the credit. Preserve
    // usage when available so any incurred model cost remains accounted for.
    await finish(null, result?.usage ?? error?.usage).catch(() => {});
    return { kind: "failed", error };
  }

  // If successful settlement fails, let it propagate: whether the DB write
  // committed is uncertain, so the caller must not trigger a paid retry.
  if (await finish(result.raw, result.usage) === false) return {kind:"abandoned"};
  return { kind: "generated", raw: result.raw, ...(reservation.funding?{funding:reservation.funding}:{}) };
}
