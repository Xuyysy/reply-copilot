// Synthetic only: no transport, no X session, no production identity.
export const FIXTURE_OWNER="9000000000000000001";
export function fixturePage(kind,cursor,total=100){
 if(!["followers","following"].includes(kind)||!Number.isSafeInteger(total)||total<0||total>50000)throw Error("fixture_invalid");
 const offset=cursor===null?0:Number(cursor);
 if(!Number.isSafeInteger(offset)||offset<0||offset>total)throw Error("fixture_cursor");
 const end=Math.min(offset+200,total);
 const users=Array.from({length:end-offset},(_,i)=>{const n=offset+i+(kind==="followers"?Math.floor(total/3):0);return {userId:String(100000000+n),handle:"demo_"+n,displayName:"Demo "+n,followersCount:n%10000,followingCount:n%2000,verificationType:n%3===0?"blue":null}});
 return {cursor,users,expected:total,terminal:end===total,nextCursor:end===total?null:String(end)};
}
