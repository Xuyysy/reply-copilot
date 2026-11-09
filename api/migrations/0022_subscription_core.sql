-- Issue #21: additive, isolated subscription schema.
-- DO NOT run this against Production, Staging or backups without separate approval.
-- Existing free_balance, paid_balance, credit_batches, recharge_orders and
-- payment_transactions remain unchanged. A subscription is NOT a credit grant.
-- Money amounts are integer CNY fen; timestamps are UTC epoch milliseconds.

CREATE TABLE subscription_plan_versions (
  id TEXT PRIMARY KEY,
  plan_code TEXT NOT NULL CHECK(plan_code IN ('basic','pro','max','ultra')),
  version INTEGER NOT NULL CHECK(version >= 1),
  price_fen INTEGER NOT NULL CHECK(price_fen > 0),
  daily_limit INTEGER NOT NULL CHECK(daily_limit IN (500,1000,1500,2000)),
  duration_days INTEGER NOT NULL DEFAULT 30 CHECK(duration_days = 30),
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_zh TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  current INTEGER NOT NULL DEFAULT 1 CHECK(current IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(plan_code,version),
  CHECK((plan_code='basic' AND daily_limit=500)
     OR (plan_code='pro' AND daily_limit=1000)
     OR (plan_code='max' AND daily_limit=1500)
     OR (plan_code='ultra' AND daily_limit=2000))
);
CREATE UNIQUE INDEX subscription_plan_current_uq ON subscription_plan_versions(plan_code) WHERE current=1;
INSERT INTO subscription_plan_versions
  (id,plan_code,version,price_fen,daily_limit,name_zh,name_en,created_at,updated_at)
VALUES
  ('basic-v1','basic',1,6990,500,'基础订阅','Basic',0,0),
  ('pro-v1','pro',1,11990,1000,'进阶订阅','Pro',0,0),
  ('max-v1','max',1,17990,1500,'高频订阅','Max',0,0),
  ('ultra-v1','ultra',1,25990,2000,'超高频订阅','Ultra',0,0);

CREATE TABLE subscription_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_version_id TEXT NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','renewal','upgrade')),
  target_period_id TEXT REFERENCES subscription_periods(id) ON DELETE RESTRICT,
  amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','unknown','paid','closed','failed','refund_pending','refunded','manual_review')),
  quoted_at INTEGER NOT NULL,
  quote_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  applied_at INTEGER,
  operation_id TEXT UNIQUE,
  CHECK(quote_expires_at>quoted_at),
  CHECK((kind='upgrade' AND target_period_id IS NOT NULL)
     OR (kind<>'upgrade' AND target_period_id IS NULL))
);
CREATE INDEX subscription_orders_user_created_idx
  ON subscription_orders(user_id,created_at DESC,id);
CREATE INDEX subscription_orders_pending_idx
  ON subscription_orders(status,created_at) WHERE status IN ('pending','unknown','manual_review');

-- Isolated from legacy transactions: a subscription payment must never
-- reach applyPaymentEvent()'s permanent paid_balance credit grant branch.
CREATE TABLE subscription_payment_transactions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES subscription_orders(id) ON DELETE RESTRICT,
  merchant_provider TEXT NOT NULL CHECK(merchant_provider IN ('mk99','local_mock')),
  merchant_account TEXT,
  provider_trade_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  payment_channel TEXT NOT NULL CHECK(payment_channel IN ('ALIPAY_H5','WECHAT_H5','LOCAL_MOCK')),
  amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
  notification_sign_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','unknown','paid','failed','closed','refunded')),
  risk_state TEXT NOT NULL DEFAULT 'clear' CHECK(risk_state IN ('clear','manual_review','frozen')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  CHECK(merchant_provider<>'mk99' OR (merchant_account IS NOT NULL AND notification_sign_type IS NOT NULL))
);
CREATE UNIQUE INDEX subscription_payment_merchant_trade_uq
  ON subscription_payment_transactions(merchant_provider,provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE subscription_payment_events (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES subscription_payment_transactions(id) ON DELETE RESTRICT,
  merchant_provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
  body_sha256 TEXT,
  received_at INTEGER NOT NULL,
  UNIQUE(merchant_provider,provider_event_id)
);
CREATE INDEX subscription_payment_events_transaction_idx
  ON subscription_payment_events(transaction_id,received_at DESC);

CREATE TABLE subscription_periods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_order_id TEXT NOT NULL UNIQUE REFERENCES subscription_orders(id) ON DELETE RESTRICT,
  plan_version_id TEXT NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE RESTRICT,
  daily_limit INTEGER NOT NULL CHECK(daily_limit IN (500,1000,1500,2000)),
  status TEXT NOT NULL CHECK(status IN ('queued','active','expired','refund_pending','revoked')),
  start_at INTEGER,
  end_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((start_at IS NULL AND end_at IS NULL AND status='queued')
     OR (start_at IS NOT NULL AND end_at IS NOT NULL AND end_at=start_at+2592000000))
);
CREATE UNIQUE INDEX subscription_one_active_period_idx
  ON subscription_periods(user_id) WHERE status='active';
