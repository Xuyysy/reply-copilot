import {validPaymentOrderId} from './payment-resume.mjs';

/**
 * Discover existing checkout by authenticated account history. The server is
 * authoritative: consumer must GET the original order before showing cashier.
 * This NEVER creates/restarts a payment or assumes unknown=unpaid.
 */
export function findUnresolvedCreditOrder(activity,{packageId,provider,channel}){
 if(typeof packageId!=='string'||!packageId||!provider||!channel)return null;
 const expectedProtocol=provider==='mk99'?'mk99':provider==='xiaodou_epay'?'epay':provider==='xiaodou'?'rsa2':null;
 if(!expectedProtocol||!Array.isArray(activity?.orders))return null;
 const matches=activity.orders.filter(x=>x&&validPaymentOrderId(x.id)&&x.package_id===packageId
  &&x.status==='awaiting_payment'&&['pending','unknown'].includes(x.payment_status)
  &&x.payment_protocol===expectedProtocol
  &&x.payment_channel===channel&&x.provider===(provider==='xiaodou_epay'?'xiaodou':provider));
 matches.sort((a,b)=>(b.created_at||0)-(a.created_at||0));
 return matches[0]||null;
}

export async function lookupUnresolvedCreditOrder({packageId,provider,channel,request}){
 const activity=await request('/v1/activity',{method:'GET'});
 return findUnresolvedCreditOrder(activity,{packageId,provider,channel});
}
