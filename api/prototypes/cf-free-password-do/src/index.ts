import { DurableObject } from "cloudflare:workers";
import { hashPasswordWithIterations, verifyPassword } from "../../../src/password-auth";

/**
 * Stateless and secret-bearing by design: no user, password, hash, result or
 * pepper is written to DO storage or logs. Cloudflare provisions a SQLite
 * namespace solely to permit use on Workers Free.
 *
 * Cloudflare's RPC object-capability boundary means only a Worker with this
 * namespace binding can invoke verify(). The public script has no auth route.
 */
interface VerifierEnv {
  PASSWORD_PEPPER?: string;
}
export class PasswordVerifierDO extends DurableObject<VerifierEnv> {
  /** Creation has the same salt/pepper and work factors as the original API. */
  async hash(password: string, iterations: number): Promise<string> {
    if (typeof password!=="string" || password.length<12 ||
        new TextEncoder().encode(password).length>256 ||
        (iterations!==100_000 && iterations!==60_000 && iterations!==10_000))
      throw new Error("INVALID_HASH_PROFILE");
    return hashPasswordWithIterations(this.env,password,iterations);
  }
  async verify(password: string, stored: string): Promise<boolean> {
    if (typeof password !== "string" || password.length > 256 ||
        typeof stored !== "string" || stored.length > 180) return false;
    // Reuses the exact allowlisted 10k/60k/100k/210k legacy PBKDF2-SHA256
    // verifier, pepper construction, salt parsing and constant-time compare.
    return verifyPassword(this.env,password,stored);
  }
}

// A standalone Worker is needed to own the namespace. It does not expose
// an HTTP verification endpoint or read D1, so only internal RPC is possible.
export default {
  async fetch(): Promise<Response> {
    return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  },
};
