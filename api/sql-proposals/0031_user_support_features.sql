-- Additive support metadata only; no changes to balances, accounts or payment rows.
CREATE TABLE user_support_features (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 feature TEXT NOT NULL CHECK(feature='local_diagnostics'),
 expires_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(user_id,feature),
 CHECK(expires_at>updated_at)
);
