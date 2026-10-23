import type { Env } from './types';
import { epayCheckout } from './epay.js';
import { XiaodouClient } from './xiaodou.js';

export type PaymentChannel = 'ALIPAY_H5' | 'WECHAT_H5';
export type PaymentProvider = 'xiaodou' | 'xiaodou_epay';
export type PaymentMethod = { provider: PaymentProvider; channel: PaymentChannel };

const settingKeys = [
  'purchase_enabled','payment_rsa2_enabled','payment_epay_enabled',
  'payment_alipay_enabled','payment_wechat_enabled',
  'payment_alipay_released','payment_wechat_released',
] as const;

async function settings(env:Env):Promise<Record<string,string>> {
  const rows=await env.DB.prepare(`SELECT key,value FROM system_settings WHERE key IN (${settingKeys.map(()=>'?').join(',')})`).bind(...settingKeys).all<{key:string;value:string}>();
  return Object.fromEntries((rows.results??[]).map(row=>[row.key,row.value]));
}

export async function paymentProviderCredentialsConfigured(env:Env,provider:PaymentProvider):Promise<boolean> {
 try {
  if(provider==='xiaodou_epay') {
   if(!env.XIAODOU_EPAY_GATEWAY||!/^[0-9]{1,32}$/.test(env.XIAODOU_EPAY_PID??'')||!env.XIAODOU_EPAY_KEY?.trim())return false;
   epayCheckout({gateway:env.XIAODOU_EPAY_GATEWAY,pid:env.XIAODOU_EPAY_PID!,key:env.XIAODOU_EPAY_KEY,apiOrigin:env.API_ORIGIN,webOrigin:env.WEB_ORIGIN},{orderId:'00000000-0000-4000-8000-000000000000',outTradeNo:'configuration-check',amountFen:1,name:'configuration-check'});return true;
  }
  if(!env.XIAODOU_BASE_URL||!/^xdop_[A-Za-z0-9]{16}$/.test(env.XIAODOU_APP_ID??'')||!/^mkid_[0-9a-f]{16}$/.test(env.XIAODOU_KEY_ID??'')||!env.XIAODOU_PRIVATE_KEY||!env.XIAODOU_PLATFORM_PUBLIC_KEYS)return false;
  const keys=JSON.parse(env.XIAODOU_PLATFORM_PUBLIC_KEYS) as Record<string,string>;
  if(!keys||typeof keys!=='object'||Array.isArray(keys)||!Object.keys(keys).length)return false;
  const pemBytes=(pem:string,label:string)=>{if(typeof pem!=='string'||!pem.includes(`-----BEGIN ${label}-----`))throw new Error('Invalid key');return Uint8Array.from(atob(pem.replace(`-----BEGIN ${label}-----`,'').replace(`-----END ${label}-----`,'').replace(/\s/g,'')),c=>c.charCodeAt(0));};
  await crypto.subtle.importKey('pkcs8',pemBytes(env.XIAODOU_PRIVATE_KEY,'PRIVATE KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  for(const pem of Object.values(keys))await crypto.subtle.importKey('spki',pemBytes(pem,'PUBLIC KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  new XiaodouClient({baseUrl:env.XIAODOU_BASE_URL,ownApiOrigin:env.API_ORIGIN,appId:env.XIAODOU_APP_ID,keyId:env.XIAODOU_KEY_ID,privateKeyPem:env.XIAODOU_PRIVATE_KEY,platformPublicKeys:keys,environment:env.ENVIRONMENT});return true;
 }catch{return false;}
}

function enabled(value:string|undefined):boolean { return value==='1'; }

export async function paymentControl(env:Env){
 const values=await settings(env),environmentReady=env.PAYMENTS_ENABLED==='1',operatorEnabled=enabled(values.purchase_enabled);
 const [rsa2Credentials,epayCredentials]=await Promise.all([
  paymentProviderCredentialsConfigured(env,'xiaodou'),paymentProviderCredentialsConfigured(env,'xiaodou_epay'),
 ]);
 const providers={
  rsa2:{enabled:enabled(values.payment_rsa2_enabled),credentialsConfigured:rsa2Credentials},
  epay:{enabled:enabled(values.payment_epay_enabled),credentialsConfigured:epayCredentials},
 };
 const channels={
  alipay:{enabled:enabled(values.payment_alipay_enabled),platformReleased:enabled(values.payment_alipay_released)},
  wechat:{enabled:enabled(values.payment_wechat_enabled),platformReleased:enabled(values.payment_wechat_released)},
 };
 const canSell=environmentReady&&operatorEnabled;
 const methods:PaymentMethod[]=[];
 if(canSell&&providers.rsa2.enabled&&providers.rsa2.credentialsConfigured){
  // Prefer WeChat for new RSA2 checkouts while the Alipay path is being
  // investigated. The platform-release gate remains mandatory for both.
  if(channels.wechat.enabled&&channels.wechat.platformReleased)methods.push({provider:'xiaodou',channel:'WECHAT_H5'});
  if(channels.alipay.enabled&&channels.alipay.platformReleased)methods.push({provider:'xiaodou',channel:'ALIPAY_H5'});
 }
 // Channel release is a platform-level gate shared by both protocols. Epay
 // callbacks for historical orders remain independent and continue to verify.
 if(canSell&&providers.epay.enabled&&providers.epay.credentialsConfigured&&channels.alipay.enabled&&channels.alipay.platformReleased
   &&!methods.some(method=>method.channel==='ALIPAY_H5'))methods.push({provider:'xiaodou_epay',channel:'ALIPAY_H5'});
 const defaultMethod=methods.find(method=>method.provider==='xiaodou')??methods[0]??null;
 return {
  environmentReady,operatorEnabled,globalEffectiveEnabled:canSell,
  credentialsConfigured:defaultMethod?providers[defaultMethod.provider==='xiaodou'?'rsa2':'epay'].credentialsConfigured:false,
  effectiveEnabled:methods.length>0,
  providers,channels,methods,defaultMethod,
 };
}
