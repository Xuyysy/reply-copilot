-- Source-only proposal. Requires 0033/0034/0035 and existing BoltUtil schema.
-- Apply only with separate authorization, before enabling partner_commission_ledger_enabled.
-- Captures dirty order identities in the original payment transaction; no money transfer.
CREATE TABLE partner_commission_dirty (
 domain TEXT NOT NULL CHECK(domain IN ('recharge','subscription')),
 order_id TEXT NOT NULL,
 partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 token TEXT NOT NULL CHECK(length(token)=32),
 PRIMARY KEY(domain,order_id)
);
CREATE INDEX partner_commission_dirty_owner_idx ON partner_commission_dirty(partner_user_id,domain,order_id);
CREATE TABLE partner_commission_entries (
 domain TEXT NOT NULL CHECK(domain IN ('recharge','subscription')),
 order_id TEXT NOT NULL,
 partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 paid_at INTEGER NOT NULL CHECK(paid_at>=0),
 rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),
 state TEXT NOT NULL CHECK(state IN ('verified','review','excluded')),
 principal_fen INTEGER,
 commission_fen INTEGER,
 reason TEXT,
 source_token TEXT NOT NULL CHECK(length(source_token)=32),
 PRIMARY KEY(domain,order_id),
 CHECK(partner_user_id<>buyer_user_id),
 CHECK((state='verified' AND typeof(principal_fen)='integer' AND principal_fen BETWEEN 0 AND 1000000000000
 AND typeof(commission_fen)='integer' AND commission_fen=principal_fen*rate_bps/10000 AND rate_bps>0 AND paid_at>0)
 OR (state<>'verified' AND principal_fen IS NULL AND commission_fen IS NULL))
);
CREATE INDEX partner_commission_entries_page_idx ON partner_commission_entries(partner_user_id,paid_at DESC,domain DESC,order_id DESC) WHERE state<>'excluded';
CREATE INDEX partner_commission_entries_buyer_idx ON partner_commission_entries(buyer_user_id);
CREATE TABLE partner_commission_totals (
 partner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 earned_fen INTEGER NOT NULL DEFAULT 0 CHECK(typeof(earned_fen)='integer' AND earned_fen BETWEEN 0 AND 9007199254740991),
 settled_fen INTEGER NOT NULL DEFAULT 0 CHECK(typeof(settled_fen)='integer' AND settled_fen BETWEEN 0 AND 9007199254740991),
 verified_count INTEGER NOT NULL DEFAULT 0 CHECK(verified_count>=0),
 review_count INTEGER NOT NULL DEFAULT 0 CHECK(review_count>=0)
);
INSERT INTO partner_commission_totals(partner_user_id,settled_fen)
 SELECT partner_user_id,SUM(amount_fen) FROM partner_manual_requests WHERE status='completed' GROUP BY partner_user_id;
CREATE TRIGGER partner_commission_entry_insert_guard BEFORE INSERT ON partner_commission_entries
 WHEN NOT EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain=NEW.domain AND q.order_id=NEW.order_id AND q.partner_user_id=NEW.partner_user_id AND q.token=NEW.source_token)
 BEGIN SELECT RAISE(ABORT,'commission dirty token invalid'); END;
CREATE TRIGGER partner_commission_entry_update_guard BEFORE UPDATE ON partner_commission_entries
 WHEN OLD.domain<>NEW.domain OR OLD.order_id<>NEW.order_id OR OLD.partner_user_id<>NEW.partner_user_id OR OLD.buyer_user_id<>NEW.buyer_user_id
 OR NOT EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain=NEW.domain AND q.order_id=NEW.order_id AND q.partner_user_id=NEW.partner_user_id AND q.token=NEW.source_token)
 BEGIN SELECT RAISE(ABORT,'commission identity or dirty token invalid'); END;
CREATE TRIGGER partner_commission_entry_no_delete BEFORE DELETE ON partner_commission_entries
 BEGIN SELECT RAISE(ABORT,'commission entries cannot be deleted'); END;
