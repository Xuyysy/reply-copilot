/** Only determines navigation and copy on the public pricing page.
 * Checkout pricing, upgrade quotations and subscription entitlements remain
 * entirely server-owned. In particular never infer an upgrade amount here. */
export const SUBSCRIPTION_TIERS = Object.freeze(['basic','pro','max','ultra']);
export const UPGRADE_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

export function subscriptionPricingChoices({
  targetPlan,
  buyerStatus = 'loading',
  currentPlan = null,
  expiresAt = null,
  pendingOrderId = null,
  queuedOrderId = null,
  now = Date.now(),
}) {
  if (!SUBSCRIPTION_TIERS.includes(targetPlan)) throw new RangeError('Unknown subscription plan');
  const nextUrl = '/subscription-checkout/?plan=' + encodeURIComponent(targetPlan);
  const orderUrl = id => '/subscription-checkout/?order=' + encodeURIComponent(id);
  if (buyerStatus === 'loading') return {mode:'loading',actions:[]};
  if (buyerStatus === 'unavailable') return {mode:'unavailable',actions:[{kind:'account',href:'/account/'}]};
  // Do not invite another real-money payment while the original order is unresolved.
  if (pendingOrderId) return {mode:'pending',actions:[{kind:'original',href:orderUrl(pendingOrderId)}]};
  if (queuedOrderId) return {mode:'queued',actions:[{kind:'original',href:orderUrl(queuedOrderId)}]};
  if (buyerStatus === 'guest') return {mode:'guest',actions:[{kind:'purchase',href:nextUrl}]};
  if (buyerStatus === 'none') return {mode:'purchase',actions:[{kind:'purchase',href:nextUrl}]};
  if (buyerStatus !== 'active' || !SUBSCRIPTION_TIERS.includes(currentPlan))
    return {mode:'unavailable',actions:[{kind:'account',href:'/account/'}]};
  const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now)
    return {mode:'unavailable',actions:[{kind:'account',href:'/account/'}]};

  const difference = SUBSCRIPTION_TIERS.indexOf(targetPlan) - SUBSCRIPTION_TIERS.indexOf(currentPlan);
  const next = {kind:'next',href:nextUrl};
  if (difference > 0 && expiry - now >= UPGRADE_MIN_REMAINING_MS)
    return {mode:'upgrade_available',actions:[
      {kind:'upgrade',href:nextUrl + '&upgrade=1'},next,
    ]};
  return {mode:difference > 0 ? 'upgrade_final_day' : difference === 0 ? 'renew_same' : 'change_next',actions:[next]};
}
