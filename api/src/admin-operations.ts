import type {Env,Session} from './types';
import {ApiFailure} from './types';
import {jsonBody,sha256,nowMs} from './security';
import {requireAdminSession} from './admin-auth';
import {sessionFor,requireCsrf,takeRate} from './auth';
import {verifyAccountPassword} from './password-auth';
import {response} from './http';

export async function adminReauth(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env);
 const {token}=await sessionFor(request,env);await requireCsrf(request,env,token);
 if(!await takeRate(env,`admin-reauth:${actor.user_id}`,5,900000,nowMs()))throw new ApiFailure(429,'RATE_LIMITED','请稍后重新验证。');
 const body=await jsonBody(request,2048);
 const user=await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(actor.user_id).first<{password_hash:string}>();
 if(typeof body.password!=='string'||body.password.length>256||!await verifyAccountPassword(env,actor.user_id,body.password,user?.password_hash??null))throw new ApiFailure(401,'INVALID_CREDENTIALS','密码验证失败。');
 const expiresAt=nowMs()+900000;
 await env.DB.prepare('INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET expires_at=excluded.expires_at').bind(actor.id,expiresAt).run();
 return response({ok:true,expiresAt},200,env,request);
}
export type Operation={id:string;actor:string;action:string;target:string;fingerprint:string;reason:string;replayed:boolean};
export async function operation(env:Env,actor:Session,body:Record<string,unknown>,action:string,target:string):Promise<Operation>{
 if(typeof body.operationId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operationId))throw new ApiFailure(400,'INVALID_OPERATION','请提供唯一操作编号。');
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(reason.length<8||reason.length>500)throw new ApiFailure(400,'INVALID_REASON','请填写至少8字、最多500字的操作原因。');
 const normalized=Object.fromEntries(Object.entries(body).filter(([key])=>key!=='operationId').sort(([a],[b])=>a.localeCompare(b)));
 const fingerprint=await sha256(JSON.stringify(normalized));
 const result={id:body.operationId,actor:actor.user_id,action,target,fingerprint,reason,replayed:false};
 const old=await env.DB.prepare('SELECT actor_user_id,action,target_id,fingerprint FROM admin_operations WHERE id=?').bind(result.id).first<{actor_user_id:string;action:string;target_id:string;fingerprint:string}>();
 if(old){if(old.actor_user_id!==result.actor||old.action!==action||old.target_id!==target||old.fingerprint!==fingerprint)throw new ApiFailure(409,'OPERATION_CONFLICT','操作编号已被其他请求使用。');result.replayed=true;}
 return result;
}
export async function commitOperation(env:Env,op:Operation,statements:D1PreparedStatement[],before:unknown,after:unknown):Promise<void>{
 if(op.replayed)return;
 const now=nowMs();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO admin_operations(id,actor_user_id,action,target_id,fingerprint,created_at) VALUES(?,?,?,?,?,?)').bind(op.id,op.actor,op.action,op.target,op.fingerprint,now),
 ...statements,
 env.DB.prepare('INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(op.id,op.actor,op.action,op.target,op.reason,JSON.stringify(before),JSON.stringify(after),now)
 ]);}catch(error){
 const old=await env.DB.prepare('SELECT actor_user_id,action,target_id,fingerprint FROM admin_operations WHERE id=?').bind(op.id).first<{actor_user_id:string;action:string;target_id:string;fingerprint:string}>();
 if(old&&old.actor_user_id===op.actor&&old.action===op.action&&old.target_id===op.target&&old.fingerprint===op.fingerprint){op.replayed=true;return;}
 throw new ApiFailure(409,'OPERATION_FAILED','操作未完成，数据可能刚刚变化，请刷新后重试。');
 }
}
export {CONTENT_KEYS,validateContent} from './site-config';
import {validateContent} from './site-config';
export async function siteContent(request:Request,env:Env,admin=false):Promise<Response>{
 if(admin)await requireAdminSession(request,env);
 const row=await env.DB.prepare("SELECT value FROM system_settings WHERE key='site_content'").first<{value:string}>();
 let content;try{content=validateContent(JSON.parse(row?.value??'{}'));}catch{content=validateContent({});}
 return response({content},200,env,request);
}
export async function updateContent(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,100000),content=validateContent(body.content),op=await operation(env,actor,body,'site_content','site_content');
 const before=await env.DB.prepare("SELECT value FROM system_settings WHERE key='site_content'").first<{value:string}>();
 await commitOperation(env,op,[env.DB.prepare("INSERT INTO site_content_versions(id,actor_user_id,content_json,created_at) SELECT ?,?,value,? FROM system_settings WHERE key='site_content'").bind(op.id,actor.user_id,nowMs()),env.DB.prepare("UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key='site_content'").bind(JSON.stringify(content),nowMs(),actor.user_id)],before,content);
 return response({ok:true},200,env,request);
}

export async function contentHistory(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const rows=await env.DB.prepare('SELECT id,created_at,actor_user_id FROM site_content_versions ORDER BY created_at DESC,id DESC LIMIT 100').all();
 return response({versions:rows.results??[]},200,env,request);
}
export async function restoreContent(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,4096);
 if(typeof body.versionId!=='string'||body.versionId.length>100)throw new ApiFailure(400,'INVALID_VERSION','版本无效。');
 const op=await operation(env,actor,body,'site_content_restore',body.versionId);
 const version=await env.DB.prepare('SELECT content_json FROM site_content_versions WHERE id=?').bind(body.versionId).first<{content_json:string}>();
 if(!version)throw new ApiFailure(404,'NOT_FOUND','版本不存在。');
 const content=validateContent(JSON.parse(version.content_json));
 const before=await env.DB.prepare("SELECT value FROM system_settings WHERE key='site_content'").first<{value:string}>();
 await commitOperation(env,op,[env.DB.prepare("INSERT INTO site_content_versions(id,actor_user_id,content_json,created_at) SELECT ?,?,value,? FROM system_settings WHERE key='site_content'").bind(op.id,actor.user_id,nowMs()),env.DB.prepare("UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key='site_content'").bind(JSON.stringify(content),nowMs(),actor.user_id)],before,content);
 return response({ok:true,content},200,env,request);
}
