import {createLiveSession,acceptRead,liveRanking,canReadMore,POLL_MS} from './interaction-live-session.js';
const root=document.querySelector('#staging-interactions');
if(root){
  const get=id=>root.querySelector('#'+id);
  let session=null, running=false,busy=false,timer=null,generation=0,selected=null;
  const status=s=>get('interaction-status').textContent=s;
  function controls(){
    get('interaction-read').disabled=busy||running;
    get('interaction-start').disabled=busy||running;
    get('interaction-stop').disabled=!running;
    get('interaction-clear').disabled=busy||running;
  }
  function render(){
    const mode=get('interaction-mode').value;
    const type=get('interaction-type').value;
    const people=liveRanking(session,{mode,type,query:get('interaction-search').value});
    const list=get('interaction-results');list.replaceChildren();
    const details=get('interaction-details');details.replaceChildren();
    const entries=mode==='snapshot'?session?.snapshot?.events??[]:(session?.accumulated?.entries??[]).map(x=>x[1]);
    for(const [i,p] of people.slice(0,100).entries()){
      const row=document.createElement('li'),btn=document.createElement('button'),link=document.createElement('a');
      btn.type='button';btn.className='text-button';btn.textContent='@'+p.actor;
      btn.onclick=()=>{selected=p.actor;render();};
      link.textContent='主页';link.href='https://x.com/'+p.actor;link.target='_blank';link.rel='noopener noreferrer';
      row.append(document.createTextNode(String(i+1)+'. '),btn,document.createTextNode(' — '+p.total+' 条（回复 '+p.reply+' · 点赞 '+p.like+' · 转发 '+p.repost+'） '),link);list.append(row);
    }
    if(!list.children.length){const li=document.createElement('li');li.textContent='暂无可识别的互动条目';list.append(li);}
    if(selected&&people.some(p=>p.actor===selected)){
      const h=document.createElement('strong');h.textContent='@'+selected+' · 已观察记录';details.append(h);
      const ol=document.createElement('ol');
      for(const e of entries.filter(e=>e.actor===selected&&(type==='all'||e.type===type)).slice(0,50)){
        const li=document.createElement('li');li.textContent=({like:'点赞',reply:'回复',repost:'转发'}[e.type])+' · 时间未确认 ';
        if(e.postId){const a=document.createElement('a');a.href='https://x.com/i/web/status/'+e.postId;a.target='_blank';a.rel='noopener noreferrer';a.textContent='原帖';li.append(a);}
        ol.append(li);
      }details.append(ol);
    }
  }
  function stop(reason,{clear=false}={}){
    generation++;running=false;clearTimeout(timer);timer=null;
    if(clear){session=null;selected=null;render();}
    else if(session)session={...session,stopReason:reason};
    controls();
  }
  async function tabId(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!Number.isInteger(tab?.id))throw Error('no_tab');return tab.id;}
  async function readOnce(token){
    if(busy||token!==generation)return;
    busy=true;controls();
    try{
      const id=await tabId();
      if(token!==generation)return;
      if(!session)session=createLiveSession({tabId:id});
      if(id!==session.tabId)throw Error('tab_changed');
      const result=await chrome.tabs.sendMessage(id,{type:'REPLY_COPILOT_STAGING_READ_VISIBLE_INTERACTIONS'});
      if(token!==generation)return;
      const current=await tabId();
      if(token!==generation)return;
      session=acceptRead(session,result,{tabId:current});
      const s=session.stats;
      status('@'+session.owner+' · '+session.reads+' 次读取 · 当前 '+s.scanned+' 条通知，未识别 '+s.unresolved+' 条，缺少目标帖 '+s.missingTargetRows+' 条。累计可去重 '+session.accumulated.entries.length+' 条。'+(s.truncated?' 单次达到上限。':'')+' '+(running?'请手动向下滚动，完成后停止。':'当前会话观察，非完整历史。'));
      render();
      if(running&&!canReadMore(session)){stop('limit');status('达到连续读取上限，保留当前会话结果；不是完整历史。');}
    }catch(e){
      if(token!==generation)return;
      stop('error',{clear:true});status('读取停止：'+String(e?.message??'error').slice(0,80)+'。请打开 X 通知页，确认账号后重新读取。');
    }finally{
      busy=false;controls();
      if(running&&token===generation)timer=setTimeout(()=>readOnce(token),POLL_MS);
    }
  }
  function begin(continuous){
    if(busy||running)return;
    // Single reads also preserve deduplicated results only within same document and owner.
    if(session?.stopReason)session=null;
    if(session&&!canReadMore(session)){session=null;selected=null;render();}
    generation++;running=continuous;controls();void readOnce(generation);
  }
  get('interaction-read').onclick=()=>begin(false);
  get('interaction-start').onclick=()=>begin(true);
  get('interaction-stop').onclick=()=>{stop('manual');status('连续读取已停止，保留当前会话结果。');};
  get('interaction-clear').onclick=()=>{stop('clear',{clear:true});status('已清除会话。');};
  for(const id of ['interaction-mode','interaction-type'])get(id).onchange=render;
  get('interaction-search').oninput=render;
  // No polling/observer while idle. Tab switch invalidates even a stopped result.
  chrome.tabs.onActivated.addListener(({tabId:id})=>{if(session&&id!==session.tabId){stop('tab_changed',{clear:true});status('已切换标签页，请重新读取通知。');}});
  chrome.tabs.onUpdated.addListener((id,change)=>{if(session&&id===session.tabId&&change.status==='loading'){stop('navigation',{clear:true});status('页面已重新加载，请重新读取通知。');}});
  chrome.tabs.onRemoved.addListener(id=>{if(session&&id===session.tabId){stop('tab_closed',{clear:true});status('通知标签页已关闭。');}});
  window.addEventListener('pagehide',()=>stop('closed',{clear:true}),{once:true});
  controls();render();
}
