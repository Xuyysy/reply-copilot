import { XiaodouProviderError, safeProviderResponseDiagnostic } from './xiaodou.js';

// Checkout preparation is not a payment fact. Only query/webhook settlement
// may grant credits, even when creation returns a signed SUCCEEDED snapshot.
export type CheckoutOutcome = 'ready' | 'rejected' | 'unknown' | 'unavailable' | 'confirmation_required';
export type CheckoutResult = {
  outcome: CheckoutOutcome;
  issue: string;
  paymentUrl: string | null;
  paymentStatus: 'pending' | 'unknown';
};
export class CheckoutValidationError extends Error {
  constructor(public code: string) { super('Payment checkout could not be verified.'); }
}
export function inspectCheckoutResponse(value: any, expected: {outTradeNo:string;amountFen:number}):CheckoutResult {
  if (!value || value.outTradeNo !== expected.outTradeNo || value.currency !== 'CNY'
    || !Number.isSafeInteger(value.amountFen) || value.amountFen !== expected.amountFen)
    throw new CheckoutValidationError('CHECKOUT_SNAPSHOT_MISMATCH');
  if (!['CREATED','PAYING','SUCCEEDED','FAILED','CLOSED','UNKNOWN'].includes(value.status))
    throw new CheckoutValidationError('CHECKOUT_INVALID_STATUS');
  if (value.unknown !== undefined && typeof value.unknown !== 'boolean') throw new CheckoutValidationError('CHECKOUT_INVALID_STATUS');
  if (value.channel !== undefined && !['ALIPAY_H5','WECHAT_H5'].includes(value.channel)) throw new CheckoutValidationError('CHECKOUT_SNAPSHOT_MISMATCH');
  if (value.unknown === true || value.status === 'UNKNOWN')
    return {outcome:'unknown',issue:'CHECKOUT_RESULT_UNKNOWN',paymentUrl:null,paymentStatus:'unknown'};
  if (value.status === 'SUCCEEDED')
    return {outcome:'confirmation_required',issue:'CHECKOUT_PAYMENT_CONFIRMATION_REQUIRED',paymentUrl:null,paymentStatus:'unknown'};
  if (value.status === 'CLOSED' || value.status === 'FAILED')
    return {outcome:'unavailable',issue:'CHECKOUT_NOT_PAYABLE',paymentUrl:null,paymentStatus:'unknown'};
  if (typeof value.payUrl !== 'string' || !value.payUrl)
    return {outcome:'unavailable',issue:'CHECKOUT_LINK_MISSING',paymentUrl:null,paymentStatus:'pending'};
  let target:URL;
  try { target=new URL(value.payUrl); } catch { throw new CheckoutValidationError('CHECKOUT_LINK_INVALID'); }
  if (target.protocol !== 'https:' || target.username || target.password || value.payUrl.length > 8192)
    throw new CheckoutValidationError('CHECKOUT_LINK_INVALID');
  return {outcome:'ready',issue:'CHECKOUT_READY',paymentUrl:value.payUrl,paymentStatus:'pending'};
}
export function classifyCheckoutFailure(error:unknown):CheckoutResult {
  // An observed unsigned rejection can explain why no link was released, but
  // cannot prove the platform's identity, order existence or payment state.
  if(error instanceof XiaodouProviderError){
    const diagnostic=safeProviderResponseDiagnostic(error.responseDiagnostic,error.upstreamHttpStatus);
    const status=error.upstreamHttpStatus;
    if(error.stage==='provider_http_response' && diagnostic?.format==='business_json'
      && diagnostic.providerCode && typeof status==='number' && status >= 400 && status < 500 && status !== 409)
      return {outcome:'rejected',issue:diagnostic.providerCode,paymentUrl:null,paymentStatus:'unknown'};
  }
  return {outcome:'unknown',issue:error instanceof CheckoutValidationError?error.code:'CHECKOUT_RESULT_UNCONFIRMED',paymentUrl:null,paymentStatus:'unknown'};
}
const outcomes=new Set(['ready','rejected','unknown','unavailable','confirmation_required']);
export function checkoutMarker(result:CheckoutResult):string {return `checkout-v2:${result.outcome}:${result.issue}`;}
export function checkoutFromAttempt(marker:unknown):{outcome:CheckoutOutcome;issue:string}|null {
  if(typeof marker!=='string')return null;
  const parts=marker.split(':');
  if(parts.length!==3 || parts[0]!=='checkout-v2' || !outcomes.has(parts[1]) || !/^[A-Z0-9_]{1,80}$/.test(parts[2]))return null;
  return {outcome:parts[1] as CheckoutOutcome,issue:parts[2]};
}
export function checkoutHttpStatus(result:CheckoutResult):number {
  return result.outcome==='ready'?201:result.outcome==='confirmation_required'?202:result.outcome==='unknown'?503:502;
}
