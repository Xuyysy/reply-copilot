/**
 * Keep the invariant in the same atomic D1 batch as its writes. A JS check
 * after batch() would be too late to roll them back.
 *
 * This is a source-only, default-off CF Free candidate. On false or NULL,
 * SQLite's lazy CASE evaluates the invalid JSON branch and throws. D1 must
 * roll back the entire batch. Preserve the old operation-ID collision check
 * and the old constraint-based path until independently verified.
 *
 * assertionSql must be a trusted static SQL predicate from the caller.
 * All data values remain bound parameters, not SQL interpolation.
 * @param {import('./types').Env} env
 * @param {string} operationId
 * @param {string} assertionSql
 * @param {unknown[]} values
 * @returns {D1PreparedStatement[]}
 */
export function creditInvariant(env, operationId, assertionSql, values) {
  if (env.CF_FREE_ZERO_WRITE_ASSERTIONS === '1') {
    return [env.DB.prepare(
      "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM credit_operation_assertions WHERE operation_id=?) AND (" +
      assertionSql + ") THEN 1 ELSE json_extract('assert-failed','$') END AS assertion_ok"
    ).bind(operationId, ...values)];
  }
  return [
    env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN " + assertionSql + " THEN 1 ELSE 0 END").bind(operationId, ...values),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(operationId)
  ];
}
