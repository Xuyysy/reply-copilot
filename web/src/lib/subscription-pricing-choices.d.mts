export type PricingChoice = {kind:'account'|'original'|'purchase'|'next'|'upgrade';href:string};
export type PricingMode = 'loading'|'unavailable'|'pending'|'queued'|'guest'|'purchase'|'upgrade_available'|'upgrade_final_day'|'renew_same'|'change_next';
export declare const SUBSCRIPTION_TIERS: readonly ['basic','pro','max','ultra'];
export declare const UPGRADE_MIN_REMAINING_MS: number;
export declare function subscriptionPricingChoices(input:{
 targetPlan:string;
 buyerStatus?:'loading'|'guest'|'none'|'active'|'unavailable';
 currentPlan?:string|null;
 expiresAt?:string|null;
 pendingOrderId?:string|null;
 queuedOrderId?:string|null;
 now?:number;
}):{mode:PricingMode;actions:PricingChoice[]};
