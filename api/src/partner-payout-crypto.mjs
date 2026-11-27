// Recipient details use a separate environment-specific key; never reuse auth or payment credentials.
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=b=>btoa(String.fromCharCode(...b));
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function payoutKeyValid(secret){try{return typeof secret==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(secret)&&from64(secret).length===32;}catch{return false;}}
async function key(secret){if(!payoutKeyValid(secret))throw Error('PAYOUT_KEY_UNAVAILABLE');return crypto.subtle.importKey('raw',from64(secret),'AES-GCM',false,['encrypt','decrypt']);}
const aad=(userId,version)=>enc.encode(JSON.stringify(['partner-alipay-v1',userId,version]));
export function normalizeRecipient(input){
 if(!input||typeof input!=='object'||typeof input.name!=='string'||typeof input.account!=='string')throw Error('PAYOUT_PROFILE_INVALID');
 const name=input.name.trim(),account=input.account.trim();
 if(name.length<2||name.length>80||account.length<3||account.length>160||/[\u0000-\u001f\u007f]/.test(name)||/\s|[\u0000-\u001f\u007f]/.test(account))throw Error('PAYOUT_PROFILE_INVALID');
 return {name,account};
}
export async function encryptRecipient(secret,userId,version,input){
 const value=normalizeRecipient(input),iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(userId,version),tagLength:128},await key(secret),enc.encode(JSON.stringify(value))));
 return b64(new Uint8Array([...iv,...bytes]));
}
export async function decryptRecipient(secret,userId,version,ciphertext){
 if(typeof ciphertext!=='string'||ciphertext.length>2048)throw Error('PAYOUT_PROFILE_INVALID');
 const bytes=from64(ciphertext);if(bytes.length<29)throw Error('PAYOUT_PROFILE_INVALID');
 return normalizeRecipient(JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:aad(userId,version),tagLength:128},await key(secret),bytes.slice(12)))));
}
export function maskRecipient(value){return {name:Array.from(value.name)[0]+'***',account:'***'+Array.from(value.account).slice(-3).join('')};}
