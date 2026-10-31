import type { Env } from "./types";
import { hmac, uuid } from "./security";

export type SignupBenefit = { status: "pending" | "granted"; amount: number };

/** Missing rows belong to accounts created before this feature; never retroactively change them. */
export async function signupBenefit(env: Env, userId: string): Promise<SignupBenefit | null> {
  const row = await env.DB.prepare(
    "SELECT status,grant_amount FROM signup_benefit_claims WHERE user_id=?"
  ).bind(userId).first<{status: "pending" | "granted"; grant_amount: number}>();
  return row ? { status: row.status, amount: row.grant_amount } : null;
}

/**
 * Append these statements to the SAME D1 batch that redeems the approved
 * device authorization and creates the extension session.
 *
 * Only a successful exchange may claim an install. Device IDs are untrusted
 * extension-local UUIDs: HMAC protects storage privacy, NOT against a user
 * deliberately resetting/reinstalling their extension.
 *
 * No statement is allowed to affect another user's free or paid balance.
 * Per-device and per-user UNIQUE constraints plus the random claim nonce
 * make repeated exchanges and concurrent claims idempotent.
 */
export async function signupClaimStatements(
  env: Env,
  args: { userId: string; deviceId: string; authorizationId: string; redeemNonce: string; now: number }
): Promise<D1PreparedStatement[]> {
  const {userId,deviceId,authorizationId,redeemNonce,now}=args;
  const digest=await hmac(env, `signup-install:v1:${deviceId.toLowerCase()}`);
  const claimNonce=uuid();
  return [
    // Grandfathered users keep their existing grant; when they next bind,
    // reserve that installation so a second new account cannot claim it.
    // A conflict is expected for a different account on the same install;
    // never refuse sign-in or block already-purchased credits.
    env.DB.prepare(`INSERT OR IGNORE INTO device_free_claims(device_digest,user_id,claimed_at)
      SELECT ?,user_id,? FROM extension_authorizations
      WHERE id=? AND redeem_nonce=? AND status='redeemed' AND user_id=?
        AND NOT EXISTS (SELECT 1 FROM device_free_claims WHERE user_id=?)
        AND (EXISTS(SELECT 1 FROM signup_benefit_claims WHERE user_id=? AND status='pending')
          OR EXISTS(SELECT 1 FROM credit_grants WHERE user_id=? AND grant_type='signup'))`)
      .bind(digest,now,authorizationId,redeemNonce,userId,userId,userId,userId),
    env.DB.prepare(`UPDATE signup_benefit_claims SET status='granted',
      device_digest=?,claim_nonce=?,granted_at=?
      WHERE user_id=? AND status='pending'
        AND EXISTS(SELECT 1 FROM device_free_claims WHERE device_digest=? AND user_id=?)
        AND EXISTS(SELECT 1 FROM extension_authorizations
          WHERE id=? AND redeem_nonce=? AND status='redeemed' AND user_id=?)`)
      .bind(digest,claimNonce,now,userId,digest,userId,authorizationId,redeemNonce,userId),
    env.DB.prepare(`UPDATE credit_accounts SET
      free_balance=free_balance+(SELECT grant_amount FROM signup_benefit_claims WHERE user_id=?),
      version=version+1,updated_at=?
      WHERE user_id=? AND EXISTS(SELECT 1 FROM signup_benefit_claims
        WHERE user_id=? AND status='granted' AND claim_nonce=?)`)
      .bind(userId,now,userId,userId,claimNonce),
    env.DB.prepare(`INSERT INTO credit_batches(
      id,user_id,bucket,source_kind,grant_credits,remaining_credits,
      consumed_credits,permanently_revoked_credits,granted_at,history_confidence,status)
      SELECT 'signup:'||user_id,user_id,'free','signup',grant_amount,grant_amount,
        0,0,?,'tracked','active'
      FROM signup_benefit_claims
      WHERE user_id=? AND status='granted' AND claim_nonce=?`)
      .bind(now,userId,claimNonce),
    env.DB.prepare(`INSERT INTO credit_grants(user_id,grant_type,amount,created_at)
      SELECT user_id,'signup',grant_amount,?
      FROM signup_benefit_claims
      WHERE user_id=? AND status='granted' AND claim_nonce=?`)
      .bind(now,userId,claimNonce),
    env.DB.prepare(`INSERT INTO credit_ledger(
      id,user_id,kind,free_delta,paid_delta,reference_id,created_at)
      SELECT ?,user_id,'signup_grant',grant_amount,0,user_id,?
      FROM signup_benefit_claims
      WHERE user_id=? AND status='granted' AND claim_nonce=?`)
      .bind(uuid(),now,userId,claimNonce)
  ];
}
