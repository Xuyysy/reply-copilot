import {mk99Readiness} from './mk99';
import type { Env } from './types';
import { epayCheckout } from './epay.js';
import { XiaodouClient } from './xiaodou.js';
import {validateXiaodouCashierUrl} from './xiaodou-client';

export type PaymentChannel = 'ALIPAY_H5' | 'WECHAT_H5';
export type PaymentProvider = 'xiaodou' | 'xiaodou_epay' | 'mk99';
export type PaymentMethod = { provider: PaymentProvider; channel: PaymentChannel };

const settingKeys = [
  'active_merchant','payment_mk99_enabled','payment_mk99_alipay_enabled','payment_mk99_wechat_enabled','payment_mk99_alipay_released','payment_mk99_wechat_released',
  'purchase_enabled','payment_rsa2_enabled','payment_epay_enabled',
  'payment_rsa2_alipay_enabled','payment_rsa2_wechat_enabled','payment_epay_alipay_enabled',
  'payment_rsa2_alipay_released','payment_rsa2_wechat_released','payment_epay_alipay_released',
  // Legacy operation switches remain compatible. The shared Alipay release
  // cannot establish approval for a specific provider and is never inherited.
  'payment_alipay_enabled','payment_wechat_enabled','payment_wechat_released',
] as const;

async function settings(env:Env):Promise<Record<string,string>> {
  const rows=await env.DB.prepare(`SELECT key,value FROM system_settings WHERE key IN (${settingKeys.map(()=>'?').join(',')})`).bind(...settingKeys).all<{key:string;value:string}>();
  return Object.fromEntries((rows.results??[]).map(row=>[row.key,row.value]));
}