CREATE TRIGGER partner_commission_entry_insert AFTER INSERT ON partner_commission_entries
 BEGIN
 INSERT INTO partner_commission_totals(partner_user_id,earned_fen,verified_count,review_count)
 VALUES(NEW.partner_user_id,COALESCE(NEW.commission_fen,0),NEW.state='verified',NEW.state='review')
 ON CONFLICT(partner_user_id) DO UPDATE SET earned_fen=earned_fen+excluded.earned_fen,verified_count=verified_count+excluded.verified_count,review_count=review_count+excluded.review_count;
 DELETE FROM partner_commission_dirty WHERE domain=NEW.domain AND order_id=NEW.order_id AND token=NEW.source_token;
 END;
CREATE TRIGGER partner_commission_entry_update AFTER UPDATE ON partner_commission_entries
 BEGIN
 UPDATE partner_commission_totals SET earned_fen=earned_fen+COALESCE(NEW.commission_fen,0)-COALESCE(OLD.commission_fen,0),
 verified_count=verified_count+(NEW.state='verified')-(OLD.state='verified'),review_count=review_count+(NEW.state='review')-(OLD.state='review') WHERE partner_user_id=NEW.partner_user_id;
 DELETE FROM partner_commission_dirty WHERE domain=NEW.domain AND order_id=NEW.order_id AND token=NEW.source_token;
 END;
