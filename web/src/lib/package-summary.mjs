// Public package summaries use API prices in USD. No checkout action is performed here.
export function featuredPackages(packages) {
 return Array.isArray(packages)?packages.filter(pkg=>(pkg.featured===true||pkg.featured===1)&&(pkg.active===undefined||pkg.active===true||pkg.active===1)&&pkg.currency==='USD'):[];
}
export function packageSummary(pkg, language) {
 const en=language==='en',price=Number(pkg.promo_price_cents??pkg.price_cents),fee=Number(pkg.fee_rate_bps??150),credits=Number(pkg.credits);
 return {name:String((en?pkg.name_en:pkg.name_zh)||''),badge:String((en?pkg.recommended_label_en:pkg.recommended_label_zh)||''),price:'$'+(price/100).toFixed(2),credits:en?`${credits.toLocaleString()} AI generations`:`${credits.toLocaleString()} 次 AI 生成`,fee:en?`Plus ${(fee/100).toFixed(2)}% payment handling fee`:`另加 ${(fee/100).toFixed(2)}% 支付处理服务费`};
}
export function renderFeaturedPackages(document, container, packages, language) {
 const selected=featuredPackages(packages);container.replaceChildren();container.hidden=selected.length===0;
 for(const pkg of selected){const summary=packageSummary(pkg,language),card=document.createElement('article');card.className='content-card package-highlight';
 for(const [tag,key]of [['p','badge'],['h3','name'],['strong','price'],['p','credits'],['p','fee']]){if(!summary[key])continue;const element=document.createElement(tag);element.textContent=summary[key];if(key==='badge')element.className='package-badge';card.append(element);}
 const link=document.createElement('a');link.className='button secondary';link.href='/pricing';link.textContent=language==='en'?'View packages':'查看套餐';card.append(link);container.append(card);}
}
