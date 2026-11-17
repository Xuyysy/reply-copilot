// This deliberate admin-only aggregate is executed only after a manual click.
// It never retrieves plaintext hashes or user identities and has no Production
// maintenance/snapshot/remote SQL tooling connection.
export const AUTH_CPU_READINESS_SQL = `SELECT
 COUNT(*) passwordAccounts,
 COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) activeAccounts,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:60000:%' THEN 1 ELSE 0 END),0) activeFreeHashes,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:10000:%' THEN 1 ELSE 0 END),0) activeTinyHashes,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:100000:%' THEN 1 ELSE 0 END),0) active100kHashes,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:210000:%' THEN 1 ELSE 0 END),0) active210kHashes,
 COALESCE(SUM(CASE WHEN status<>'active' AND password_hash NOT LIKE 'pbkdf2-sha256:60000:%' THEN 1 ELSE 0 END),0) inactiveLegacyHashes,
 COALESCE(SUM(CASE WHEN status<>'active' AND password_hash NOT LIKE 'pbkdf2-sha256:10000:%' THEN 1 ELSE 0 END),0) inactiveNotTinyHashes
 FROM users WHERE password_hash IS NOT NULL`;
