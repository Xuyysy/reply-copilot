import type { Env } from "./types";
import { nowMs } from "./security";

export async function cleanup(env: Env, now = nowMs()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_verifications WHERE expires_at<?").bind(now - 86400_000),
    env.DB.prepare("DELETE FROM pending_registrations WHERE expires_at<?").bind(now - 86400_000),
    env.DB.prepare("DELETE FROM password_resets WHERE expires_at<?").bind(now - 86400_000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<? OR revoked_at<?").bind(now - 86400_000, now - 86400_000),
    env.DB.prepare("DELETE FROM extension_authorizations WHERE expires_at<?").bind(now - 86400_000),
    env.DB.prepare("DELETE FROM rate_limits WHERE period_start<?").bind(now - 2 * 86400_000),
    env.DB.prepare("DELETE FROM admin_mfa_pending WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM admin_elevations WHERE expires_at<? OR session_id NOT IN (SELECT id FROM sessions WHERE revoked_at IS NULL)").bind(now),
    env.DB.prepare("UPDATE ai_requests SET raw_response=NULL,response_expires_at=NULL WHERE response_expires_at IS NOT NULL AND response_expires_at<?").bind(now),
    env.DB.prepare("UPDATE ai_requests SET status='uncertain',completed_at=? WHERE status='reserved' AND created_at<?").bind(now,now-10*60_000),
    env.DB.prepare("DELETE FROM ai_requests WHERE created_at<? AND status IN ('succeeded','upstream_failed')").bind(now - 30 * 86400_000),
    env.DB.prepare("DELETE FROM daily_usage WHERE quota_date<?").bind(new Date(now - 90 * 86400_000 + 8 * 3600_000).toISOString().slice(0,10)),
    env.DB.prepare("DELETE FROM site_daily_usage WHERE quota_date<?").bind(new Date(now - 90 * 86400_000 + 8 * 3600_000).toISOString().slice(0,10)),
  ]);
}
