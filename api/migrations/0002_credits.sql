-- Additive migration. Keep all legacy users, trials, daily usage and licenses.
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','frozen'));
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'));
CREATE UNIQUE INDEX users_username_unique ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;

CREATE TABLE pending_registrations (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  username TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);
CREATE UNIQUE INDEX pending_username_unique ON pending_registrations(username COLLATE NOCASE);

CREATE TABLE password_resets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);

CREATE TABLE credit_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  free_balance INTEGER NOT NULL DEFAULT 0 CHECK(free_balance >= 0),
  paid_balance INTEGER NOT NULL DEFAULT 0 CHECK(paid_balance >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('signup_grant','generation_debit','generation_refund','purchase_grant','admin_adjustment')),
  free_delta INTEGER NOT NULL DEFAULT 0,
  paid_delta INTEGER NOT NULL DEFAULT 0,
  reference_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(kind,reference_id)
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger(user_id,created_at DESC);
CREATE TABLE credit_grants (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  grant_type TEXT NOT NULL CHECK(grant_type='signup'),
  amount INTEGER NOT NULL CHECK(amount > 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE recharge_packages (
  id TEXT PRIMARY KEY,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits > 0),
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  promo_price_cents INTEGER CHECK(promo_price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
INSERT INTO recharge_packages(id,name_zh,name_en,credits,price_cents,sort_order,updated_at) VALUES
 ('starter','入门包','Starter',400,199,1,0),
 ('standard','标准包','Standard',1000,399,2,0),
 ('large','大容量包','Large',2000,699,3,0);

CREATE TABLE recharge_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  package_id TEXT NOT NULL REFERENCES recharge_packages(id),
  package_name TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits > 0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  fee_cents INTEGER,
  total_cents INTEGER,
  currency TEXT NOT NULL CHECK(currency='USD'),
  payment_method TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','awaiting_payment','paid','failed','expired','refunded')),
  provider_reference TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  credited_at INTEGER
);
CREATE INDEX recharge_orders_user_idx ON recharge_orders(user_id,created_at DESC);
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES recharge_orders(id),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE(provider,provider_event_id)
);
CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE ai_usage_costs (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,request_id)
);
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
INSERT INTO system_settings(key,value,updated_at) VALUES
 ('signup_grant','200',0),('registration_enabled','1',0),('ai_enabled','1',0),('daily_cost_limit_micro_usd','1000000',0),('announcement','',0);

-- The old requests are retained for audit. New requests record their credit source.
ALTER TABLE ai_requests ADD COLUMN credit_source TEXT CHECK(credit_source IN ('free','paid'));
ALTER TABLE ai_requests ADD COLUMN refunded_at INTEGER;
CREATE INDEX ai_requests_new_status_idx ON ai_requests(status,created_at);

-- Existing accounts contain test data only (confirmed by the owner). Grant each
-- verified account once; deterministic keys prevent a second grant on retry.
INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at)
  SELECT id,200,0,created_at,created_at FROM users WHERE email_verified_at IS NOT NULL;
INSERT INTO credit_grants(user_id,grant_type,amount,created_at)
  SELECT id,'signup',200,created_at FROM users WHERE email_verified_at IS NOT NULL;
INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at)
  SELECT 'legacy-signup:' || id,id,'signup_grant',200,0,id,created_at FROM users WHERE email_verified_at IS NOT NULL;