CREATE TRIGGER partner_commission_settled AFTER UPDATE OF status ON partner_manual_requests
 WHEN OLD.status='pending' AND NEW.status='completed'
 BEGIN
 INSERT INTO partner_commission_totals(partner_user_id,settled_fen) VALUES(NEW.partner_user_id,NEW.amount_fen)
 ON CONFLICT(partner_user_id) DO UPDATE SET settled_fen=settled_fen+excluded.settled_fen;
 END;
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_commission_ledger_enabled','0',0) ON CONFLICT(key) DO NOTHING;
CREATE TRIGGER partner_commission_recharge_insert AFTER INSERT ON recharge_orders WHEN NEW.paid_at>0
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_recharge_update AFTER UPDATE OF status,paid_at,credited_at ON recharge_orders
 WHEN (NEW.paid_at>0 OR OLD.paid_at>0) AND (NEW.status IS NOT OLD.status OR NEW.paid_at IS NOT OLD.paid_at OR NEW.credited_at IS NOT OLD.credited_at)
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_recharge_risk AFTER UPDATE OF status,risk_state,provider_trade_id,provider_payment_id,paid_at,principal_refunded_fen,epay_trade_no ON payment_transactions
 WHEN NEW.status IS NOT OLD.status OR NEW.risk_state IS NOT OLD.risk_state OR NEW.provider_trade_id IS NOT OLD.provider_trade_id OR NEW.provider_payment_id IS NOT OLD.provider_payment_id OR NEW.paid_at IS NOT OLD.paid_at OR NEW.principal_refunded_fen IS NOT OLD.principal_refunded_fen OR NEW.epay_trade_no IS NOT OLD.epay_trade_no
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.order_id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_recharge_bolt AFTER UPDATE OF status,paid_at,applied_at,tx_hash,paid_usdt_micros ON boltutil_orders
 WHEN NEW.credit_order_id IS NOT NULL AND (NEW.status IS NOT OLD.status OR NEW.paid_at IS NOT OLD.paid_at OR NEW.applied_at IS NOT OLD.applied_at OR NEW.tx_hash IS NOT OLD.tx_hash OR NEW.paid_usdt_micros IS NOT OLD.paid_usdt_micros)
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.credit_order_id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_subscription_insert AFTER INSERT ON subscription_orders WHEN NEW.paid_at>0
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_subscription_update AFTER UPDATE OF status,paid_at,applied_at ON subscription_orders
 WHEN (NEW.paid_at>0 OR OLD.paid_at>0) AND (NEW.status IS NOT OLD.status OR NEW.paid_at IS NOT OLD.paid_at OR NEW.applied_at IS NOT OLD.applied_at)
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_subscription_risk AFTER UPDATE OF status,risk_state,provider_trade_id,provider_payment_id,paid_at ON subscription_payment_transactions
 WHEN NEW.status IS NOT OLD.status OR NEW.risk_state IS NOT OLD.risk_state OR NEW.provider_trade_id IS NOT OLD.provider_trade_id OR NEW.provider_payment_id IS NOT OLD.provider_payment_id OR NEW.paid_at IS NOT OLD.paid_at
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.order_id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_subscription_bolt AFTER UPDATE OF status,paid_at,applied_at,tx_hash,paid_usdt_micros ON boltutil_orders
 WHEN NEW.subscription_order_id IS NOT NULL AND (NEW.status IS NOT OLD.status OR NEW.paid_at IS NOT OLD.paid_at OR NEW.applied_at IS NOT OLD.applied_at OR NEW.tx_hash IS NOT OLD.tx_hash OR NEW.paid_usdt_micros IS NOT OLD.paid_usdt_micros)
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=NEW.subscription_order_id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
-- No refund automation in this version. Changes only invalidate an old
-- commission so the existing conservative classifier can exclude the order.
CREATE TRIGGER partner_commission_refund_insert AFTER INSERT ON payment_refunds
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=(SELECT order_id FROM payment_transactions WHERE id=NEW.transaction_id) AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_refund_update AFTER UPDATE OF status,base_amount_fen ON payment_refunds
 WHEN NEW.status IS NOT OLD.status OR NEW.base_amount_fen IS NOT OLD.base_amount_fen
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id=(SELECT order_id FROM payment_transactions WHERE id=NEW.transaction_id) AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;
CREATE TRIGGER partner_commission_buyer_eligibility AFTER UPDATE OF role,status,email_verified_at,archived_at,is_test_account ON users
 WHEN NEW.role IS NOT OLD.role OR NEW.status IS NOT OLD.status OR NEW.email_verified_at IS NOT OLD.email_verified_at OR NEW.archived_at IS NOT OLD.archived_at OR NEW.is_test_account IS NOT OLD.is_test_account
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.user_id=NEW.id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.user_id=NEW.id AND (o.paid_at>0 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;
-- Fail closed if the owner tries to enable before historical capture. This
-- check runs once on flag activation, NOT on normal report/payment requests.
CREATE TRIGGER partner_commission_enable_guard BEFORE UPDATE OF value ON system_settings
 WHEN NEW.key='partner_commission_ledger_enabled' AND NEW.value='1' AND OLD.value<>'1'
 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id WHERE o.paid_at>0 AND r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at)
 AND NOT EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain='recharge' AND q.order_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id)) THEN RAISE(ABORT,'commission backfill incomplete') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id WHERE o.paid_at>0 AND r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at)
 AND NOT EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain='subscription' AND q.order_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id)) THEN RAISE(ABORT,'commission backfill incomplete') END;
 END;
-- Atomic safety gate, including requests submitted through an older Worker.
CREATE TRIGGER partner_commission_request_guard BEFORE INSERT ON partner_manual_requests
 WHEN COALESCE((SELECT value FROM system_settings WHERE key='partner_commission_ledger_enabled'),'0')='1'
 AND (EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.partner_user_id=NEW.partner_user_id)
 OR NEW.amount_fen<>COALESCE((SELECT earned_fen-settled_fen FROM partner_commission_totals WHERE partner_user_id=NEW.partner_user_id),0))
 BEGIN SELECT RAISE(ABORT,'commission balance changed'); END;

CREATE TRIGGER partner_commission_recharge_identity_insert AFTER INSERT ON payment_transactions
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id OR o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.id<>NEW.id AND x.provider_payment_id=NEW.epay_trade_no UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.id<>NEW.id AND x.epay_trade_no=NEW.provider_payment_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id IN (SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_trade_id=NEW.provider_trade_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_payment_id=NEW.provider_payment_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.provider_payment_id=NEW.epay_trade_no)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;

