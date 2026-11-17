// Purpose-scoped, parameterized SQL. Reuses existing 0001 email_verifications,
// never creates users, issues credits or trials, and blocks admin sign-in.
export const ELIGIBLE = "SELECT id FROM users u WHERE email=? AND status='active' AND role='user' AND email_verified_at>0 AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM site_administrator a WHERE a.user_id=u.id)";
export const REQUEST = \`INSERT INTO email_verifications(email,code_hash,expires_at,sent_at,attempts,used_at,used_nonce) VALUES(?,?,?,?,0,NULL,NULL)
ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,used_at=NULL,used_nonce=NULL
WHERE email_verifications.sent_at<=?\`;
export const CONSUME = \`UPDATE email_verifications SET used_at=?,used_nonce=?,attempts=attempts+1
WHERE email=? AND code_hash=? AND expires_at>? AND used_at IS NULL AND attempts<5 RETURNING email\`;
export const CREATE_SESSION = \`INSERT INTO sessions(id,token_hash,user_id,kind,device_id,created_at,expires_at)
SELECT ?,?,u.id,'web',NULL,?,?
FROM users u JOIN email_verifications v ON v.email=u.email
WHERE u.email=? AND v.used_nonce=? AND v.code_hash=? AND u.status='active' AND u.role='user'
AND u.email_verified_at>0 AND u.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM site_administrator a WHERE a.user_id=u.id)\`;
export const BAD_ATTEMPT = "UPDATE email_verifications SET attempts=attempts+1 WHERE email=? AND expires_at>? AND used_at IS NULL AND attempts<5";
