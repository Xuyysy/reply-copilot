export const PRODUCTION_DATABASE_ID='d9df7d23-9b9c-44ac-a33a-c24474c15691';

export class BootstrapError extends Error {
 constructor(code){super(code);this.name='BootstrapError';this.code=code;}
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]{1,128}@[^\s@.]{1,128}(?:\.[^\s@.]{1,63})+$/;

function validInput(input){
 return Boolean(input&&typeof input==='object'&&UUID.test(input.userId??'')&&typeof input.email==='string'&&input.email.length<=254&&EMAIL.test(input.email)&&typeof input.reason==='string'&&input.reason.trim().length>=8&&input.reason.trim().length<=500&&!/[\u0000-\u001f\u007f]/.test(input.reason));
}

function assertGuard(guard,input){
 if(guard?.environment!=='production')throw new BootstrapError('WRONG_ENVIRONMENT');
 if(guard?.configuredDatabaseId!==PRODUCTION_DATABASE_ID||guard?.requestedDatabaseId!==PRODUCTION_DATABASE_ID||guard?.confirmedDatabaseId!==PRODUCTION_DATABASE_ID)throw new BootstrapError('WRONG_DATABASE');
 if(guard?.explicitAuthorization!==true)throw new BootstrapError('OWNER_AUTHORIZATION_REQUIRED');
 if(guard?.typedConfirmationUserId!==input?.userId)throw new BootstrapError('TYPED_CONFIRMATION_REQUIRED');
}

/** Inspect a single candidate without ever returning the candidate email. */
export async function inspectBootstrapTarget(db,input){
 if(!validInput(input))return {eligible:false,reason:'INVALID_INPUT',userExists:false,emailMatches:false,active:false,emailVerified:false,ordinaryUser:false,noExistingAdmin:false,noExistingBinding:false};
 const row=await db.prepare(`SELECT
  EXISTS(SELECT 1 FROM users WHERE id=?) AS user_exists,
  EXISTS(SELECT 1 FROM users WHERE id=? AND email=? COLLATE NOCASE) AS email_matches,
  EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AS is_active,
  EXISTS(SELECT 1 FROM users WHERE id=? AND email_verified_at>0) AS email_verified,
  EXISTS(SELECT 1 FROM users WHERE id=? AND role='user') AS ordinary_user,
  NOT EXISTS(SELECT 1 FROM users WHERE role='admin') AS no_admin,
  NOT EXISTS(SELECT 1 FROM site_administrator) AS no_binding`)
  .bind(input.userId,input.userId,input.email,input.userId,input.userId,input.userId).first();
 const checks={userExists:Boolean(row?.user_exists),emailMatches:Boolean(row?.email_matches),active:Boolean(row?.is_active),emailVerified:Boolean(row?.email_verified),ordinaryUser:Boolean(row?.ordinary_user),noExistingAdmin:Boolean(row?.no_admin),noExistingBinding:Boolean(row?.no_binding)};
 let reason=null;
 if(!checks.userExists)reason='USER_NOT_FOUND';
 else if(!checks.emailMatches)reason='EMAIL_MISMATCH';
 else if(!checks.active)reason='USER_DISABLED';
 else if(!checks.emailVerified)reason='USER_NOT_VERIFIED';
 else if(!checks.ordinaryUser)reason='USER_NOT_ORDINARY';
 else if(!checks.noExistingAdmin)reason='EXISTING_ADMIN';
 else if(!checks.noExistingBinding)reason='ADMIN_ALREADY_BOUND';
 return {eligible:reason===null,reason,...checks};
}

/**
 * Promote an existing verified user as one transaction. All predicates are repeated
 * inside the first statement to close the preflight/write race. Later statements
 * depend on SQLite changes() within D1's documented atomic batch. A constraint
 * sentinel aborts the batch if any preceding write did not occur.
 */
export async function bootstrapAdmin(db,input,guard){
 assertGuard(guard,input);
 if(!validInput(input))throw new BootstrapError('INVALID_INPUT');
 const check=await inspectBootstrapTarget(db,input);
 if(!check.eligible)throw new BootstrapError(check.reason??'PRECONDITION_FAILED');
 const auditId=crypto.randomUUID(),boundAt=Date.now(),reason=input.reason.trim();
 const results=await db.batch([
  db.prepare(`UPDATE users SET role='admin'
   WHERE id=? AND email=? COLLATE NOCASE AND status='active' AND email_verified_at>0 AND role='user'
    AND NOT EXISTS(SELECT 1 FROM users WHERE role='admin')
    AND NOT EXISTS(SELECT 1 FROM site_administrator)`).bind(input.userId,input.email),
  db.prepare(`INSERT INTO site_administrator(id,user_id,bound_at)
   SELECT 1,?,? WHERE changes()=1`).bind(input.userId,boundAt),
  db.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at)
   SELECT ?,?,'initial_admin_bootstrap',?,?,?, ?,? WHERE changes()=1`)
   .bind(auditId,input.userId,input.userId,reason,JSON.stringify({role:'user'}),JSON.stringify({role:'admin',binding:'site_administrator'}),boundAt),
  db.prepare(`INSERT INTO site_administrator(id,user_id,bound_at)
   SELECT 2,?,? WHERE changes()=0`).bind(input.userId,boundAt)
 ]);
 const changes=results.map(result=>Number(result?.meta?.changes??0));
 if(changes[0]!==1||changes[1]!==1||changes[2]!==1||changes[3]!==0)throw new BootstrapError('PRECONDITION_FAILED');
 return {ok:true,code:'ADMIN_BOOTSTRAP_COMPLETED',auditId,boundAt,userId:input.userId};
}