CREATE TRIGGER partner_commission_recharge_identity_update AFTER UPDATE OF merchant_provider,provider_trade_id,provider_payment_id,epay_trade_no ON payment_transactions WHEN NEW.merchant_provider IS NOT OLD.merchant_provider OR NEW.provider_trade_id IS NOT OLD.provider_trade_id OR NEW.provider_payment_id IS NOT OLD.provider_payment_id OR NEW.epay_trade_no IS NOT OLD.epay_trade_no
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id OR o.id=OLD.order_id OR o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.id<>NEW.id AND x.provider_payment_id=NEW.epay_trade_no UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.id<>NEW.id AND x.epay_trade_no=NEW.provider_payment_id) OR o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.id<>OLD.id AND x.provider_payment_id=OLD.epay_trade_no UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.id<>OLD.id AND x.epay_trade_no=OLD.provider_payment_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id IN (SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_trade_id=NEW.provider_trade_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_payment_id=NEW.provider_payment_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.provider_payment_id=NEW.epay_trade_no) OR o.id IN (SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_trade_id=OLD.provider_trade_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_payment_id=OLD.provider_payment_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.provider_payment_id=OLD.epay_trade_no)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;

CREATE TRIGGER partner_commission_recharge_identity_delete AFTER DELETE ON payment_transactions
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=OLD.order_id OR o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.id<>OLD.id AND x.provider_payment_id=OLD.epay_trade_no UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.id<>OLD.id AND x.epay_trade_no=OLD.provider_payment_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id IN (SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_trade_id=OLD.provider_trade_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.provider_payment_id=OLD.provider_payment_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM subscription_payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.provider_payment_id=OLD.epay_trade_no)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;

CREATE TRIGGER partner_commission_recharge_amount_update AFTER UPDATE OF currency,amount_fen,base_amount_fen,payment_protocol ON payment_transactions WHEN NEW.currency IS NOT OLD.currency OR NEW.amount_fen IS NOT OLD.amount_fen OR NEW.base_amount_fen IS NOT OLD.base_amount_fen OR NEW.payment_protocol IS NOT OLD.payment_protocol
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_identity_insert AFTER INSERT ON subscription_payment_transactions
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id OR 0) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.provider_trade_id=NEW.provider_trade_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.provider_payment_id=NEW.provider_payment_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.epay_trade_no=NEW.provider_payment_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;

CREATE TRIGGER partner_commission_subscription_identity_update AFTER UPDATE OF merchant_provider,provider_trade_id,provider_payment_id ON subscription_payment_transactions WHEN NEW.merchant_provider IS NOT OLD.merchant_provider OR NEW.provider_trade_id IS NOT OLD.provider_trade_id OR NEW.provider_payment_id IS NOT OLD.provider_payment_id
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id OR o.id=OLD.order_id OR 0 OR 0) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.provider_trade_id=NEW.provider_trade_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.provider_payment_id=NEW.provider_payment_id AND x.merchant_provider=NEW.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND NEW.merchant_provider='xiaodou' AND x.epay_trade_no=NEW.provider_payment_id) OR o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.provider_trade_id=OLD.provider_trade_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.provider_payment_id=OLD.provider_payment_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.epay_trade_no=OLD.provider_payment_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;

