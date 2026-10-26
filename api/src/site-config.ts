import {ApiFailure} from './types';
export const CONTENT_KEYS=['xProfileUrl','chromeStoreUrl','supportEmail','announcementZh','announcementEn','homeTitleZh','homeTitleEn','homeBodyZh','homeBodyEn','guideZh','guideEn','faqZh','faqEn',...['checkoutPaymentTitle','checkoutPaymentNote','checkoutPayButton','homeSubtitle','homeCta','homeSecondaryCta','feature1Title','feature1Body','feature2Title','feature2Body','feature3Title','feature3Body','packageTitle','packageBody','guideTitle','guideCta','footerText','maintenance'].flatMap(key=>[key+'Zh',key+'En']),'homeCtaHref','homeSecondaryCtaHref'] as const;
export const NAV_IDS=['x','install','guide','pricing','faq'] as const;
export type NavigationItem={id:string;labelZh:string;labelEn:string;href:string;visible:boolean;sortOrder:number};
export const DEFAULT_NAVIGATION:NavigationItem[]=[['x','我的 X','My X',''],['install','安装插件','Install',''],['guide','使用指南','Guide','/guide'],['pricing','价格','Pricing','/pricing'],['faq','常见问题','FAQ','/faq']].map(([id,labelZh,labelEn,href],sortOrder)=>({id,labelZh,labelEn,href,visible:true,sortOrder}));
export function safeContentHref(value:string,kind='internal'):boolean{
 if(!value)return true;
 if(kind==='cta')return ['/login','/login?mode=register','/login?mode=login','/account'].includes(value)||safeContentHref(value,'internal');
 if(kind==='internal')return ['/','/guide','/pricing','/faq','/privacy','/terms','/refunds','/feedback'].includes(value);
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&(kind==='x'?['x.com','www.x.com'].includes(url.hostname)&&/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname):url.hostname==='chromewebstore.google.com'&&/^\/detail\/(?:[^/]+\/)?[a-p]{32}\/?$/.test(url.pathname));}catch{return false;}
}
export function validateContent(value:unknown):Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiFailure(400,'INVALID_CONTENT','内容格式无效。');
 const source=value as Record<string,unknown>,result:Record<string,any>={};
 for(const key of CONTENT_KEYS){const item=source[key]??'';if(typeof item!=='string'||item.length>6000)throw new ApiFailure(400,'INVALID_CONTENT','内容过长或格式无效。');result[key]=item.trim();}
 for(const locale of ['Zh','En'])if(result['checkoutPayButton'+locale].length>120)throw new ApiFailure(400,'INVALID_CONTENT','付款按钮文字最多120字。');
 for(const [key,kind] of [['xProfileUrl','x'],['chromeStoreUrl','install'],['homeCtaHref','cta'],['homeSecondaryCtaHref','internal']])if(!safeContentHref(result[key],kind))throw new ApiFailure(400,'INVALID_URL','请输入允许的站内地址或官方 HTTPS 链接。');
 if(result.supportEmail&&!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(result.supportEmail))throw new ApiFailure(400,'INVALID_CONTENT','客服邮箱格式无效。');
 if(source.navigation!==undefined){if(!Array.isArray(source.navigation)||source.navigation.length!==NAV_IDS.length)throw new ApiFailure(400,'INVALID_CONTENT','导航必须包含五个固定项目。');const seen=new Set();result.navigation=source.navigation.map((item:any)=>{if(!item||!NAV_IDS.includes(item.id)||seen.has(item.id)||typeof item.visible!=='boolean'||!Number.isInteger(item.sortOrder)||item.sortOrder<0||item.sortOrder>99||typeof item.labelZh!=='string'||typeof item.labelEn!=='string'||item.labelZh.length>80||item.labelEn.length>80||typeof item.href!=='string'||!safeContentHref(item.href,item.id==='x'?'x':item.id==='install'?'install':'internal'))throw new ApiFailure(400,'INVALID_CONTENT','导航标签、地址或顺序无效。');seen.add(item.id);return {id:item.id,labelZh:item.labelZh.trim(),labelEn:item.labelEn.trim(),href:item.href,visible:item.visible,sortOrder:item.sortOrder};});}
 return result;
}
