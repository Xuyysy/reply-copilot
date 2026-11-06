// The caller must first verify ownership, payable state and the server's cashier origin.
// Follow the exact verified URL with the same native link privacy attributes used
// before Issue 18. This does not establish merchant/domain or gateway approval.
/**
 * @param {string} href
 * @param {{allowedOrigin?: string, document?: Document}} [options]
 */
export function navigateVerifiedCashier(href,{allowedOrigin,document=globalThis.document}={}){
 const url=new URL(href),origin=new URL(allowedOrigin);
 if(typeof href!=='string'||/[\\\u0000-\u0020\u007f]/.test(href)||url.protocol!=='https:'||url.username||url.password||url.port||url.hash
  ||origin.protocol!=='https:'||origin.origin!==allowedOrigin||origin.username||origin.password||origin.port||url.origin!==origin.origin)throw new Error('UNSAFE_CASHIER_URL');
 const link=document.createElement('a');link.href=href;link.target='_self';link.rel='noopener noreferrer';
 document.body.append(link);
 try{link.click();}finally{link.remove();}
}