CREATE TRIGGER partner_commission_subscription_identity_delete AFTER DELETE ON subscription_payment_transactions
 BEGIN
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=OLD.order_id OR 0) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id IN (SELECT x.order_id FROM payment_transactions x WHERE x.provider_trade_id=OLD.provider_trade_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.provider_payment_id=OLD.provider_payment_id AND x.merchant_provider=OLD.merchant_provider UNION SELECT x.order_id FROM payment_transactions x WHERE x.merchant_provider='xiaodou' AND OLD.merchant_provider='xiaodou' AND x.epay_trade_no=OLD.provider_payment_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token;
 END;

CREATE TRIGGER partner_commission_subscription_amount_update AFTER UPDATE OF currency,amount_fen ON subscription_payment_transactions WHEN NEW.currency IS NOT OLD.currency OR NEW.amount_fen IS NOT OLD.amount_fen
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_provider_payment_events_insert AFTER INSERT ON provider_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT order_id FROM payment_transactions WHERE id=NEW.transaction_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_provider_payment_events_update AFTER UPDATE OF transaction_id,event_type,amount_fen,currency,merchant_provider ON provider_payment_events WHEN NEW.transaction_id IS NOT OLD.transaction_id OR NEW.event_type IS NOT OLD.event_type OR NEW.amount_fen IS NOT OLD.amount_fen OR NEW.currency IS NOT OLD.currency OR NEW.merchant_provider IS NOT OLD.merchant_provider
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE ((o.id=(SELECT order_id FROM payment_transactions WHERE id=NEW.transaction_id)) OR (o.id=(SELECT order_id FROM payment_transactions WHERE id=OLD.transaction_id))) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_provider_payment_events_delete AFTER DELETE ON provider_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT order_id FROM payment_transactions WHERE id=OLD.transaction_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_payment_events_insert AFTER INSERT ON subscription_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT order_id FROM subscription_payment_transactions WHERE id=NEW.transaction_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_payment_events_update AFTER UPDATE OF transaction_id,event_type,amount_fen,body_sha256,merchant_provider ON subscription_payment_events WHEN NEW.transaction_id IS NOT OLD.transaction_id OR NEW.event_type IS NOT OLD.event_type OR NEW.amount_fen IS NOT OLD.amount_fen OR NEW.body_sha256 IS NOT OLD.body_sha256 OR NEW.merchant_provider IS NOT OLD.merchant_provider
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE ((o.id=(SELECT order_id FROM subscription_payment_transactions WHERE id=NEW.transaction_id)) OR (o.id=(SELECT order_id FROM subscription_payment_transactions WHERE id=OLD.transaction_id))) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_payment_events_delete AFTER DELETE ON subscription_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT order_id FROM subscription_payment_transactions WHERE id=OLD.transaction_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_credit_ledger_insert AFTER INSERT ON credit_ledger WHEN NEW.kind='purchase_grant'
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.reference_id AND NEW.kind='purchase_grant') AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_credit_ledger_update AFTER UPDATE OF kind,reference_id,user_id,paid_delta ON credit_ledger WHEN NEW.kind IS NOT OLD.kind OR NEW.reference_id IS NOT OLD.reference_id OR NEW.user_id IS NOT OLD.user_id OR NEW.paid_delta IS NOT OLD.paid_delta
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE ((o.id=NEW.reference_id AND NEW.kind='purchase_grant') OR (o.id=OLD.reference_id AND OLD.kind='purchase_grant')) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_credit_ledger_delete AFTER DELETE ON credit_ledger WHEN OLD.kind='purchase_grant'
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=OLD.reference_id AND OLD.kind='purchase_grant') AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_credit_batches_insert AFTER INSERT ON credit_batches WHEN NEW.source_kind='purchase'
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.source_order_id AND NEW.source_kind='purchase') AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_credit_batches_update AFTER UPDATE OF source_order_id,user_id,source_kind,grant_credits ON credit_batches WHEN NEW.source_order_id IS NOT OLD.source_order_id OR NEW.user_id IS NOT OLD.user_id OR NEW.source_kind IS NOT OLD.source_kind OR NEW.grant_credits IS NOT OLD.grant_credits
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE ((o.id=NEW.source_order_id AND NEW.source_kind='purchase') OR (o.id=OLD.source_order_id AND OLD.source_kind='purchase')) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_credit_batches_delete AFTER DELETE ON credit_batches WHEN OLD.source_kind='purchase'
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=OLD.source_order_id AND OLD.source_kind='purchase') AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_periods_insert AFTER INSERT ON subscription_periods
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.source_order_id) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_periods_update AFTER UPDATE OF source_order_id,user_id ON subscription_periods WHEN NEW.source_order_id IS NOT OLD.source_order_id OR NEW.user_id IS NOT OLD.user_id
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE ((o.id=NEW.source_order_id) OR (o.id=OLD.source_order_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_periods_delete AFTER DELETE ON subscription_periods
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=OLD.source_order_id) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_tier_changes_insert AFTER INSERT ON subscription_tier_changes
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.order_id) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_tier_changes_update AFTER UPDATE OF order_id,period_id,charged_fen ON subscription_tier_changes WHEN NEW.order_id IS NOT OLD.order_id OR NEW.period_id IS NOT OLD.period_id OR NEW.charged_fen IS NOT OLD.charged_fen
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE ((o.id=NEW.order_id) OR (o.id=OLD.order_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_tier_changes_delete AFTER DELETE ON subscription_tier_changes
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=OLD.order_id) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_recharge_bolt_facts AFTER UPDATE OF base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,payable_usdt_micros,payable_token_raw,network,token_decimals,receiving_address,external_order_id,user_id,product_type ON boltutil_orders WHEN NEW.credit_order_id IS NOT NULL AND (NEW.base_amount_fen IS NOT OLD.base_amount_fen OR NEW.cny_per_usdt_micros IS NOT OLD.cny_per_usdt_micros OR NEW.quoted_usdt_micros IS NOT OLD.quoted_usdt_micros OR NEW.payable_usdt_micros IS NOT OLD.payable_usdt_micros OR NEW.payable_token_raw IS NOT OLD.payable_token_raw OR NEW.network IS NOT OLD.network OR NEW.token_decimals IS NOT OLD.token_decimals OR NEW.receiving_address IS NOT OLD.receiving_address OR NEW.external_order_id IS NOT OLD.external_order_id OR NEW.user_id IS NOT OLD.user_id OR NEW.product_type IS NOT OLD.product_type)
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.credit_order_id) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_recharge_bolt_event_insert AFTER INSERT ON boltutil_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT credit_order_id FROM boltutil_orders WHERE external_order_id=NEW.external_order_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_recharge_bolt_event_update AFTER UPDATE OF external_order_id,network,tx_hash,status,body_sha256 ON boltutil_payment_events WHEN NEW.external_order_id IS NOT OLD.external_order_id OR NEW.network IS NOT OLD.network OR NEW.tx_hash IS NOT OLD.tx_hash OR NEW.status IS NOT OLD.status OR NEW.body_sha256 IS NOT OLD.body_sha256
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT credit_order_id FROM boltutil_orders WHERE external_order_id=NEW.external_order_id) OR o.id=(SELECT credit_order_id FROM boltutil_orders WHERE external_order_id=OLD.external_order_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_recharge_bolt_event_delete AFTER DELETE ON boltutil_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT credit_order_id FROM boltutil_orders WHERE external_order_id=OLD.external_order_id)) AND (o.credited_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_bolt_facts AFTER UPDATE OF base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,payable_usdt_micros,payable_token_raw,network,token_decimals,receiving_address,external_order_id,user_id,product_type ON boltutil_orders WHEN NEW.subscription_order_id IS NOT NULL AND (NEW.base_amount_fen IS NOT OLD.base_amount_fen OR NEW.cny_per_usdt_micros IS NOT OLD.cny_per_usdt_micros OR NEW.quoted_usdt_micros IS NOT OLD.quoted_usdt_micros OR NEW.payable_usdt_micros IS NOT OLD.payable_usdt_micros OR NEW.payable_token_raw IS NOT OLD.payable_token_raw OR NEW.network IS NOT OLD.network OR NEW.token_decimals IS NOT OLD.token_decimals OR NEW.receiving_address IS NOT OLD.receiving_address OR NEW.external_order_id IS NOT OLD.external_order_id OR NEW.user_id IS NOT OLD.user_id OR NEW.product_type IS NOT OLD.product_type)
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=NEW.subscription_order_id) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_bolt_event_insert AFTER INSERT ON boltutil_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT subscription_order_id FROM boltutil_orders WHERE external_order_id=NEW.external_order_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_bolt_event_update AFTER UPDATE OF external_order_id,network,tx_hash,status,body_sha256 ON boltutil_payment_events WHEN NEW.external_order_id IS NOT OLD.external_order_id OR NEW.network IS NOT OLD.network OR NEW.tx_hash IS NOT OLD.tx_hash OR NEW.status IS NOT OLD.status OR NEW.body_sha256 IS NOT OLD.body_sha256
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT subscription_order_id FROM boltutil_orders WHERE external_order_id=NEW.external_order_id) OR o.id=(SELECT subscription_order_id FROM boltutil_orders WHERE external_order_id=OLD.external_order_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_subscription_bolt_event_delete AFTER DELETE ON boltutil_payment_events
 BEGIN INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o CROSS JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE (o.id=(SELECT subscription_order_id FROM boltutil_orders WHERE external_order_id=OLD.external_order_id)) AND (o.applied_at IS NOT NULL OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 AND ((r.registered_at<=o.paid_at AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at))
 OR EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id))
 ON CONFLICT(domain,order_id) DO UPDATE SET token=excluded.token; END;

