import {openInteractionDB,beginSession,endSession,commitBatch,readEventPage,readCoverage,clearOwner} from '../storage/repository.js';
import {rankInteractions} from '../analytics/ranking.js';
import {validId,primaryEvents} from '../core/events.js';
import {parseImport,OFFLINE_DB} from './import.js';
export const MAX_WORKSPACE_EVENTS=50000;
export class Workspace {
  constructor(db){this.db=db;this.session=null;this.busy=false;}
  static async open(){return new Workspace(await openInteractionDB(globalThis.indexedDB,OFFLINE_DB));}
  async select(owner){
    if(this.busy||!validId(owner))throw Error('invalid_owner');
    this.busy=true;
    try{if(this.session)await endSession(this.db,this.session);this.session=await beginSession(this.db,owner);return owner;}
    finally{this.busy=false;}
  }
  async rows(){
    if(!this.session)throw Error('select_owner');
    const session=this.session,rows=[];let after=null;
    do{const page=await readEventPage(this.db,session,{after,limit:1000});rows.push(...page.rows);if(rows.length>MAX_WORKSPACE_EVENTS)throw Error('workspace_limit');after=page.next;}while(after);
    if(this.session!==session)throw Error('stale_session');
    return rows;
  }
  async importText(text){
    if(this.busy||!this.session)throw Error('select_owner');
    this.busy=true;
    try{
      const parsed=parseImport(text);
      if(parsed.ownerUserId!==this.session.ownerUserId)throw Error('owner_mismatch');
      const existing=new Set((await this.rows()).map(e=>e.eventId));
      for(const e of parsed.events)existing.add(e.eventId);
      if(existing.size>MAX_WORKSPACE_EVENTS)throw Error('workspace_limit');
      let inserted=0,accepted=0;
      for(let i=0;i<parsed.events.length;i+=500){
        const result=await commitBatch(this.db,this.session,parsed.events.slice(i,i+500),{source:parsed.source,reason:'partial',observedAt:parsed.observedAt});
        inserted+=result.inserted;accepted+=result.accepted;
      }
      return {inserted,accepted,stats:parsed.stats};
    }finally{this.busy=false;}
  }
  async view(options={}){
    const session=this.session;
    const rows=await this.rows();
    const result=rankInteractions(rows,{...options,ownerUserId:session.ownerUserId});
    const coverage=await readCoverage(this.db,session);
    return {...result,coverage,stored:rows.length};
  }
  async details(userId,{direction='inbound',days=null,now=Date.now()}={}){
    if(!validId(userId))throw Error('invalid_user');
    const rows=primaryEvents(await this.rows());
    return rows.filter(e=>(e.direction==='inbound'?e.actorUserId:e.targetUserId)===userId&&(direction==='both'||e.direction===direction)&&(e.occurredAt===null?days===null:e.occurredAt<=now&&(days===null||e.occurredAt>=now-days*86400000))).sort((a,b)=>(b.occurredAt??0)-(a.occurredAt??0)||a.eventId.localeCompare(b.eventId));
  }
  async clear(){
    if(this.busy||!this.session)throw Error('select_owner');
    this.busy=true;try{await clearOwner(this.db,this.session);}finally{this.busy=false;}
  }
}
