import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [action, emailInput] = process.argv.slice(2);
const email = emailInput?.trim().toLowerCase();
if (!["grant", "revoke"].includes(action) || !email || email.length > 254 || !/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email)) {
  throw new Error("Usage: npm run license:local -- grant|revoke verified@example.test");
}
// This command is deliberately hardwired to --local and has no remote option.
const escaped = email.replaceAll("'", "''");
const sql = action === "grant"
  ? `INSERT INTO licenses(id,user_id,license_type,status,max_devices,created_at) SELECT '${randomUUID()}',id,'lifetime','active',2,${Date.now()} FROM users WHERE email='${escaped}' AND email_verified_at IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET status='active';`
  : `UPDATE licenses SET status='revoked' WHERE user_id=(SELECT id FROM users WHERE email='${escaped}');`;
const wrangler = path.join(apiRoot, "node_modules", ".bin", "wrangler");
execFileSync(wrangler, ["d1", "execute", "DB", "--local", "--command", sql], { cwd: apiRoot, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: "/private/tmp/reply-copilot-wrangler.log" } });