CREATE TRIGGER partner_commission_referral_identity_guard BEFORE UPDATE OF inviter_user_id,invited_user_id,registered_at ON referral_invites
 WHEN NEW.inviter_user_id IS NOT OLD.inviter_user_id OR NEW.invited_user_id IS NOT OLD.invited_user_id OR NEW.registered_at IS NOT OLD.registered_at
 BEGIN SELECT RAISE(ABORT,'referral attribution is immutable'); END;
CREATE TRIGGER partner_commission_referral_delete_guard BEFORE DELETE ON referral_invites
 WHEN EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.buyer_user_id=OLD.invited_user_id)
 OR EXISTS(SELECT 1 FROM recharge_orders o JOIN partner_commission_dirty q ON q.domain='recharge' AND q.order_id=o.id WHERE o.user_id=OLD.invited_user_id)
 OR EXISTS(SELECT 1 FROM subscription_orders o JOIN partner_commission_dirty q ON q.domain='subscription' AND q.order_id=o.id WHERE o.user_id=OLD.invited_user_id)
 BEGIN SELECT RAISE(ABORT,'referral commission attribution is retained'); END;

-- Once captured, the original order identity and commercial snapshot must
-- not be silently changed or deleted. Normal order state transitions remain allowed.
CREATE TRIGGER partner_commission_recharge_order_snapshot_guard BEFORE UPDATE OF user_id,credits,payment_method,provider_reference ON recharge_orders
 WHEN (NEW.user_id IS NOT OLD.user_id OR NEW.credits IS NOT OLD.credits OR NEW.payment_method IS NOT OLD.payment_method OR NEW.provider_reference IS NOT OLD.provider_reference) AND (EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=OLD.id) OR EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain='recharge' AND q.order_id=OLD.id))
 BEGIN SELECT RAISE(ABORT,'commission order snapshot is retained'); END;
CREATE TRIGGER partner_commission_recharge_order_delete_guard BEFORE DELETE ON recharge_orders
 WHEN EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=OLD.id) OR EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain='recharge' AND q.order_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'commission order is retained'); END;

-- Once captured, the original order identity and commercial snapshot must
-- not be silently changed or deleted. Normal order state transitions remain allowed.
CREATE TRIGGER partner_commission_subscription_order_snapshot_guard BEFORE UPDATE OF user_id,kind,target_period_id,amount_fen ON subscription_orders
 WHEN (NEW.user_id IS NOT OLD.user_id OR NEW.kind IS NOT OLD.kind OR NEW.target_period_id IS NOT OLD.target_period_id OR NEW.amount_fen IS NOT OLD.amount_fen) AND (EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=OLD.id) OR EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain='subscription' AND q.order_id=OLD.id))
 BEGIN SELECT RAISE(ABORT,'commission order snapshot is retained'); END;
CREATE TRIGGER partner_commission_subscription_order_delete_guard BEFORE DELETE ON subscription_orders
 WHEN EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=OLD.id) OR EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.domain='subscription' AND q.order_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'commission order is retained'); END;
