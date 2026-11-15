import { ApiFailure } from "./types";

export const CUSTOMER_FEE_RATE_BPS = 150;
export type SettlementMode = "fixed_cny" | "usd_exchange";
export type PackagePricing = { price_cents:number; promo_price_cents?:number|null; price_cny_fen?:number|null; settlement_mode?:string|null; exchange_rate_micros?:number|null; fee_rate_bps?:number|null };
function invalid():never { throw new ApiFailure(503,"PACKAGE_PRICE_NOT_CONFIGURED","支付金额配置无效。"); }
export function projectPaymentFee(baseFen:number,feeRateBps=CUSTOMER_FEE_RATE_BPS){
  if(!Number.isSafeInteger(baseFen)||baseFen<1||!Number.isInteger(feeRateBps)||feeRateBps<0||feeRateBps>=10000)invalid();
  const denominator=BigInt(10000-feeRateBps),total=(BigInt(baseFen)*10000n+denominator-1n)/denominator;
  if(total>BigInt(Number.MAX_SAFE_INTEGER))invalid();
  const totalPaymentFen=Number(total);
  return {baseAmountFen:baseFen,serviceFeeFen:totalPaymentFen-baseFen,totalPaymentFen,feeRateBps};
}
function packageBasePricing(pkg:PackagePricing){
  const settlementMode=pkg.settlement_mode??"fixed_cny";
  let baseAmountFen:number,exchangeRateMicros:number|null=null;
  if(settlementMode==="fixed_cny")baseAmountFen=pkg.price_cny_fen??0;
  else if(settlementMode==="usd_exchange"){
    const usd=pkg.promo_price_cents??pkg.price_cents,rate=pkg.exchange_rate_micros;
    if(!Number.isSafeInteger(usd)||usd<1||!Number.isSafeInteger(rate)||!rate||rate<1)invalid();
    const base=(BigInt(usd)*BigInt(rate)+999999n)/1000000n;
    if(base>BigInt(Number.MAX_SAFE_INTEGER))invalid();
    baseAmountFen=Number(base);exchangeRateMicros=rate;
  }else invalid();
  if(!Number.isSafeInteger(baseAmountFen)||baseAmountFen<1)invalid();
  return {baseAmountFen,settlementMode:settlementMode as SettlementMode,exchangeRateMicros};
}
/** Underlying product price only. Independent of any fiat merchant's fee contract. */
export function projectCryptoBasePricing(pkg:PackagePricing){
  return packageBasePricing(pkg).baseAmountFen;
}
export function projectPackagePricing(pkg:PackagePricing){
  const feeRateBps=pkg.fee_rate_bps??CUSTOMER_FEE_RATE_BPS;
  if(!Number.isInteger(feeRateBps)||feeRateBps<0||feeRateBps>3000)invalid();
  const base=packageBasePricing(pkg);
  return {...projectPaymentFee(base.baseAmountFen,feeRateBps),...base};
}

/**
 * Xiaodou RSA2 default SELLER: website CNY price is the exact buyer amount.
 * The provider deducts processing fees from merchant settlement. Historical
 * orders retain immutable amount/fee snapshots in the transaction table.
 */
export function projectXiaodouSellerPricing(pkg:PackagePricing){
 const base=packageBasePricing(pkg);
 return {...base,serviceFeeFen:0,totalPaymentFen:base.baseAmountFen,feeRateBps:0};
}

// Commercial estimate only: platform settlement has not been reconciled.
export function projectMk99Pricing(pkg:PackagePricing){
 const base=packageBasePricing(pkg),gross=projectPaymentFee(base.baseAmountFen,500),costCoverageFen=gross.totalPaymentFen-base.baseAmountFen;
 return {...base,serviceFeeFen:0,totalPaymentFen:gross.totalPaymentFen,feeRateBps:0,merchantPricing:{version:'mk99-merchant-5pct-v1',status:'estimate_unverified',feeBearer:'merchant',rateBps:500,netTargetFen:base.baseAmountFen,costCoverageFen,estimatedFeeFen:costCoverageFen,estimatedNetFen:base.baseAmountFen}};
}
