import {DEFAULT_MOMENTUM_CONFIG, validateMomentumConfig} from '../domain/creator-momentum.js';

const PAID_TTL = 300_000;
const FREE_TTL = 120_000;
const RETRY_INTERVAL = 5_000;
const publicPolicy = ({ranges, maxReminders, cooldownMinutes, ...policy}) => policy;
const blocked = state => ['frozen', 'auth_expired', 'auth_unavailable'].includes(state?.status);

export function createMomentumView({accountStates, client, momentum, storage, broadcast, clock = Date.now}) {
  let cached, pending, lastAttempt, backlog;
  let epoch = 0;
  let scope = crypto.randomUUID();

  function invalidate() {
    epoch++;
    scope = crypto.randomUUID();
    cached = pending = lastAttempt = undefined;
  }

  function refresh(token, owner, revision, manual) {
    if (pending?.token === token && pending.owner === owner) return pending.promise;
    if (lastAttempt?.token === token && lastAttempt.owner === owner &&
        clock() - lastAttempt.at >= 0 && clock() - lastAttempt.at < (manual ? RETRY_INTERVAL : 60_000)) {
      return Promise.reject(Error('FEATURE_RETRY_LATER'));
    }

    const entry = {token, owner, at: clock()};
    lastAttempt = entry;
    entry.promise = (async () => {
      const data = await client.request('/v1/entitlements?feature=interactionMomentum', {expectedToken: token});
      const feature = data.features?.interactionMomentum;
      if (await client.token() !== token || epoch !== revision || feature?.ownerId !== owner ||
          typeof feature.eligible !== 'boolean') throw Error('FEATURE_UNVERIFIED');
      cached = {token, owner, eligible: feature.eligible, policy: validateMomentumConfig(feature.policy), at: clock()};
      return cached;
    })().finally(() => { if (pending === entry) pending = undefined; });
    pending = entry;
    return entry.promise;
  }

  function proofFor(token, owner) {
    if (cached?.token !== token || cached.owner !== owner) return null;
    const age = clock() - cached.at;
    return age >= 0 && age < (cached.eligible ? PAID_TTL : FREE_TTL) ? cached : null;
  }

  function locked(status, stats) {
    return {
      status, scope, available: false, eligible: false, enabled: false,
      dnd: stats?.dnd === true,
      policy: publicPolicy(DEFAULT_MOMENTUM_CONFIG)
    };
  }

  async function view(message) {
    const revision = epoch;
    const token = await client.token();
    if (!token) return locked('guest');
    if ((message.refresh || message.ensure) && (!accountStates.peekState()?.user?.userId || blocked(accountStates.peekState()))) {
      await accountStates.getState?.({force: true});
    }
    const owner = accountStates.peekState()?.user?.userId;
    const sameAccount = async () => await client.token() === token && epoch === revision &&
      accountStates.cachedToken === token && accountStates.peekState()?.user?.userId === owner;
    if (!owner || !await sameAccount()) return locked('unverified');
    if (blocked(accountStates.peekState())) {
      if (cached?.token === token) cached = undefined;
      return locked('unverified');
    }

    if (message.presented) {
      const {id,lease}=message.presented;
      if (typeof id !== 'string' || !/^\d{4}-\d{2}-\d{2}:[1-3]$/.test(id) ||
          typeof lease !== 'string' || !/^[a-f0-9-]{36}$/i.test(lease)) return {confirmed:false};
      return {confirmed:await momentum.confirmReminder(owner,{id,lease})};
    }

    const saveRequested = typeof message.enabled === 'boolean';
    if (saveRequested && message.scope !== undefined && message.scope !== scope) return locked('unverified');
    const before = proofFor(token, owner);
    let proof = before;
    // Ordinary ACKs count locally. Only accounts that opted into monitoring renew proof here.
    const renewAfterAck = !proof && message.claim && (await momentum.snapshot?.(owner))?.enabled === true;
    if (!await sameAccount()) return locked('unverified');
    if ((!proof && (renewAfterAck || message.refresh || message.ensure || saveRequested)) ||
        (message.refresh && clock() - proof.at >= RETRY_INTERVAL)) {
      try { proof = await refresh(token, owner, revision, message.refresh === true); }
      catch { proof = null; if (await sameAccount()) cached = undefined; }
    }
    if (!await sameAccount()) return locked('unverified');

    // Passive UI refreshes read IndexedDB only. ACK claims and manual refreshes drain the existing outbox.
    let settled = true;
    if (message.claim || message.refresh || message.ensure || message.enabled === true) settled = await momentum.drain(storage);
    if (!settled && !backlog) {
      backlog = (async () => {
        for (let i = 0; i < 32; i++) if (await momentum.drain(storage)) break;
        await broadcast();
      })().catch(() => {}).finally(() => { backlog = null; });
    }

    if (!await sameAccount()) return locked('unverified');
    proof = proofFor(token, owner);
    const eligible = proof?.eligible === true;
    const policy = proof?.policy ?? DEFAULT_MOMENTUM_CONFIG;
    const canSave = saveRequested && eligible && policy.enabled === true;
    const mutation = canSave || message.dnd === true;
    const claim = Boolean(settled && eligible && (message.claim || message.surface || message.ensure || message.enabled === true));
    const result = mutation || claim
      ? await momentum.view(owner, policy, {eligible, enabled: canSave ? message.enabled : undefined, claim, dnd: message.dnd === true, available: !!proof, assignPolicy: !!proof})
      : await momentum.snapshot?.(owner);
    if (!await sameAccount()) return locked('unverified');

    if (mutation || message.claim || ((message.refresh || message.ensure) && before !== proof)) await broadcast();
    if (!await sameAccount()) return locked('unverified');
    if (!proof || proof !== proofFor(token, owner)) return locked('unverified', result);
    return {
      status: eligible ? 'paid' : 'free', scope, available: true, eligible,
      enabled: eligible && result?.enabled === true, proofUntil: proof.at + (eligible ? PAID_TTL : FREE_TTL),
      refreshAfter: proof.at + RETRY_INTERVAL,
      ...(saveRequested ? {saved: canSave && result?.enabled === message.enabled} : {}),
      dnd: result?.dnd === true, policy: publicPolicy(policy), reminder: result?.reminder
    };
  }

  view.invalidate = invalidate;
  view.policyFor = owner => cached?.owner === owner ? proofFor(cached.token, owner)?.policy ?? null : null;
  return view;
}
