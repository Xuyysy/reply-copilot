// Checkout availability is separate from the conservative payment state.
export function checkoutOrderMessage(order, language) {
  const en = language === "en";
  if(order?.retryAvailable===true)return en ? "No payment link was issued. This local checkout has been released; you can return to plans and buy again. Any actual charge still needs provider verification." : "未生成有效付款链接，本地购买限制已自动解除。可返回套餐重新购买；如有实际扣款仍需核对。";
  if(order.paymentProtocol==='mk99'&&order.riskState==='manual_review')return en ? "Payment is under manual review. Do not continue paying." : "正在人工核对，请勿继续付款。";
  if(order.paymentProtocol==='epay'&&order.status==='pending')return en
    ? "Checkout form prepared. Continue to the Alipay cashier; payment is confirmed only after a verified notification."
    : "付款表单已准备，请前往支付宝收银台。只有经验证的异步通知才能确认到账。";
  if (!['paid', 'refunded', 'closed', 'failed'].includes(order.status) && order.checkout) {
    const messages = {
      rejected: ["支付平台拒绝生成付款链接。请保留订单联系支持，不要重复下单。", "The payment platform rejected checkout. Keep this order and contact support; do not place another order."],
      unknown: ["网络或响应结果不确定，未提供付款链接。请保留订单，勿重复购买。", "The request result is unconfirmed and no payment link is available. Keep this order; do not purchase again."],
      unavailable: ["付款链接暂不可用，请保留订单联系支持。", "The payment link is unavailable. Keep this order and contact support."],
      confirmation_required: ["平台返回付款结果，正在等待可信查单或通知确认，请勿再次付款。", "A payment result requires verified query or notification confirmation. Do not pay again."],
      ready: ["付款链接已生成，等待你在支付宝收银台付款。", "Payment link generated. Complete payment in the Alipay cashier."],
    };
    const pair = messages[order.checkout.outcome];
    if (pair) return pair[en ? 1 : 0];
  }
  if (order.paymentLinkUnavailable && order.status === "unknown") return en
    ? "Payment link could not be generated. The order remains unconfirmed. Do not pay or place another order; contact support."
    : "付款链接生成失败，订单状态仍待确认。请勿付款或重复下单，请联系支持核对。";
  const status = {
    pending: ["订单待支付，请完成支付宝付款。", "Order awaiting payment. Complete payment in the cashier."],
    paid: ["支付成功，额度已到账。", "Payment succeeded and credits are available."],
    failed: ["支付未成功，可返回套餐重新下单。", "Payment failed. Return to plans to try again."],
    closed: ["订单已关闭。", "The order is closed."],
    unknown: ["支付结果确认中，请勿重复下单，可稍后刷新。", "Payment status is being confirmed. Do not place another order; refresh later."],
  };
  return (status[order.status] || ["订单处理中。", "Order is processing."])[en ? 1 : 0];
}

// Non-2xx creation can still have a durable local order. Keep it in the UI
// so the customer cannot submit a second purchase after a rejected checkout.
export function checkoutOrderFromError(error) {
  const order=error?.order;
  // A released linkless first attempt must not latch the checkout page.
  if(order?.retryAvailable===true)return null;
  if (!order || typeof order !== 'object' || !/^[a-f0-9-]{36}$/i.test(order.id || '')
    || !['pending','unknown','paid','refunded'].includes(order.status)
    || !Number.isSafeInteger(order.amountFen) || order.amountFen < 1
    || !Number.isSafeInteger(order.credits) || order.credits < 1
    || !Number.isSafeInteger(order.baseAmountFen) || !Number.isSafeInteger(order.serviceFeeFen)
    || order.baseAmountFen + order.serviceFeeFen + (order.paymentProtocol==='mk99'&&Number.isSafeInteger(order.merchantPricing?.costCoverageFen)&&order.merchantPricing.costCoverageFen>=0?order.merchantPricing.costCoverageFen:0) !== order.amountFen || order.currency !== 'CNY') return null;
  return order;
}

// A query response never renews cashier materials. Retain only the link already
// verified during creation on this page, until a non-pending result or navigation.
export function canUseCashierLink(order) {
  return Boolean(order?.paymentUrl)&&order.status==='pending'
    &&(order.paymentProtocol!=='mk99'||order.riskState==='clear');
}

export function mergeCheckoutRead(current, next) {
  if(next.paymentProtocol==='mk99') {
    // Risk holds never auto-clear; an older in-flight read cannot restore a link.
    const held=current?.id===next.id&&current.paymentProtocol==='mk99'&&current.riskState==='manual_review';
    const result=held?{...next,riskState:'manual_review'}:next;
    return canUseCashierLink(result)?result:{...result,paymentUrl:null};
  }
  if(current?.id===next.id&&current.status==='pending'&&next.status==='pending'&&current.paymentProtocol==='epay'&&current.paymentForm&&!next.paymentForm)return {...next,paymentForm:current.paymentForm};
  if (current?.id === next.id && current.status === 'pending' && next.status === 'pending'
    && current.paymentUrl && !next.paymentUrl) return {...next,paymentUrl:current.paymentUrl};
  return next;
}
