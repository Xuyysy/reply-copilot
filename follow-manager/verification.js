// Local, user-supplied labels. Official follow archives contain no blue-V data.
const ID=/^[1-9][0-9]{0,19}$/;
export function verificationFor(snapshot,id) {
  const value=snapshot?.verification?.[id];
  return typeof value==="boolean"?value:null;
}
export function filterAccounts(ids,query,filter,snapshot) {
  return ids.filter(id=>{
    const v=verificationFor(snapshot,id);
    return id.includes(query) && (filter==="all" || filter==="blue"&&v===true ||
      filter==="not-blue"&&v===false || filter==="unknown"&&v===null);
  });
}
export function mergeVerification(snapshot,changes) {
  const allowed=new Set([...snapshot.followers,...snapshot.following]);
  const result=Object.create(null);
  for(const [id,v] of Object.entries(snapshot.verification||{}))
    if(allowed.has(id)&&ID.test(id)&&typeof v==="boolean")result[id]=v;
  for(const [id,v] of Object.entries(changes||{})){
    if(!ID.test(id)||!(v===null||typeof v==="boolean"))throw new Error("认证标记格式无效。");
    if(!allowed.has(id))continue;
    if(v===null)delete result[id];else result[id]=v;
  }
  return result;
}
// Narrow CSV format: account_id,blue_verified, with optional extra columns.
// IDs stay strings; reject malformed rows and contradictory duplicates.
export function parseVerificationCSV(text) {
  if(typeof text!=="string"||text.length>16*1024*1024)throw new Error("认证文件过大。");
  const lines=text.replace(/^\uFEFF/,"").trim().split(/\r?\n/);
  const header=lines.shift()?.split(",").map(x=>x.trim())||[];
  const a=header.indexOf("account_id"),b=header.indexOf("blue_verified");
  if(a<0||b<0||lines.length>500000)throw new Error("CSV 需包含 account_id 与 blue_verified 两列。");
  const out=Object.create(null);
  for(const line of lines){
    if(!line.trim())continue;
    const parts=line.split(",").map(x=>x.trim().replace(/^"([^"]*)"$/,"$1"));
    const id=parts[a],v=parts[b];
    if(parts.length!==header.length||!ID.test(id)||!["true","false","unknown"].includes(v))
      throw new Error("认证 CSV 含无效 ID 或认证状态。");
    // Unknown from an imported file is not a positive or negative observation.
    if(v==="unknown")continue;
    const flag=v==="true";
    if(Object.hasOwn(out,id)&&out[id]!==flag)throw new Error("认证 CSV 中存在冲突的账号标记。");
    out[id]=flag;
  }
  return out;
}
