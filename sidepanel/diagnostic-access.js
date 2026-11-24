// A UI feature flag, not an authorization for AI, account or data access.
// The server identifies the owner using the authenticated extension token.
export function validGrant(data,now=Date.now()){
 const grant=data?.schema===1?data.features?.localDiagnostics:null;
 return grant?.enabled===true&&Number.isSafeInteger(grant.expiresAt)&&grant.expiresAt>now
  ?{enabled:true,expiresAt:grant.expiresAt}:null;
}
export async function fetchDiagnosticGrant(client){
 try{
  const token=await client.token();
  if(!token)return null;
  const data=await client.request("/v1/extension/support-features",{expectedToken:token});
  if(await client.token()!==token)return null;
  return validGrant(data);
 }catch{return null;}
}