CREATE INDEX subscription_periods_user_status_idx
  ON subscription_periods(user_id,status,start_at,end_at);
CREATE INDEX subscription_periods_user_queue_idx
  ON subscription_periods(user_id,created_at,id) WHERE status='queued';

-- Day index is 0..29, anchored to the paid period's start, never to UTC
-- midnight or the client's clock. used+reserved<=daily_limit must be checked
-- against subscription_periods in the same transactional CAS/batch.
CREATE TABLE subscription_daily_usage (
  period_id TEXT NOT NULL REFERENCES subscription_periods(id) ON DELETE RESTRICT,
  day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 29),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  last_reservation_ref TEXT,
  last_finalization_ref TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(period_id,day_index)
);

-- Strong DB-level cap, including concurrent reservations and tier updates.
CREATE TRIGGER subscription_day_cap_insert BEFORE INSERT ON subscription_daily_usage
WHEN NEW.used+NEW.reserved > (SELECT daily_limit FROM subscription_periods WHERE id=NEW.period_id)
BEGIN SELECT RAISE(ABORT,'subscription_daily_cap_exceeded'); END;
CREATE TRIGGER subscription_day_cap_update BEFORE UPDATE ON subscription_daily_usage
WHEN NEW.used+NEW.reserved > (SELECT daily_limit FROM subscription_periods WHERE id=NEW.period_id)
BEGIN SELECT RAISE(ABORT,'subscription_daily_cap_exceeded'); END;

-- Each request may use EXACTLY ONE source: either a subscription allocation
-- or the pre-existing ai_credit_allocations. Cross-table exclusivity must be
-- asserted atomically by the Worker; SQL UNIQUE constraints protect one table.
CREATE TABLE subscription_ai_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 29),
  state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  released_at INTEGER,
  finalization_ref TEXT,
  UNIQUE(user_id,request_id),
  FOREIGN KEY(user_id,request_id) REFERENCES ai_requests(user_id,request_id) ON DELETE RESTRICT,
  FOREIGN KEY(period_id,day_index) REFERENCES subscription_daily_usage(period_id,day_index)
    ON DELETE RESTRICT
);
CREATE INDEX subscription_allocations_pending_idx
  ON subscription_ai_allocations(period_id,day_index,state,created_at);

CREATE TABLE subscription_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_id TEXT NOT NULL REFERENCES subscription_periods(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 29),
  event_type TEXT NOT NULL CHECK(event_type IN ('reserve','consume','release')),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,request_id,event_type)
);
CREATE INDEX subscription_usage_events_period_idx
  ON subscription_usage_events(period_id,day_index,created_at DESC);

-- An upgrade is an order-backed period amendment, not an additional period.
CREATE TABLE subscription_tier_changes (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES subscription_periods(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL UNIQUE REFERENCES subscription_orders(id) ON DELETE RESTRICT,
  previous_plan_version_id TEXT NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE RESTRICT,
  next_plan_version_id TEXT NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE RESTRICT,
  previous_daily_limit INTEGER NOT NULL,
  next_daily_limit INTEGER NOT NULL CHECK(next_daily_limit>previous_daily_limit),
  charged_fen INTEGER NOT NULL CHECK(charged_fen>0),
  effective_at INTEGER NOT NULL,
  original_expires_at INTEGER NOT NULL
);
CREATE INDEX subscription_tier_changes_period_idx
  ON subscription_tier_changes(period_id,effective_at);
