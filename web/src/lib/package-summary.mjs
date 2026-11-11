// Public package prices come from the same API pricing projection as checkout.
// Prefer the exact payable CNY amount; never present legacy USD as the main price.
export function featuredPackages(packages) {
 if(!Array.isArray(packages))return [];
 const available=packages.filter(pkg=>(pkg.active===undefined||pkg.active===true||pkg.active===1)&&pkg.currency==='USD'&&Number.isSafeInteger(pkg.total_payment_fen)&&pkg.total_payment_fen>0);
 const featured=available.filter(pkg=>pkg.featured===true||pkg.featured===1);
 return (featured.length?featured:available).slice(0,3);
}
export function packageSummary(pkg,language) {
 const en=language==='en',credits=Number(pkg.credits),fee=Number(pkg.fee_rate_bps??150);
 const total=pkg.total_payment_fen;
 const priced=Number.isSafeInteger(total)&&total>0;
 const money=priced?'¥'+(total/100).toFixed(2):null;
 const merchant=pkg.merchant_pricing??pkg.merchantPricing;
 let feeText;
 if(merchant?.feeBearer==='merchant')feeText=en?'Payment processing costs are included in the displayed CNY price. No additional fee at checkout.':'人民币售价已包含支付渠道成本，收银台不再额外加收。';
 else if(fee===0)feeText=en?'Payment processing fees are paid by the merchant. No extra charge at checkout.':'支付手续费由商家承担，结账不额外收取。';
 else if(fee>0)feeText=en?`Buyer processing fee: ${(fee/100).toFixed(2)}%, included in the CNY total.`:`支付处理服务费率 ${(fee/100).toFixed(2)}%，由买家承担，已计入人民币实付总额。`;
 else feeText=en?'No additional payment handling fee.':'不另收支付处理服务费。';
 const cny=money?(en?`Final payment: ${money} CNY`:`人民币实付：${money} CNY`):'';
 return {
  name:String((en?pkg.name_en:pkg.name_zh)||''),
  badge:String((en?pkg.recommended_label_en:pkg.recommended_label_zh)||''),
  price:money??(en?'Price unavailable':'价格待配置'),
  credits:en?`${credits.toLocaleString()} AI generations`:`${credits.toLocaleString()} 次 AI 生成`,
  fee:feeText,cny
 };
}
export function renderFeaturedPackages(document,container,packages,language) {
 const selected=featuredPackages(packages);container.replaceChildren();container.hidden=selected.length===0;
 for(const pkg of selected){
  const summary=packageSummary(pkg,language),card=document.createElement('article');card.className='content-card package-highlight';
  for(const [tag,key] of [['p','badge'],['h3','name'],['strong','price'],['p','credits'],['p','cny'],['p','fee']]){
   if(!summary[key])continue;
   const element=document.createElement(tag);element.textContent=summary[key];if(key==='badge')element.className='package-badge';card.append(element);
  }
  const link=document.createElement('a');link.className='button secondary';link.href='/pricing#packages';link.textContent=language==='en'?'View packages':'查看套餐';card.append(link);container.append(card);
 }
}
