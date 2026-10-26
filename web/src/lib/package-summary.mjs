// Public package summaries use API prices in USD. No checkout action is performed here.
export function featuredPackages(packages) {
 return Array.isArray(packages)?packages.filter(pkg=>(pkg.featured===true||pkg.featured===1)&&(pkg.active===undefined||pkg.active===true||pkg.active===1)&&pkg.currency==='USD'):[];
}
export function packageSummary(pkg, language) {
 const en=language==='en',price=Number(pkg.promo_price_cents??pkg.price_cents),fee=Number(pkg.fee_rate_bps??150),credits=Number(pkg.credits);
 const merchant=pkg.merchant_pricing??pkg.merchantPricing;
 let feeText;
 if(merchant?.feeBearer==='merchant')feeText=en?'Payment processing costs are included in the displayed CNY price. No additional fee at checkout.':'人民币售价已包含支付渠道成本，收银台不再额外加收。';
 else if(fee>0)feeText=en?`Buyer processing fee: ${(fee/100).toFixed(2)}%, included in the CNY total.`:`支付处理服务费率 ${(fee/100).toFixed(2)}%，由买家承担，已计入人民币实付总额。`;
 else feeText=en?'No additional payment handling fee.':'不另收支付处理服务费。';
 const total=Number(pkg.total_payment_fen);
 const cny=Number.isSafeInteger(total)&&total>0?(en?`Final payment: ¥${(total/100).toFixed(2)} CNY`:`人民币实付：¥${(total/100).toFixed(2)} CNY`):'';
 return {name:String((en?pkg.name_en:pkg.name_zh)||''),badge:String((en?pkg.recommended_label_en:pkg.recommended_label_zh)||''),price:'$'+(price/100).toFixed(2),credits:en?`${credits.toLocaleString()} AI generations`:`${credits.toLocaleString()} 次 AI 生成`,fee:feeText,cny};
}
export function renderFeaturedPackages(document, container, packages, language) {
 const selected=featuredPackages(packages);container.replaceChildren();container.hidden=selected.length===0;
 for(const pkg of selected){const summary=packageSummary(pkg,language),card=document.createElement('article');card.className='content-card package-highlight';
 for(const [tag,key]of [['p','badge'],['h3','name'],['strong','price'],['p','credits'],['p','cny'],['p','fee']]){if(!summary[key])continue;const element=document.createElement(tag);element.textContent=summary[key];if(key==='badge')element.className='package-badge';card.append(element);}
 const link=document.createElement('a');link.className='button secondary';link.href='/pricing';link.textContent=language==='en'?'View packages':'查看套餐';card.append(link);container.append(card);}
}