export async function paymentProviderCredentialsConfigured(env:Env,provider:PaymentProvider):Promise<boolean> {
 try {
  if(provider==='mk99')return (await mk99Readiness(env)).credentialsConfigured;
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
 const mk99=await mk99Readiness(env);
 const rsa2CashierOriginsConfigured=Array.isArray(env.XIAODOU_CASHIER_ORIGINS?.split(','))&&
   env.XIAODOU_CASHIER_ORIGINS!.split(',').some(host=>validateXiaodouCashierUrl(host.trim()+'/checkout',env));
 const activeMerchant=['xiaodou','mk99','none'].includes(values.active_merchant??'xiaodou')?(values.active_merchant??'xiaodou'):'none';
 const mk99Channels={alipay:{enabled:enabled(values.payment_mk99_alipay_enabled),platformReleased:enabled(values.payment_mk99_alipay_released)},wechat:{enabled:enabled(values.payment_mk99_wechat_enabled),platformReleased:enabled(values.payment_mk99_wechat_released)}};
 const providers={
  mk99:{enabled:enabled(values.payment_mk99_enabled),...mk99},
  rsa2:{enabled:enabled(values.payment_rsa2_enabled),credentialsConfigured:rsa2Credentials,cashierOriginsConfigured:rsa2CashierOriginsConfigured},
  epay:{enabled:enabled(values.payment_epay_enabled),credentialsConfigured:epayCredentials},
 };
 const rsa2Channels={
  alipay:{enabled:enabled(values.payment_rsa2_alipay_enabled??values.payment_alipay_enabled),platformReleased:enabled(values.payment_rsa2_alipay_released)},
  wechat:{enabled:enabled(values.payment_rsa2_wechat_enabled??values.payment_wechat_enabled),platformReleased:enabled(values.payment_rsa2_wechat_released??values.payment_wechat_released)},
 };
 const epayChannels={
  alipay:{enabled:enabled(values.payment_epay_alipay_enabled??values.payment_alipay_enabled),platformReleased:enabled(values.payment_epay_alipay_released)},
 };
 const canSell=environmentReady&&operatorEnabled;
 const methods:PaymentMethod[]=[];
 if(canSell&&activeMerchant==='xiaodou'&&providers.rsa2.enabled&&providers.rsa2.credentialsConfigured&&rsa2CashierOriginsConfigured){
  // Alipay first. WeChat remains gated until this merchant is approved.
  if(rsa2Channels.alipay.enabled&&rsa2Channels.alipay.platformReleased)methods.push({provider:'xiaodou',channel:'ALIPAY_H5'});
  if(rsa2Channels.wechat.enabled&&rsa2Channels.wechat.platformReleased)methods.push({provider:'xiaodou',channel:'WECHAT_H5'});
 }
 // RSA2 is the only real new-sale Xiaodou protocol. Historical Epay
 // sign/notification tests retain a synthetic checkout mode for NON-DEPLOYABLE
 // fixture URL only. An ordinary staging/prod Worker can never satisfy the
 // exact test hostname + private in-process fixture flag. Remove this test
 // adapter after the historical test suite is converted to seeded transactions.
 const legacyEpayFixture=(env as Env&{__TEST_LEGACY_EPAY_NEW_SALES?:string}).__TEST_LEGACY_EPAY_NEW_SALES==='1'
   &&env.ENVIRONMENT==='staging'&&env.API_ORIGIN==='https://api-staging.example.test';
 if(legacyEpayFixture&&canSell&&activeMerchant==='xiaodou'&&providers.epay.enabled
    &&providers.epay.credentialsConfigured&&epayChannels.alipay.enabled
    &&epayChannels.alipay.platformReleased
    &&!methods.some(method=>method.channel==='ALIPAY_H5'))
   methods.push({provider:'xiaodou_epay',channel:'ALIPAY_H5'});
 if(canSell&&activeMerchant==='mk99'&&providers.mk99.enabled&&mk99.credentialsConfigured&&mk99.protocolConfirmed&&mk99.amountContractConfirmed){
  if(mk99Channels.wechat.enabled&&mk99Channels.wechat.platformReleased)methods.push({provider:'mk99',channel:'WECHAT_H5'});
  if(mk99Channels.alipay.enabled&&mk99Channels.alipay.platformReleased)methods.push({provider:'mk99',channel:'ALIPAY_H5'});
 }
 const defaultMethod=methods.find(method=>method.provider==='xiaodou')??methods[0]??null;
 const gateReasons=(provider:PaymentProvider,channel:'alipay'|'wechat')=>{
  const providerState=providers[provider==='mk99'?'mk99':provider==='xiaodou'?'rsa2':'epay'],channelState=provider==='mk99'?mk99Channels[channel]:provider==='xiaodou'?rsa2Channels[channel]:channel==='alipay'?epayChannels.alipay:null;
  const reasons:string[]=[];
  if(activeMerchant!==(provider==='mk99'?'mk99':'xiaodou'))reasons.push('merchant_not_selected');
  if(provider==='mk99'&&!mk99.protocolConfirmed)reasons.push('protocol_unconfirmed');
  if(provider==='mk99'&&!mk99.amountContractConfirmed)reasons.push('amount_contract_unconfirmed');
  if(!environmentReady)reasons.push('environment_protection');
  if(!operatorEnabled)reasons.push('purchase_paused');
  if(!providerState.enabled)reasons.push('interface_disabled');
  if(!providerState.credentialsConfigured)reasons.push('credentials_missing');
  if(provider==='xiaodou'&&!rsa2CashierOriginsConfigured)reasons.push('cashier_origin_unconfigured');
  if(!channelState)reasons.push('channel_not_supported');
  else{
   if(!channelState.enabled)reasons.push('channel_disabled');
   if(!channelState.platformReleased)reasons.push('platform_release_unconfirmed');
  }
  return {enabled:channelState?.enabled??false,platformReleased:channelState?.platformReleased??false,available:methods.some(method=>method.provider===provider&&method.channel===(channel==='wechat'?'WECHAT_H5':'ALIPAY_H5')),reasons};
 };
 const channels={
  rsa2:rsa2Channels,epay:epayChannels,mk99:mk99Channels,
  // Compatibility aliases for older dashboard code; they reflect RSA2 only.
  alipay:rsa2Channels.alipay,wechat:rsa2Channels.wechat,
 };
 return {
  activeMerchant,environmentReady,operatorEnabled,globalEffectiveEnabled:canSell,
  credentialsConfigured:defaultMethod?providers[defaultMethod.provider==='mk99'?'mk99':defaultMethod.provider==='xiaodou'?'rsa2':'epay'].credentialsConfigured:false,
  effectiveEnabled:methods.length>0,
  providers,channels,availability:{mk99:{alipay:gateReasons('mk99','alipay'),wechat:gateReasons('mk99','wechat')},rsa2:{alipay:gateReasons('xiaodou','alipay'),wechat:gateReasons('xiaodou','wechat')},epay:{alipay:gateReasons('xiaodou_epay','alipay')}},methods,defaultMethod,
 };
}
