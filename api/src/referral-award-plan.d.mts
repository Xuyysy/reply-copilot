export declare const REFERRAL_BONUS: 50;
export declare const REFERRAL_MONTHLY_LIMIT: 10;
export declare const REFERRAL_WINDOW_MS: number;
export declare function normalizeReferralCode(value: unknown): string | null;
export declare function referralAwardPlan(args:{inviteeId:string;nonce:string;now:number}): Array<{sql:string;params:Array<string|number>}>;
