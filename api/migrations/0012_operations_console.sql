-- Operational metadata only: no grants are executed by this migration.
ALTER TABLE users ADD COLUMN admin_note TEXT NOT NULL DEFAULT '';
ALTER TABLE recharge_packages ADD COLUMN recommended_label_zh TEXT NOT NULL DEFAULT '';
ALTER TABLE recharge_packages ADD COLUMN recommended_label_en TEXT NOT NULL DEFAULT '';
ALTER TABLE recharge_packages ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1));
CREATE TABLE site_content_versions(id TEXT PRIMARY KEY,actor_user_id TEXT NOT NULL REFERENCES users(id),content_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE credit_campaigns(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('all','active30','unpaid','paid','selected')),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 10000),bucket TEXT NOT NULL CHECK(bucket IN ('free','paid')),
 reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,
 future_eligible INTEGER NOT NULL DEFAULT 0 CHECK(future_eligible IN (0,1)),ends_at INTEGER,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 CHECK(future_eligible=0 OR ends_at IS NOT NULL)
);
CREATE TABLE credit_campaign_recipients(
 campaign_id TEXT NOT NULL REFERENCES credit_campaigns(id),user_id TEXT NOT NULL REFERENCES users(id),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','issuing','succeeded','failed')),
 operation_id TEXT,error_code TEXT,granted_at INTEGER,PRIMARY KEY(campaign_id,user_id)
);
CREATE INDEX credit_campaign_pending ON credit_campaign_recipients(campaign_id,state,user_id);
INSERT INTO system_settings(key,value,updated_at) VALUES('purchase_enabled','0',CAST(strftime('%s','now') AS INTEGER)*1000);
