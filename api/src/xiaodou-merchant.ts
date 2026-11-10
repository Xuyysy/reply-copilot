import type { Env } from './types';
import { XiaodouClient } from './xiaodou.js';
/** Reused RSA2 client. No secret or signing material leaves the Worker. */
export function configuredXiaodouMerchant(env:Env):InstanceType<typeof XiaodouClient>{
 if(!env.XIAODOU_BASE_URL||!env.XIAODOU_APP_ID||!env.XIAODOU_KEY_ID||!env.XIAODOU_PRIVATE_KEY||!env.XIAODOU_PLATFORM_PUBLIC_KEYS)
   throw new Error('XIAODOU_CONFIG_UNAVAILABLE');
 const keys=JSON.parse(env.XIAODOU_PLATFORM_PUBLIC_KEYS) as Record<string,string>;
 if(!keys||typeof keys!=='object'||Array.isArray(keys)||Object.keys(keys).length===0)
   throw new Error('XIAODOU_CONFIG_UNAVAILABLE');
 return new XiaodouClient({baseUrl:env.XIAODOU_BASE_URL,ownApiOrigin:env.API_ORIGIN,appId:env.XIAODOU_APP_ID,keyId:env.XIAODOU_KEY_ID,
   privateKeyPem:env.XIAODOU_PRIVATE_KEY,platformPublicKeys:keys,environment:env.ENVIRONMENT});
}
