import type {Env} from './types';
import {ApiFailure} from './types';
import {requireAdminSession} from './admin-auth';
import {sessionFor,requireCsrf,takeRate} from './auth';
import {operation,commitOperation} from './admin-operations';
import {hashPassword,verifyPassword} from './password-auth';
import {jsonBody,nowMs} from './security';
import {response} from './http';
import {paymentControl} from './payment-policy';
import {xiaodouNetworkReady} from './xiaodou-merchant';
import {XiaodouClient,XiaodouProviderError,safeProviderResponseDiagnostic} from './xiaodou.js';

export async function adminPaymentControl(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);return response(await paymentControl(env),200,env,request);
}
export async function adminPaymentPlatformCheck(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env,true);
 const requestId=`xrh-s-${crypto.randomUUID()}`;
 let client:InstanceType<typeof XiaodouClient>;
 try{
  if(!env.XIAODOU_BASE_URL||!env.XIAODOU_APP_ID||!env.XIAODOU_KEY_ID||!env.XIAODOU_PRIVATE_KEY||!env.XIAODOU_PLATFORM_PUBLIC_KEYS)throw new Error('missing');
  const keys=JSON.parse(env.XIAODOU_PLATFORM_PUBLIC_KEYS) as Record<string,string>;
  client=new XiaodouClient({baseUrl:env.XIAODOU_BASE_URL,ownApiOrigin:env.API_ORIGIN,appId:env.XIAODOU_APP_ID,keyId:env.XIAODOU_KEY_ID,privateKeyPem:env.XIAODOU_PRIVATE_KEY,platformPublicKeys:keys,environment:env.ENVIRONMENT});
 }catch{return response({ok:false,requestId,errorCode:'PROVIDER_CONFIG_ERROR'},503,env,request);}
 try{
  await client.getSettlementAccounts({requestId});
  // The platform response contains merchant settlement-account details. Never
  // return or log its body; a successful result means the response signature
  // passed the existing RSA2 verifier.
  return response({ok:true,requestId,upstreamHttpStatus:200,responseSignature:'verified',operation:'read_only_settlement_accounts'},200,env,request);
 }catch(error){
  if(error instanceof XiaodouProviderError){
   const diagnostic=safeProviderResponseDiagnostic(error.responseDiagnostic,error.upstreamHttpStatus);
   return response({ok:false,requestId,errorCode:/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'PROVIDER_ERROR',stage:error.stage,upstreamHttpStatus:error.upstreamHttpStatus??null,...(diagnostic?{providerResponse:diagnostic}:{})},error.upstreamHttpStatus?502:503,env,request);
  }
  return response({ok:false,requestId,errorCode:'PROVIDER_ERROR'},503,env,request);
 }
}
export async function updateAdminPaymentControl(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,2048);
 const before=await paymentControl(env),now=nowMs();
 if(body.merchantSettings!==undefined){
  const input=body.merchantSettings as Record<string,unknown>,fields={enabled:'payment_mk99_enabled',alipayEnabled:'payment_mk99_alipay_enabled',wechatEnabled:'payment_mk99_wechat_enabled',alipayReleased:'payment_mk99_alipay_released',wechatReleased:'payment_mk99_wechat_released'};
  if(!input||typeof input!=='object'||Array.isArray(input)||!['mk99','xiaodou','none'].includes(String(input.activeMerchant))||!Object.keys(fields).every(key=>typeof input[key]==='boolean')||Object.keys(input).some(key=>key!=='activeMerchant'&&!(key in fields)))throw new ApiFailure(400,'INVALID_REQUEST','收款商家配置无效。');
  // The selection affects BOTH credit packages and the four subscription
  // tiers. A Xiaodou deployment must explicitly approve the completed local
  // ledger, Staging signed-query acceptance, and approved network mode.
  if(input.activeMerchant==='xiaodou'&&before.activeMerchant!=='xiaodou'){
    if(env.XIAODOU_RSA2_SUBSCRIPTIONS_READY!=='1'||!xiaodouNetworkReady(env)||env.XIAODOU_WEBHOOKS_ENABLED!=='1')
      throw new ApiFailure(409,'XIAODOU_SUBSCRIPTION_SETTLEMENT_NOT_READY','小豆 RSA2 订阅、Webhook 与网络接入模式尚未全部确认，不允许全站切换。');
    if(!before.providers.rsa2.credentialsConfigured||!before.providers.rsa2.enabled||
      !before.channels.rsa2.alipay.enabled||!before.channels.rsa2.alipay.platformReleased)
      throw new ApiFailure(409,'XIAODOU_RSA2_NOT_READY','小豆 RSA2 支付宝凭据、接口或平台放行未就绪。');
  }
  const op=await operation(env,actor,body,'merchant_payment_settings','active_merchant');
  const statements=[env.DB.prepare("UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key='active_merchant'").bind(input.activeMerchant,now,actor.user_id),...Object.entries(fields).map(([field,key])=>env.DB.prepare('UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key=?').bind(input[field]?'1':'0',now,actor.user_id,key))];
  await commitOperation(env,op,statements,{activeMerchant:before.activeMerchant,mk99:before.providers.mk99,channels:before.channels.mk99},input);
  return response({ok:true,...await paymentControl(env)},200,env,request);
 }

 if(body.settings!==undefined){
  const input=body.settings as Record<string,unknown>;
  const fields={rsa2Enabled:'payment_rsa2_enabled',rsa2WechatEnabled:'payment_rsa2_wechat_enabled',rsa2AlipayEnabled:'payment_rsa2_alipay_enabled',rsa2WechatReleased:'payment_rsa2_wechat_released',rsa2AlipayReleased:'payment_rsa2_alipay_released',epayEnabled:'payment_epay_enabled',epayAlipayEnabled:'payment_epay_alipay_enabled',epayAlipayReleased:'payment_epay_alipay_released'} as const;
  const legacyFields={rsa2Enabled:'payment_rsa2_enabled',epayEnabled:'payment_epay_enabled',alipayEnabled:'payment_alipay_enabled',wechatEnabled:'payment_wechat_enabled',alipayReleased:'payment_alipay_released',wechatReleased:'payment_wechat_released'} as const;
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiFailure(400,'INVALID_REQUEST','支付配置格式无效。');
  const isNew=Object.keys(fields).every(key=>typeof input[key]==='boolean')&&Object.keys(input).every(key=>key in fields);
  const isLegacy=Object.keys(legacyFields).every(key=>typeof input[key]==='boolean')&&Object.keys(input).every(key=>key in legacyFields);
  if(!isNew&&!isLegacy)throw new ApiFailure(400,'INVALID_REQUEST','支付配置格式无效。');
  const normalized=isNew?input:{
   rsa2Enabled:input.rsa2Enabled,rsa2WechatEnabled:input.wechatEnabled,rsa2AlipayEnabled:input.alipayEnabled,
   rsa2WechatReleased:input.wechatReleased,rsa2AlipayReleased:before.channels.rsa2.alipay.platformReleased,
   // Legacy clients cannot identify which Alipay protocol was approved.
   // Preserve both independent decisions; only explicit provider fields may
   // change Alipay release. WeChat has only ever been supported by RSA2.
   epayEnabled:input.epayEnabled,epayAlipayEnabled:before.channels.epay.alipay.enabled,epayAlipayReleased:before.channels.epay.alipay.platformReleased,
  };
  const op=await operation(env,actor,body,'payment_provider_settings','payment_providers');
  const values:Array<[string,string]>=Object.entries(fields).map(([field,key])=>[key,normalized[field]?'1':'0']);
  if(isLegacy){
   values.push(['payment_alipay_enabled',input.alipayEnabled?'1':'0'],['payment_wechat_enabled',input.wechatEnabled?'1':'0'],['payment_alipay_released',input.alipayReleased?'1':'0'],['payment_wechat_released',input.wechatReleased?'1':'0']);
  }
  const statements=values.map(([key,value])=>env.DB.prepare('UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key=?').bind(value,now,actor.user_id,key));
  await commitOperation(env,op,statements,before,{...before.providers,...before.channels,settings:normalized});
  return response({ok:true,...await paymentControl(env)},200,env,request);
 }
 if(typeof body.enabled!=='boolean')throw new ApiFailure(400,'INVALID_REQUEST','开关必须为布尔值。');
 const op=await operation(env,actor,body,'purchase_control','purchase_enabled');
 if(!op.replayed&&body.enabled&&!before.environmentReady)throw new ApiFailure(409,'PAYMENT_NOT_READY','环境支付保护尚未就绪。');
 await commitOperation(env,op,[env.DB.prepare("UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key='purchase_enabled'").bind(body.enabled?'1':'0',now,actor.user_id)],before,{enabled:body.enabled});
 return response({ok:true,...await paymentControl(env)},200,env,request);
}
export async function adminChangePassword(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env),{token}=await sessionFor(request,env);await requireCsrf(request,env,token);
 if(!await takeRate(env,`admin-password:${actor.user_id}`,5,900000,nowMs()))throw new ApiFailure(429,'RATE_LIMITED','请稍后再试。');
 const body=await jsonBody(request,4096);
 // Operation identity deliberately contains only public metadata. Password material must never enter audit fingerprints.
 const op=await operation(env,actor,{operationId:body.operationId,reason:body.reason},'security_password',actor.user_id);
 if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 const password=body.newPassword;
 if(typeof password!=='string'||password.length<12||new TextEncoder().encode(password).length>256||[ /\p{L}/u,/\p{N}/u,/[^\p{L}\p{N}\s]/u ].filter(re=>re.test(password)).length<2||password!==body.confirmPassword)throw new ApiFailure(400,'INVALID_PASSWORD','新密码至少12位，需含字母、数字、符号中的两类，并与确认密码一致。');
 const user=await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(actor.user_id).first<{password_hash:string}>();
 if(typeof body.oldPassword!=='string'||body.oldPassword.length>256||!await verifyPassword(env,body.oldPassword,user?.password_hash??null))throw new ApiFailure(401,'INVALID_CREDENTIALS','原密码错误。');
 if(password===body.oldPassword)throw new ApiFailure(400,'INVALID_PASSWORD','新密码需要与原密码不同。');
 const hash=await hashPassword(env,password),now=nowMs();
 await commitOperation(env,op,[
 env.DB.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').bind(hash,actor.user_id,user!.password_hash),
 // A failed CAS aborts the complete D1 batch, including its operation and audit record.
 env.DB.prepare('INSERT INTO admin_operations(id,actor_user_id,action,target_id,fingerprint,created_at) SELECT ?,NULL,?,?,?,? WHERE changes()<>1').bind(op.id,'security_password',actor.user_id,op.fingerprint,now),
 env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL').bind(now,actor.user_id,actor.id),
 env.DB.prepare('DELETE FROM admin_reauth_sessions WHERE session_id IN (SELECT id FROM sessions WHERE user_id=?)').bind(actor.user_id),
 env.DB.prepare('DELETE FROM password_resets WHERE user_id=?').bind(actor.user_id)
 ],{passwordChanged:false},{passwordChanged:true,otherSessionsRevoked:true});
 return response({ok:true,reauthRequired:true},200,env,request);
}
export async function adminRevokeOtherSessions(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,2048),op=await operation(env,actor,body,'security_revoke_sessions',actor.user_id),now=nowMs();
 await commitOperation(env,op,[env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL').bind(now,actor.user_id,actor.id),env.DB.prepare('DELETE FROM admin_reauth_sessions WHERE session_id IN (SELECT id FROM sessions WHERE user_id=? AND id<>?)').bind(actor.user_id,actor.id)],null,{otherSessionsRevoked:true});
 return response({ok:true},200,env,request);
}
