export function stableId(x){return typeof x==="string"&&/^[1-9]\d{0,19}$/.test(x)}

export function userRef(raw,observedAt){
  if(!raw||!stableId(raw.userId)||!Number.isFinite(Date.parse(observedAt)))throw Error("invalid_user");
  const str=(x,max)=>typeof x==="string"&&x.length<=max?x:null;
  const num=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const handle=typeof raw.handle==="string"&&/^[a-zA-Z0-9_]{1,15}$/.test(raw.handle)?raw.handle:null;
  const verificationType=["blue","gold","grey","none"].includes(raw.verificationType)?raw.verificationType:null;
  const isBlueVerified=verificationType==="gold"||verificationType==="grey"||verificationType==="none"?false:verificationType==="blue"?true:typeof raw.isBlueVerified==="boolean"?raw.isBlueVerified:null;
  let avatarUrl=null;try{const u=new URL(raw.avatarUrl);if(u.protocol==="https:"&&!u.username&&!u.password&&u.hostname==="pbs.twimg.com")avatarUrl=u.href;}catch{}
  return {userId:raw.userId,handle,displayName:str(raw.displayName,200),avatarUrl,isBlueVerified,observedAt,verificationType,description:str(raw.description,2000),followersCount:num(raw.followersCount),followingCount:num(raw.followingCount),postsCount:num(raw.postsCount),createdAt:typeof raw.createdAt==="string"&&Number.isFinite(Date.parse(raw.createdAt))?raw.createdAt:null,protected:typeof raw.protected==="boolean"?raw.protected:null};
}

export function emptyStage(){return {cursor:null,seenCursors:[],pages:0,count:0,expected:null,terminal:false,startedAt:null,finishedAt:null}}

export function nextStage(stage,page,added,now){
  if(stage.terminal||!page||!Array.isArray(page.users)||typeof page.terminal!=="boolean"||!Number.isSafeInteger(added)||added<0||added>page.users.length)throw Error("invalid_page");
  if(page.terminal&&page.nextCursor!==null||!page.terminal&&(typeof page.nextCursor!=="string"||page.nextCursor.length<1||page.nextCursor.length>512))throw Error("invalid_cursor");
  if(!page.terminal&&(page.nextCursor===stage.cursor||stage.seenCursors.includes(page.nextCursor)))throw Error("cursor_loop");
  if(page.expected!==null&&(!Number.isSafeInteger(page.expected)||page.expected<0))throw Error("invalid_count");
  if(stage.pages>0&&stage.expected!==page.expected)throw Error("count_changed");
  if(stage.count+added>50000||stage.pages>=10000)throw Error("capacity");
  if(stage.pages>0&&page.users.length===0&&!page.terminal)throw Error("empty_nonterminal");
  return {...stage,cursor:page.nextCursor,seenCursors:page.terminal?stage.seenCursors:[...stage.seenCursors,page.nextCursor],pages:stage.pages+1,count:stage.count+added,expected:page.expected,terminal:page.terminal,startedAt:stage.startedAt??now,finishedAt:page.terminal?now:null};
}

export function completeness(stages){
  const a=stages.following,b=stages.followers;
  if(!a.terminal||!b.terminal)return "partial";
  if(a.expected===null||b.expected===null)return "unknown";
  return a.count===a.expected&&b.count===b.expected?"complete":"partial";
}

export function relationshipById(rows,quality){
  const map=Object.create(null);
  for(const row of rows){if(!stableId(row.userId)||!["following","followers"].includes(row.kind))throw Error("invalid_relation");const v=map[row.userId]??={following:null,follower:null};v[row.kind==="followers"?"follower":"following"]=true;}
  if(quality==="complete")for(const v of Object.values(map)){v.following??=false;v.follower??=false;}
  return map;
}

export function summarize(map){let mutual=0,notFollowingBack=0,iHaveNotFollowedBack=0,unknown=0,followers=0,following=0;for(const v of Object.values(map)){if(v.follower===true)followers++;if(v.following===true)following++;if(v.follower===true&&v.following===true)mutual++;else if(v.follower===false&&v.following===true)notFollowingBack++;else if(v.follower===true&&v.following===false)iHaveNotFollowedBack++;else unknown++;}return {followers,following,mutual,notFollowingBack,iHaveNotFollowedBack,unknown}}

export function compareSnapshots(current,prior){
  if(!current||!prior||current.ownerUserId!==prior.ownerUserId||current.completeness!=="complete"||prior.completeness!=="complete")return null;
  const ids=new Set([...Object.keys(current.relationshipByUserId),...Object.keys(prior.relationshipByUserId)]),result={newFollowers:[],missingFollowers:[],newMutuals:[],missingMutuals:[]};
  for(const id of ids){const a=current.relationshipByUserId[id],b=prior.relationshipByUserId[id],af=a?.follower===true,bf=b?.follower===true,am=af&&a?.following===true,bm=bf&&b?.following===true;if(af&&!bf)result.newFollowers.push(id);if(bf&&!af)result.missingFollowers.push(id);if(am&&!bm)result.newMutuals.push(id);if(bm&&!am)result.missingMutuals.push(id);}
  return result;
}
