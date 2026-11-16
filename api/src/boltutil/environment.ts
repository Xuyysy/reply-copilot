import type {Env} from "../types";

/**
 * Selling in Production needs its own explicit opt-in. Staging approval must
 * never activate Production. Historical reads and signed payment verification
 * do not depend on a live "create" switch so existing paid/unpaid orders can
 * be reconciled after accepting new payments is paused.
 */
export function boltEnvironmentSupported(env:Env):boolean {
 return env.ENVIRONMENT==="staging"||env.ENVIRONMENT==="production";
}
export function boltReadSchemaReady(env:Env):boolean {
 return boltEnvironmentSupported(env)&&env.BOLTUTIL_SCHEMA_READY==="1";
}
export function boltCreateAuthorized(env:Env):boolean {
 if(env.ENVIRONMENT==="staging")return env.BOLTUTIL_STAGING_CREATE_ENABLED==="1";
 if(env.ENVIRONMENT==="production")return env.BOLTUTIL_PRODUCTION_CREATE_ENABLED==="1";
 return false;
}
