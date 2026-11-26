// Pure decoder for already-provided, authorized structured web response records.
// Inspired by X-Insights src/parse/tweet.ts (MIT, bc56bd0).
// No acquisition, authentication, endpoint selection, or network calls.
import {validId} from '../core/events.js';
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
const stable=(...ids)=>{const known=ids.filter(v=>v!==null&&v!==undefined);return known.length&&known.every(validId)&&new Set(known).size===1?known[0]:null;};
const unwrap=raw=>{const v=obj(raw);return v?.__typename==='TweetWithVisibilityResults'?obj(v.tweet):v;};
function identity(raw){
 const t=unwrap(raw),l=obj(t?.legacy);
 if(!t||!l||t.__typename&&t.__typename!=='Tweet')return null;
 const u=obj(t.core?.user_results?.result);
 const id=stable(t.rest_id,l.id_str),author=stable(u?.rest_id,u?.legacy?.id_str,l.user_id_str);
 return id&&author?{t,l,u,id,author}:null;
}
function relation(raw,expectedId){
 const v=identity(raw);
 if(!v||expectedId!=null&&stable(expectedId,v.id)!==v.id)return null;
 return v;
}
export function decodeWebPostRecords(raw,{observedAt=Date.now()}={}){
 if(!Array.isArray(raw)||raw.length>1000||!Number.isSafeInteger(observedAt)||observedAt<=0)throw Error('schema_changed');
 const posts=[],users=new Map();let ignored=0;
 for(const row of raw){
  const v=identity(row);
  if(!v){ignored++;continue;}
  const {t,l,u,id,author}=v;
  const h=u?.core?.screen_name??u?.legacy?.screen_name;
  if(typeof h==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(h))users.set(author,{userId:author,handle:h,observedAt});
  const date=typeof l.created_at==='string'?Date.parse(l.created_at):NaN;
  const createdAt=Number.isSafeInteger(date)&&date>0&&date<=observedAt?date:null;
  const retweet=relation(l.retweeted_status_result?.result??t.retweeted_status_result?.result,l.retweeted_status_id_str);
  // A repost wrapper represents the repost action only, not the quoted/replied
  // or mentioned relationships of the underlying original post.
  const hasRepost=l.retweeted_status_result!=null||t.retweeted_status_result!=null||l.retweeted_status_id_str!=null;
  if(hasRepost){
    if(!retweet){ignored++;continue;}
    posts.push({postId:id,authorUserId:author,repostedUserId:retweet.author,repostedPostId:retweet.id,createdAt});continue;
  }
  const quote=relation(t.quoted_status_result?.result,l.quoted_status_id_str);
  const mentions=l.entities?.user_mentions;
  posts.push({postId:id,authorUserId:author,createdAt,replyToUserId:validId(l.in_reply_to_user_id_str)?l.in_reply_to_user_id_str:null,replyToPostId:validId(l.in_reply_to_status_id_str)?l.in_reply_to_status_id_str:null,quotedUserId:quote?.author??null,quotedPostId:quote?.id??null,mentionedUserIds:Array.isArray(mentions)&&mentions.length<=100?[...new Set(mentions.map(m=>stable(m?.id_str)).filter(Boolean))]:[]});
 }
 if(raw.length&&ignored===raw.length)throw Error('schema_changed');
 return {posts,users:[...users.values()],ignored};
}
