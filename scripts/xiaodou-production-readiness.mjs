import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rehearseXiaodou0025Locally } from './xiaodou-production-local-rehearsal.mjs';
import { productionBlockers } from './production-preflight.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_RSA2_SECRETS = Object.freeze([
  'XIAODOU_BASE_URL', 'XIAODOU_APP_ID', 'XIAODOU_KEY_ID',
  'XIAODOU_PRIVATE_KEY', 'XIAODOU_PLATFORM_PUBLIC_KEYS'
]);
const SHA = /^[a-f0-9]{40}$/i;
const SQL_SHA = /^[a-f0-9]{64}$/i;
const DEPLOYMENT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * NO NETWORK, NO D1, NO AUTHENTICATION, NO DEPLOYMENT.
 * This is an operator evidence checklist, not a trusted payment unlock.
 * Evidence is supplied separately and cannot be independently authenticated
 * from a local JSON file; no result can authorize a financial action.
 */
export function evaluateXiaodouProductionReadiness(evidence = {}, options = {}) {
  const root = options.root || ROOT;
  const findings = [];
  const check = (phase, id, pass, next) => {
    findings.push({ phase, id, pass: pass === true, next });
  };
  const source = evidence?.source || {};
  const database = evidence?.database || {};
  const runtime = evidence?.runtime || {};
  const provider = evidence?.provider || {};
  const release = evidence?.release || {};
  const bindingList = Array.isArray(runtime.workerBindings) ? runtime.workerBindings : [];
  // Presence/type metadata only. Never read, return or log binding values.
  const bindings = new Map(bindingList.filter(x => x && typeof x.name === 'string' &&
    typeof x.type === 'string').map(x => [x.name, x.type]));

  let proposalSha256 = null;
  let replay = null;
  try {
    const proposalPath = join(root, 'api/sql-proposals/0025_subscription_xiaodou_rsa2.sql');
    if (!existsSync(proposalPath)) throw new Error('SQL proposal missing');
    proposalSha256 = createHash('sha256').update(readFileSync(proposalPath)).digest('hex');
    replay = rehearseXiaodou0025Locally();
    check('code', 'local_migration_rehearsal',
      replay.historicalMk99TransactionPreserved === true &&
      replay.historicalMk99EventPreserved === true &&
      replay.xiaodouSchemaAccepted === true &&
      replay.foreignKeysValid === true &&
      replay.noEntitlementsGranted === true &&
      replay.productionMigrations === 24,
      'Keep 0025 out of auto migrations; re-run offline MK99-history/foreign-key regression');
  } catch {
    check('code', 'local_migration_rehearsal', false,
      'Repair the local 0025 SQL proposal or in-memory migration fixture; never inspect remote D1 without approval');
  }
  try {
    const prod = JSON.parse(readFileSync(join(root, 'api/deploy/production.wrangler.json'), 'utf8'));
    const staging = JSON.parse(readFileSync(join(root, 'api/wrangler.jsonc'), 'utf8')).env.staging;
    const errors = productionBlockers(prod, staging);
    check('code', 'production_identity_and_isolation', errors.length === 0,
      'Restore the isolated Production Worker/D1, protected origin and redacted callback logging');
    check('code', 'proposal_excluded_from_auto_migrations',
      !existsSync(join(root, 'api/migrations/0025_subscription_xiaodou_rsa2.sql')),
      'Remove 0025 from auto-applied migrations; it requires its own D1 approval');
  } catch {
    check('code', 'production_identity_and_isolation', false, 'Repair Production config before building');
    check('code', 'proposal_excluded_from_auto_migrations', false, 'Recheck deployable migrations');
  }

  // A human-supplied audit summary is not proof of authorization. Every item
  // below requires verification by an appropriately authorized operator.
  check('database', 'read_only_audit_approved_and_completed',
    database.readOnlyAuditApproved === true && database.schema0024Matches === true,
    'Authorize the bounded Production D1 read-only audit, then compare actual table definitions and migration history');
  check('database', 'verified_backup_and_restore',
    database.backupApproved === true && database.backupRestoreTested === true,
    'Separately authorize a secure Production D1 backup and verify its restore procedure');
  check('database', '0025_explicit_approval_and_verified_application',
    database.migration0025Approved === true && database.migration0025AppliedVerified === true &&
    typeof database.appliedSqlSha256 === 'string' && SQL_SHA.test(database.appliedSqlSha256) &&
    database.appliedSqlSha256 === proposalSha256,
    'Separately approve and verify the exact pinned 0025 SQL SHA on Production D1; no automatic migration');
  check('database', 'legacy_financial_rows_and_foreign_keys_preserved',
    database.legacyMk99Preserved === true && database.foreignKeysVerified === true,
    'Verify real MK99 settlement rows, event references and foreign keys under authorized D1 scope');

  const correctSecrets = REQUIRED_RSA2_SECRETS.every(name => bindings.get(name) === 'secret_text');
  check('merchant', 'five_rsa2_secret_bindings_present', correctSecrets,
    'Provision all five Xiaodou RSA2 credential bindings with separate explicit secret-change approval');
  const networkFlag = runtime.networkMode === 'allowlist_disabled'
    ? bindings.get('XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED') === 'plain_text'
    : runtime.networkMode === 'verified_egress'
      ? bindings.get('XIAODOU_SOURCE_IP_CONFIRMED') === 'plain_text'
      : false;
  check('merchant', 'network_mode_explicitly_confirmed',
    networkFlag && runtime.networkModeConfirmed === true &&
    (runtime.networkMode === 'allowlist_disabled' || runtime.networkMode === 'verified_egress'),
    'Merchant allowlist is reportedly disabled; separately approve and verify the Production network-mode confirmation binding');
  check('merchant', 'signed_query_webhook_and_alipay_acceptance',
    bindings.get('XIAODOU_WEBHOOKS_ENABLED') === 'plain_text' &&
    provider.signedQueryVerified === true && provider.signedWebhookVerified === true &&
    provider.alipayMerchantReleased === true && provider.subscriptionSettlementVerified === true &&
    provider.creditSettlementVerified === true,
    'Verify signed Xiaodou read, webhook and Alipay release; preserve separate credit and subscription settlement');
  check('merchant', 'historical_mk99_continuity', provider.legacyMk99SettlementVerified === true,
    'Verify historical MK99 pending/paid/unknown orders continue under immutable original merchant identity');

  const candidateSha = source.candidateSha;
  const sourceValid = typeof candidateSha === 'string' && SHA.test(candidateSha);
  check('release', 'exact_source_and_build_ci',
    sourceValid && release.fullPushCiSha === candidateSha && release.fullPushCiPassed === true &&
    release.productionBuildSha === candidateSha && release.productionBuildPassed === true &&
    release.productionArtifactChecksumVerified === true,
    'Require exact final release/production SHA, full Push CI and independent immutable Production build');
  check('release', 'protected_worker_rollout_authorized',
    release.protectedEnvironmentApproved === true && release.compatibleWorkerDeployApproved === true &&
    typeof release.rollbackWorkerDeploymentId === 'string' &&
    DEPLOYMENT_ID.test(release.rollbackWorkerDeploymentId),
    'Separately approve a protected compatible Worker rollout with MK99 still selected and a pinned rollback version');
  check('release', 'compatible_worker_live_and_mk99_selected',
    sourceValid && release.liveWorkerSourceSha === candidateSha &&
    release.mk99StillActiveVerified === true,
    'Verify exact deployed Worker SHA and confirm MK99 remains active before considering any merchant change');
  check('switch', 'explicit_separate_merchant_switch_approval',
    release.merchantSwitchApproved === true && release.signedProductionAcceptanceApproved === true,
    'Get a new, independent approval for real signed Production acceptance and then the audited merchant selection change');

  const phases = ['code', 'database', 'merchant', 'release', 'switch'].map(name => {
    const items = findings.filter(x => x.phase === name);
    return { name, checked: items.length, passed: items.filter(x => x.pass).length,
      claimsComplete: items.every(x => x.pass) };
  });
  const blockers = findings.filter(x => !x.pass).map(x => ({
    phase: x.phase, id: x.id, next: x.next
  }));
  return {
    purpose: 'Xiaodou Production cutover evidence checklist',
    evidenceIsOperatorSuppliedNotIndependentlyVerified: true,
    permitsRemoteD1: false,
    permitsSecretsModification: false,
    permitsDeployment: false,
    permitsMerchantSwitch: false,
    productionReady: false,
    status: blockers.length ? 'NO_GO' : 'EVIDENCE_CLAIMS_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL',
    proposalSha256,
    phases,
    blockers,
    nextBlocker: blockers[0] || null
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let evidence = {};
  try {
    if (process.argv.length !== 2 && (process.argv.length !== 4 ||
        process.argv[2] !== '--evidence')) throw new Error('USAGE');
    if (process.argv[2] === '--evidence') {
      const data = readFileSync(resolve(process.argv[3]), 'utf8');
      if (data.length > 65536) throw new Error('SIZE');
      evidence = JSON.parse(data);
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
          evidence.schemaVersion !== 1) throw new Error('SCHEMA');
    }
    const result = evaluateXiaodouProductionReadiness(evidence);
    console.log(JSON.stringify(result, null, 2));
    // A green claim packet still never grants deployment permission.
    process.exitCode = result.blockers.length ? 2 : 0;
  } catch {
    console.error('Invalid evidence. Usage: node scripts/xiaodou-production-readiness.mjs [--evidence sanitized-operator-claims.json]');
    process.exitCode = 2;
  }
}
