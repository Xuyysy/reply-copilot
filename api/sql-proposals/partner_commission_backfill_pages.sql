-- Run once per historical page with explicit owner approval. Bind afterId and pageEndId from a reviewed keyset inventory. No overwrites of fresh dirty tokens.
INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'recharge',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM recharge_orders o JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id>? AND o.id<=? AND o.paid_at>0 AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at)
 AND NOT EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='recharge' AND e.order_id=o.id)
 ON CONFLICT(domain,order_id) DO NOTHING;

-- Run once per historical page with explicit owner approval. Bind afterId and pageEndId from a reviewed keyset inventory. No overwrites of fresh dirty tokens.
INSERT INTO partner_commission_dirty(domain,order_id,partner_user_id,token)
 SELECT 'subscription',o.id,r.inviter_user_id,lower(hex(randomblob(16))) FROM subscription_orders o JOIN referral_invites r ON r.invited_user_id=o.user_id
 WHERE o.id>? AND o.id<=? AND o.paid_at>0 AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at)
 AND NOT EXISTS(SELECT 1 FROM partner_commission_entries e WHERE e.domain='subscription' AND e.order_id=o.id)
 ON CONFLICT(domain,order_id) DO NOTHING;