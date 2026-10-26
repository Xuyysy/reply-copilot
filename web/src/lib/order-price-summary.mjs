function cny(fen) {
 return `¥${(fen/100).toFixed(2)}`;
}

// MK99's pricing-cost coverage is part of the listed price, not the legacy service-fee field.
export function orderPriceSummary(order, language) {
 const en=language==='en';
 if(order?.provider==='mk99'){
  const total=order.total_amount_fen;
  if(!Number.isSafeInteger(total)||total<=0)return en?'Paid CNY total unavailable':'人民币实付金额暂不可用';
  return en?`Paid in CNY: ${cny(total)}`:`人民币实付：${cny(total)}`;
 }
 const base=Number(order?.base_amount_fen)||0,fee=Number(order?.service_fee_fen)||0;
 return en?`Principal: ${cny(base)} · Fee: ${cny(fee)}`:`套餐本金：${cny(base)} · 服务费：${cny(fee)}`;
}
