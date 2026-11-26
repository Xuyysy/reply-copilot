import {normalizeSnapshot,ranking,mergeConfirmed} from './interaction-ranking.js';
const root=document.querySelector('#staging-interactions');
if(root){
  const get=id=>root.querySelector('#'+id);
  let snapshot=null, accumulated=null, busy=false;
  function render(){
    const mode=get('interaction-mode').value;
    const events=mode==='confirmed'?(accumulated?.entries||[]).map(x=>x[1]):snapshot?.events||[];
    const list=get('interaction-results');list.replaceChildren();
    for(const [i,p] of ranking(events).slice(0,100).entries()){
      const row=document.createElement('li');
      const link=document.createElement('a');link.textContent='@'+p.actor;link.href='https://x.com/'+p.actor;link.target='_blank';link.rel='noopener noreferrer';
      row.append(document.createTextNode(String(i+1)+'. '),link,document.createTextNode(' — '+p.total+' 条（回复 '+p.reply+' · 点赞 '+p.like+' · 转发 '+p.repost+'）'));list.append(row);
    }
    if(!list.children.length){const li=document.createElement('li');li.textContent='暂无可确认的互动条目';list.append(li);}
  }
  function reset(){snapshot=null;accumulated=null;render();}
  get('interaction-mode').addEventListener('change',render);
  get('interaction-clear').addEventListener('click',()=>{reset();get('interaction-status').textContent='已清除本次会话数据。';});
  get('interaction-read').addEventListener('click',async()=>{
    if(busy)return;busy=true;get('interaction-read').disabled=true;get('interaction-clear').disabled=true;
    try{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!Number.isInteger(tab?.id))throw new Error('no_tab');
      const result=await chrome.tabs.sendMessage(tab.id,{type:'REPLY_COPILOT_STAGING_READ_VISIBLE_INTERACTIONS'});
      if(!result?.ok)throw new Error(result?.reason||'parse_failed');
      const next=normalizeSnapshot(result);
      const [current]=await chrome.tabs.query({active:true,currentWindow:true});
      if(current?.id!==tab.id)throw new Error('tab_changed');
      accumulated=mergeConfirmed(accumulated,next,tab.id);snapshot=next;
      get('interaction-status').textContent='@'+next.owner+'：本次读取 '+result.scanned+' 个已加载条目；'+result.unresolved+' 个未识别，'+next.events.length+' 个已观察互动记录。累计去重 '+accumulated.entries.length+' 条。'+(result.truncated?' 已达本次扫描上限。':'')+' 不是完整历史。';
      render();
    }catch(e){
      reset();get('interaction-status').textContent=e.message==='owner_unknown'?'无法确认当前 X 账号，请刷新通知页后重试。':'请在当前标签页打开 X 通知页并重试；本次未取得可靠数据（'+String(e.message||'error').slice(0,90)+'）。';
    }finally{busy=false;get('interaction-read').disabled=false;get('interaction-clear').disabled=false;}
  });
  // Keep data in this open side panel only, not persisted across account sessions.
  render();
}
