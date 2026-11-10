import type {Env} from './types';
import {ApiFailure} from './types';
import {XiaodouClient} from './xiaodou.js';

/** Server-only native RSA2; never falls back to Epay. */
export function createConfiguredXiaodouClient(env:Env):InstanceType<typeof XiaodouClient>{
 if(!env.XIAODOU_BASE_URL||!env.XIAODOU_APP_ID||!env.XIAODOU_KEY_ID||!env.XIAODOU_PRIVATE_KEY||!env.XIAODOU_PLATFORM_PUBLIC_KEYS)
  throw new ApiFailure(503,'PAYMENT_UNAVAILABLE','小豆 RSA2 尚未配置完成。');
 try{
  const keys=JSON.parse(env.XIAODOU_PLATFORM_PUBLIC_KEYS) as Record<string,string>;
  if(!keys||Array.isArray(keys)||typeof keys!=='object'||!Object.keys(keys).length)throw new Error('missing');
  return new XiaodouClient({baseUrl:env.XIAODOU_BASE_URL,ownApiOrigin:env.API_ORIGIN,
   appId:env.XIAODOU_APP_ID,keyId:env.XIAODOU_KEY_ID,privateKeyPem:env.XIAODOU_PRIVATE_KEY,
   platformPublicKeys:keys,environment:env.ENVIRONMENT});
 }catch{throw new ApiFailure(503,'PAYMENT_UNAVAILABLE','小豆 RSA2 凭据无效。');}
}

/** Require the exact verified HTTPS cashier origins from the merchant portal. */
export function validateXiaodouCashierUrl(url:string,env:Env):boolean{
 try{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||url.length>8192)return false;
  const origins=(env.XIAODOU_CASHIER_ORIGINS??'').split(',').map(x=>x.trim()).filter(Boolean);
  return origins.some(origin=>{try{const u=new URL(origin);return u.origin===origin&&u.protocol==='https:'&&u.origin===parsed.origin;}catch{return false;}});
 }catch{return false;}
}
