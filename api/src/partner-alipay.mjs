// Alipay receiving metadata only; no payment API or credential handling.
const enc=new TextEncoder();
const dec=new TextDecoder("utf-8",{fatal:true});
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,"0")).join("");
const unhex=s=>Uint8Array.from(s.match(/../g)||[],n=>parseInt(n,16));
const validHex=(s,n)=>typeof s==="string"&&s.length===n&&/^[a-f0-9]+$/i.test(s);
const validId=s=>typeof s==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(s);
const validVersion=n=>Number.isSafeInteger(n)&&n>0;
const fail=()=>{throw new TypeError("PARTNER_ALIPAY_INVALID");};
export function parseAlipayRecipient(value){
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==2||
 !Object.hasOwn(value,"account")||!Object.hasOwn(value,"name")||
 typeof value.account!=="string"||typeof value.name!=="string")fail();
 const account=value.account.trim(),name=value.name.trim();
 // Candidate scope: mainland mobile number or email; not a provider-side
 // assertion that the account exists or that its holder name is verified.
 if(account.length>120||!(/^(?:\+86)?1[3-9][0-9]{9}$/.test(account)||/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(account)))fail();
 if([...name].length<2||[...name].length>60||!/^[\p{L}\p{M} .·'’-]+$/u.test(name)||! /\p{L}/u.test(name))fail();
 return {account,name};
}
function context({environment,userId,version,keyId}){
 if(!["development","staging","production"].includes(environment)||!validId(userId)||!validVersion(version)||
 typeof keyId!=="string"||!/^[A-Za-z0-9_-]{1,40}$/.test(keyId))fail();
 return enc.encode(JSON.stringify(["partner-alipay-recipient-v1",environment,userId,version,keyId]));
}
async function key(raw,usage){
 if(!validHex(raw,64))fail();
 return crypto.subtle.importKey("raw",unhex(raw),"AES-GCM",false,[usage]);
}
export async function sealAlipayRecipient(recipient,ctx,secret){
 const parsed=parseAlipayRecipient(recipient),aad=context(ctx);
 const nonce=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:aad,tagLength:128},await key(secret,"encrypt"),enc.encode(JSON.stringify(parsed)));
 const accountMask=parsed.account.includes("@")?parsed.account[0]+"***@***":parsed.account.slice(-11,-8)+"****"+parsed.account.slice(-4);
 return {keyId:ctx.keyId,nonceHex:hex(nonce),ciphertextHex:hex(ciphertext),accountMask,nameMask:[...parsed.name][0]+"**"};
}
// Only a separately audited, reauthenticated admin reveal may call this later.
export async function openAlipayRecipient(sealed,ctx,secret){
 if(!sealed||sealed.keyId!==ctx.keyId||!validHex(sealed.nonceHex,24)||
 typeof sealed.ciphertextHex!=="string"||sealed.ciphertextHex.length<32||sealed.ciphertextHex.length>4096||
 sealed.ciphertextHex.length%2!==0||! /^[a-f0-9]+$/i.test(sealed.ciphertextHex))fail();
 const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:unhex(sealed.nonceHex),additionalData:context(ctx),tagLength:128},await key(secret,"decrypt"),unhex(sealed.ciphertextHex));
 return parseAlipayRecipient(JSON.parse(dec.decode(plaintext)));
}
export function recipientAppendPlan({userId,expectedVersion,now,sealed}){
 if(!validId(userId)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>=Number.MAX_SAFE_INTEGER||
 !validVersion(now)||!sealed)fail();
 return {sql:`INSERT INTO partner_alipay_recipients
 (user_id,version,key_id,nonce_hex,ciphertext_hex,account_mask,name_mask,created_at)
 SELECT u.id,?,?,?,?,?,?,? FROM users u WHERE u.id=?
 AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_program_enabled' AND value='1')
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_alipay_recipient_enabled' AND value='1')
 AND (SELECT status FROM partner_policy_versions WHERE user_id=u.id AND effective_at<=? ORDER BY version DESC LIMIT 1)='active'
 AND COALESCE((SELECT MAX(version) FROM partner_alipay_recipients WHERE user_id=u.id),0)=?
 ON CONFLICT(user_id,version) DO NOTHING`,
 params:[expectedVersion+1,sealed.keyId,sealed.nonceHex,sealed.ciphertextHex,sealed.accountMask,sealed.nameMask,now,userId,now,expectedVersion]};
}
// Future reserve path MUST include this in its atomic batch, using the exact
// recipient version explicitly selected by the applicant and checked by admin.
export function alipayDestinationPlan({payoutId,userId,version}){
 if(!validId(payoutId)||!validId(userId)||!validVersion(version))fail();
 return {sql:"INSERT INTO partner_alipay_payout_destinations(payout_id,user_id,recipient_version) VALUES(?,?,?)",
 params:[payoutId,userId,version]};
}
