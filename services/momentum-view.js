import {DEFAULT_MOMENTUM_CONFIG, validateMomentumConfig} from '../domain/creator-momentum.js';

const PAID_TTL = 60_000;
const FREE_TTL = 15_000;
const RETRY_INTERVAL = 5_000;
const publicPolicy = ({ranges, maxReminders, cooldownMinutes, ...policy}) => policy;
const blocked = state => ['frozen', 'auth_expired', 'auth_unavailable'].includes(state?.status);

export function createMomentumView({accountStates, client, momentum, storage, broadcast, clock = Date.now}) {
  let cached, pending, lastAttempt, backlog;
  let epoch = 0;

  function invalidate() {
    epoch++;
    cached = pending = lastAttempt = undefined;
  }

  function refresh(token, owner, revision) {
    if (pending?.token === token && pending.owner === owner) return pending.promise;
    if (lastAttempt?.token === token && lastAttempt.owner === owner &&
        clock() - lastAttempt.at >= 0 && clock() - lastAttempt.at < RETRY_INTERVAL) {
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
      status, scope: epoch, available: false, eligible: false, enabled: false,
      count: stats?.count ?? null, dnd: stats?.dnd === true,
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

    const before = proofFor(token, owner);
    let proof = before;
    if ((!proof && (message.claim || message.refresh || message.ensure || message.enabled === true)) ||
        (message.refresh && clock() - proof.at >= RETRY_INTERVAL)) {
      try { proof = await refresh(token, owner, revision); }
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
    const mutation = message.enabled === false || (eligible && message.enabled === true) || message.dnd === true;
    const claim = Boolean(settled && eligible && (message.claim || message.enabled === true));
    const policy = proof?.policy ?? DEFAULT_MOMENTUM_CONFIG;
    const result = mutation || claim
      ? await momentum.view(owner, policy, {eligible, enabled: mutation ? message.enabled : undefined, claim, dnd: message.dnd === true, available: !!proof, assignPolicy: !!proof})
      : await momentum.snapshot?.(owner);
    if (!await sameAccount()) return locked('unverified');

    if (mutation || message.claim || ((message.refresh || message.ensure) && before !== proof)) await broadcast();
    if (!await sameAccount()) return locked('unverified');
    if (!proof || proof !== proofFor(token, owner)) return locked('unverified', result);
    return {
      status: eligible ? 'paid' : 'free', scope: epoch, available: true, eligible,
      enabled: eligible && result?.enabled === true, count: result?.count ?? 0,
      dnd: result?.dnd === true, policy: publicPolicy(policy), reminder: result?.reminder
    };
  }

  view.invalidate = invalidate;
  view.policyFor = owner => cached?.owner === owner ? proofFor(cached.token, owner)?.policy ?? null : null;
  return view;
}
