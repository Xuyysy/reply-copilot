import {bootstrapAdmin,inspectBootstrapTarget,PRODUCTION_DATABASE_ID,BootstrapError} from './bootstrap.mjs';

const allowedErrors=new Set(['INVALID_INPUT','WRONG_ENVIRONMENT','WRONG_DATABASE','OWNER_AUTHORIZATION_REQUIRED','TYPED_CONFIRMATION_REQUIRED','USER_NOT_FOUND','EMAIL_MISMATCH','USER_DISABLED','USER_NOT_VERIFIED','USER_NOT_ORDINARY','EXISTING_ADMIN','ADMIN_ALREADY_BOUND','PRECONDITION_FAILED']);
function safeEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const length=Math.max(a.length,b.length);let diff=a.length^b.length;
 for(let i=0;i<length;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return diff===0;
}

async function readJson(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new BootstrapError('INVALID_INPUT');
 if(Number(request.headers.get('content-length')||0)>4096)throw new BootstrapError('INVALID_INPUT');
 const reader=request.body?.getReader();if(!reader)throw new BootstrapError('INVALID_INPUT');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new BootstrapError('INVALID_INPUT');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

function json(body,status){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}

export async function handleBootstrapRequest(request,env){
 const path=new URL(request.url).pathname;
 if(request.method!=='POST'||!['/inspect','/execute'].includes(path))return new Response(null,{status:404});
 if(env?.ENVIRONMENT!=='production'||env?.BOOTSTRAP_TARGET_DATABASE_ID!==PRODUCTION_DATABASE_ID||!env?.DB)return new Response(null,{status:404});
 const expected=env.BOOTSTRAP_SESSION_TOKEN,authorization=request.headers.get('authorization')??'';
 const supplied=authorization.startsWith('Bearer ')?authorization.slice(7):'';
 if(!expected||!safeEqual(expected,supplied))return new Response(null,{status:404});
 let body;try{body=await readJson(request);}catch{return json({ok:false,code:'INVALID_INPUT'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body))return json({ok:false,code:'INVALID_INPUT'},400);
 try{
  if(path==='/inspect'){
   const result=await inspectBootstrapTarget(env.DB,body);
   return json({ok:true,result},200);
  }
  const result=await bootstrapAdmin(env.DB,body,{
   environment:env.ENVIRONMENT,
   configuredDatabaseId:env.BOOTSTRAP_TARGET_DATABASE_ID,
   requestedDatabaseId:body.requestedDatabaseId,
   confirmedDatabaseId:body.confirmedDatabaseId,
   explicitAuthorization:body.explicitAuthorization===true,
   typedConfirmationUserId:body.typedConfirmationUserId
  });
  return json({ok:true,result},200);
 }catch(error){
  const code=error instanceof BootstrapError&&allowedErrors.has(error.code)?error.code:'BOOTSTRAP_FAILED';
  const status=code==='OWNER_AUTHORIZATION_REQUIRED'||code==='TYPED_CONFIRMATION_REQUIRED'?403:code==='WRONG_ENVIRONMENT'||code==='WRONG_DATABASE'?404:code==='BOOTSTRAP_FAILED'?500:409;
  return json({ok:false,code},status);
 }
}

export default {fetch:handleBootstrapRequest};
