import type {Env} from "./types";
import {discoverPartnerPage,repairPartnerPage} from "./partner-discovery";

// Optional isolated pilot. Never run in production. No automatic commission
// accrual or money movement; only discover candidate jobs for manual review.
// No extra DB calls when the runtime binding is absent.
export async function scheduledPartnerDiscovery(env:Env,now:number):Promise<void>{
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_DISCOVERY_ENABLED!=='1'||env.PARTNER_SCHEDULED_DISCOVERY_ENABLED!=='1')return;
 try{
  const flag=await env.DB.prepare("SELECT value FROM system_settings WHERE key='partner_scheduled_discovery_enabled'").first<{value:string}>();
  if(flag?.value!=='1')return;
  // Process at most five new + five missed candidates per order domain.
  // Seven days is a technical pilot lookback, NOT the commission hold period.
  for(const domain of ['recharge','subscription']){
   try{
    await discoverPartnerPage(env,domain,now,5,true);
    await repairPartnerPage(env,domain,now,Math.max(0,now-7*86400000));
   }catch{
    // Never log buyer identifiers, order details, or payment information.
    console.warn("PARTNER_DISCOVERY_PILOT_DOMAIN_FAILED");
   }
  }
 }catch{console.warn("PARTNER_DISCOVERY_PILOT_FAILED");}
}
