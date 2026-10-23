import type { Env } from './types';
import { epayCheckout } from './epay.js';
import { XiaodouClient } from './xiaodou.js';

export type PaymentChannel = 'ALIPAY_H5' | 'WECHAT_H5';
export type PaymentProvider = 'xiaodou' | 'xiaodou_epay';
export type PaymentMethod = { provider: PaymentProvider; channel: PaymentChannel };

const settingKeys = [
  'purchase_enabled','payment_rsa2_enabled','payment_epay_enabled',
  'payment_rsa2_alipay_enabled','payment_rsa2_wechat_enabled','payment_epay_alipay_enabled',
  'payment_rsa2_alipay_released','payment_rsa2_wechat_released','payment_epay_alipay_released',
  // Read legacy values during the migration window for older clients and
  // databases that have not yet applied 0014.
  'payment_alipay_enabled','payment_wechat_enabled','payment_alipay_released','payment_wechat_released',
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
 const rsa2Channels={
  alipay:{enabled:enabled(values.payment_rsa2_alipay_enabled??values.payment_alipay_enabled),platformReleased:enabled(values.payment_rsa2_alipay_released??values.payment_alipay_released)},
  wechat:{enabled:enabled(values.payment_rsa2_wechat_enabled??values.payment_wechat_enabled),platformReleased:enabled(values.payment_rsa2_wechat_released??values.payment_wechat_released)},
 };
 const epayChannels={
  alipay:{enabled:enabled(values.payment_epay_alipay_enabled??values.payment_alipay_enabled),platformReleased:enabled(values.payment_epay_alipay_released??values.payment_alipay_released)},
 };
 const canSell=environmentReady&&operatorEnabled;
 const methods:PaymentMethod[]=[];
 if(canSell&&providers.rsa2.enabled&&providers.rsa2.credentialsConfigured){
  // Prefer WeChat for new RSA2 checkouts while the Alipay path is being
  // investigated. The platform-release gate remains mandatory for both.
  if(rsa2Channels.wechat.enabled&&rsa2Channels.wechat.platformReleased)methods.push({provider:'xiaodou',channel:'WECHAT_H5'});
  if(rsa2Channels.alipay.enabled&&rsa2Channels.alipay.platformReleased)methods.push({provider:'xiaodou',channel:'ALIPAY_H5'});
 }
 // Epay has its own Alipay controls and release confirmation. RSA2 and Epay
 // never borrow each other's release state. If RSA2 Alipay is ready it wins;
 // Epay is only the separately configured fallback when its own gates pass.
 if(canSell&&providers.epay.enabled&&providers.epay.credentialsConfigured&&epayChannels.alipay.enabled&&epayChannels.alipay.platformReleased
   &&!methods.some(method=>method.channel==='ALIPAY_H5'))methods.push({provider:'xiaodou_epay',channel:'ALIPAY_H5'});
 const defaultMethod=methods.find(method=>method.provider==='xiaodou')??methods[0]??null;
 const gateReasons=(provider:PaymentProvider,channel:'alipay'|'wechat')=>{
  const providerState=providers[provider==='xiaodou'?'rsa2':'epay'],channelState=provider==='xiaodou'?rsa2Channels[channel]:channel==='alipay'?epayChannels.alipay:null;
  const reasons:string[]=[];
  if(!environmentReady)reasons.push('environment_protection');
  if(!operatorEnabled)reasons.push('purchase_paused');
  if(!providerState.enabled)reasons.push('interface_disabled');
  if(!providerState.credentialsConfigured)reasons.push('credentials_missing');
  if(!channelState)reasons.push('channel_not_supported');
  else{
   if(!channelState.enabled)reasons.push('channel_disabled');
   if(!channelState.platformReleased)reasons.push('platform_release_unconfirmed');
  }
  return {enabled:channelState?.enabled??false,platformReleased:channelState?.platformReleased??false,available:methods.some(method=>method.provider===provider&&method.channel===(channel==='wechat'?'WECHAT_H5':'ALIPAY_H5')),reasons};
 };
 const channels={
  rsa2:rsa2Channels,epay:epayChannels,
  // Compatibility aliases for older dashboard code; they reflect RSA2 only.
  alipay:rsa2Channels.alipay,wechat:rsa2Channels.wechat,
 };
 return {
  environmentReady,operatorEnabled,globalEffectiveEnabled:canSell,
  credentialsConfigured:defaultMethod?providers[defaultMethod.provider==='xiaodou'?'rsa2':'epay'].credentialsConfigured:false,
  effectiveEnabled:methods.length>0,
  providers,channels,availability:{rsa2:{alipay:gateReasons('xiaodou','alipay'),wechat:gateReasons('xiaodou','wechat')},epay:{alipay:gateReasons('xiaodou_epay','alipay')}},methods,defaultMethod,
 };
}
