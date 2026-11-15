// BoltUtil multi-network USDT contracts and exact decimal semantics.
// BoltUtil order amount is at most 6 decimals, but BEP20 token raw units use 18.
export type BoltNetwork = "TRC20" | "POLYGON" | "BEP20";
export const SUPPORTED_BOLT_NETWORKS: readonly BoltNetwork[] = ["TRC20","POLYGON","BEP20"];
export const NETWORKS: Readonly<Record<BoltNetwork,{name:string;contract:string;decimals:6|18}>> = {
  TRC20:{name:"TRON",contract:"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",decimals:6},
  POLYGON:{name:"Polygon PoS",contract:"0xc2132D05D31c914a87C6611C10748AEb04B58e8F",decimals:6},
  BEP20:{name:"BNB Smart Chain",contract:"0x55d398326f99059fF775485246999027B3197955",decimals:18}
};
export const USDT_ORDER_SCALE=1000000n;

export function parseBoltNetwork(v:unknown):BoltNetwork {
  if(v!=="TRC20"&&v!=="POLYGON"&&v!=="BEP20")throw new RangeError("unsupported BoltUtil network");
  return v;
}
export function decimalMicros(value:unknown):bigint{
  if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/.test(value))
    throw new RangeError("invalid decimal");
  const [whole,fraction=""]=value.split(".");
  const micros=BigInt(whole)*USDT_ORDER_SCALE+BigInt((fraction+"000000").slice(0,6));
  if(micros<0n||micros>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError("amount range");
  return micros;
}
export function formatMicros(value:bigint):string{
  if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError("amount range");
  const whole=value/USDT_ORDER_SCALE;
  const fraction=(value%USDT_ORDER_SCALE).toString().padStart(6,"0").replace(/0+$/,"");
  return whole.toString()+(fraction?"."+fraction:"");
}
export function tokenRawUnits(value:bigint,network:BoltNetwork):bigint {
  if(value<0n)return 0n;
  return value*(10n**BigInt(NETWORKS[network].decimals-6));
}
export function validReceivingAddress(value:unknown,network:BoltNetwork):value is string{
  return typeof value==="string" && (network==="TRC20"
    ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)
    : /^0x[a-fA-F0-9]{40}$/.test(value));
}
export function validTransactionHash(value:unknown,network:BoltNetwork):value is string{
  return typeof value==="string" &&
    (network==="TRC20"?/^[a-fA-F0-9]{64}$/.test(value):/^0x[a-fA-F0-9]{64}$/.test(value));
}
export function equalAddress(a:string,b:string,network:BoltNetwork):boolean{
  return network==="TRC20"?a===b:a.toLowerCase()===b.toLowerCase();
}
export function quoteFromCnyFen(amountFen:number,cnyPerUsdtMicros:string):bigint{
  if(!Number.isSafeInteger(amountFen)||amountFen<=0||!/^[1-9][0-9]{5,8}$/.test(cnyPerUsdtMicros))
    throw new RangeError("unconfigured quote");
  const rate=BigInt(cnyPerUsdtMicros);
  const amount=(BigInt(amountFen)*10000n*USDT_ORDER_SCALE+rate-1n)/rate;
  if(amount<USDT_ORDER_SCALE||amount>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError("unsupported small payment");
  return amount;
}
export type VerifiedPayment={
  eventId:string; externalOrderId:string; network:BoltNetwork; txHash:string;
  address:string; amountMicros:bigint; paidMicros:bigint;
  status:"CONFIRMED"|"COMPLETED";
};
export function verifiedPayment(value:unknown):VerifiedPayment{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new RangeError("missing payment");
  const v=value as Record<string,unknown>;
  if(!["CONFIRMED","COMPLETED"].includes(String(v.status))||v.settlementType!=="EXACT"||
      v.currency!=="USDT"||v.manuallyAccepted===true)throw new RangeError("unverified settlement");
  const network=parseBoltNetwork(v.network);
  if(typeof v.externalOrderId!=="string"||!/^[A-Za-z0-9_-]{6,64}$/.test(v.externalOrderId)||
      !validTransactionHash(v.txHash,network)||!validReceivingAddress(v.destinationAddress,network))
    throw new RangeError("invalid payment identity");
  const amountMicros=decimalMicros(v.amount),paidMicros=decimalMicros(v.paidAmount);
  if(amountMicros===0n||paidMicros!==amountMicros||
      (v.shortfallAmount!=null&&decimalMicros(v.shortfallAmount)!==0n))
    throw new RangeError("exact payment mismatch");
  return {
    eventId:typeof v.eventId==="string"?v.eventId:"query",externalOrderId:v.externalOrderId,network,
    txHash:v.txHash.toLowerCase(),address:network==="TRC20"?v.destinationAddress:v.destinationAddress.toLowerCase(),
    amountMicros,paidMicros,status:v.status as VerifiedPayment["status"]
  };
}
export function distinctSettlement(a:VerifiedPayment,b:VerifiedPayment):boolean{
  return a.externalOrderId===b.externalOrderId&&a.network===b.network&&
    a.txHash===b.txHash&&equalAddress(a.address,b.address,a.network)&&
    a.amountMicros===b.amountMicros&&a.paidMicros===b.paidMicros;
}
