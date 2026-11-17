(() => {
  // Opt-in Staging experiment: a trusted Repost -> Quote gesture is REQUIRED.
  // Production bundles may contain these files but the Quote feature remains OFF.
  if (window.top !== window) return;
  let isStaging=false;
  try {isStaging=chrome.runtime.getManifest().background?.service_worker==="staging/service-worker.js";}catch{}
  if(!isStaging)return;
  const api=globalThis.ZaneReplyCopilotContent;
  if(!api?.postExtractor||!api?.composerAdapter||!api?.quoteAssistant)return;
  const REPOST='[data-testid="retweet"],[data-testid="unretweet"]';
  const EDITOR='[role="dialog"] [contenteditable="true"][role="textbox"],[role="dialog"] [data-testid^="tweetTextarea_"] [contenteditable="true"]';
  let lastRepost=null,awaiting=null,session=null,observer=null,scheduled=false,closingTimeout=null;
  const normalize=x=>String(x||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  function visible(node){
    if(!node?.isConnected||node.closest('[aria-hidden="true"],[hidden]'))return false;
    return node.getClientRects().length>0&&getComputedStyle(node).visibility!=="hidden";
  }
  function capturePost(button){
    const article=button?.closest("article");
    const data=api.postExtractor.extractPost(article);
    if(!data?.ok||!data.statusId||!data.sourceText?.trim()||!data.sourceUrl)return null;
    const handle=new URL(data.sourceUrl).pathname.split("/")[1]?.toLowerCase()||"";
    return {statusId:data.statusId,sourceText:data.sourceText,sourceUrl:data.sourceUrl,handle};
  }
  function previewMatches(dialog,post){
    for(const attachment of dialog.querySelectorAll('[data-testid="attachments"]')){
      const previewText=attachment.querySelector('[data-testid="tweetText"]');
      const author=attachment.querySelector('[data-testid="User-Name"]');
      if(!previewText || !author)continue; // Text-only V1. No invented image-only context.
      const source=normalize(post.sourceText),shown=normalize(previewText.innerText||previewText.textContent);
      const partial=shown.replace(/(?:\.{3}|…)\s*$/,"").trim();
      const match=Boolean(shown&&(source===shown || (partial.length>=35&&source.startsWith(partial))));
      if(!match)continue;
      const authorText=normalize(author.innerText||author.textContent).toLowerCase();
      if(post.handle && !authorText.includes("@"+post.handle))continue;
      return true;
    }
    return false;
  }
  function matchQuoteEditor(post){
    const candidates=[];
    for(const editor of document.querySelectorAll(EDITOR)){
      if(!visible(editor))continue;
      const dialog=editor.closest('[role="dialog"]');
      if(!dialog||!previewMatches(dialog,post))continue;
      if(!candidates.includes(editor))candidates.push(editor);
    }
    return candidates.length===1?candidates[0]:null;
  }
  function cleanup({cancel=false}={}){
    if(cancel&&session?.requestId)void chrome.runtime.sendMessage({type:"REPLY_COPILOT_CANCEL",requestId:session.requestId}).catch(()=>{});
    session?.panel?.close();session=null;awaiting=null;
    if(closingTimeout)clearTimeout(closingTimeout);closingTimeout=null;
    observer?.disconnect();observer=null;scheduled=false;
  }
  function isActive(current){
    return session===current&&Boolean(matchQuoteEditor(current.post));
  }
  function open(post){
    if(session)return;
    const panel=api.quoteAssistant.mount({
      onGenerate:()=>generate(current),
      onInsert:(text,style)=>insert(current,text,style),
      onCopy:(text,style)=>copy(current,text,style),
      onClose:()=>cleanup({cancel:true}),
    });
    const current={post,panel,requestId:null,generating:false,completed:false};
    session=current;awaiting=null;
  }
  async function generate(current){
    if(!isActive(current)||current.generating||current.completed)return;
    current.generating=true;current.panel.setBusy(true);current.panel.report("正在生成适合自己时间线的引用观点…");
    const requestId=crypto.randomUUID();current.requestId=requestId;
    try{
      const answer=await chrome.runtime.sendMessage({type:"REPLY_COPILOT_GENERATE_QUOTE",requestId,sourceText:current.post.sourceText,sourceUrl:current.post.sourceUrl});
      if(session!==current)return;
      if(!isActive(current)){current.panel.report("Quote 窗口已改变，已停止操作。");return;}
      if(!answer?.ok)throw new Error(answer?.error||"AI Quote 生成失败，请重试。");
      if(answer.result?.recommendation!=="quote")throw new Error("生成结果不是 Quote 模式，已停止填入。");
      current.completed=true;
      current.panel.showResults(answer.result.replies,answer.result.defaultStyle);
    }catch(err){if(session===current)current.panel.report(err?.message||"生成失败。");}
    finally{if(session===current){current.generating=false;current.panel.setBusy(false);}}
  }
  function validDraft(current,draft){return isActive(current)&&current.completed&&typeof draft==="string"&&Boolean(draft.trim());}
  async function insert(current,draft,style){
    if(!validDraft(current,draft))return;
    const editor=matchQuoteEditor(current.post);
    if(!editor){current.panel.report("无法确认引用框，未填入。");return;}
    const adapter=api.composerAdapter;
    if(adapter.hasContent(editor)){current.panel.report("X Quote 已有草稿，已保留原文。可以复制再手动编辑。");return;}
    if(!adapter.focusEmpty(editor)){current.panel.report("无法安全获得编辑框焦点。请复制并粘贴。");return;}
    const text=draft.trim();
    const valid=()=>validDraft(current,text)&&matchQuoteEditor(current.post)===editor&&!adapter.hasContent(editor);
    const inserted=adapter.insertOnce(editor,current.requestId+"-quote-"+style,text,valid);
    if(!inserted){current.panel.report("X 未接受填入。可复制草稿并手动粘贴。");return;}
    await new Promise(resolve=>setTimeout(resolve,100));
    if(session!==current)return;
    if(!editor.isConnected||normalize(adapter.readText(editor))!==normalize(text)){
      current.panel.report("填入结果与草稿不一致，请核对 X 输入框；可复制草稿。");return;
    }
    current.panel.report("已填入 X Quote，请检查后自行点击 Post。");
    void chrome.runtime.sendMessage({type:"REPLY_COPILOT_HISTORY",requestId:current.requestId,event:"applied",style,reply:text}).catch(()=>{});
  }
  async function copy(current,draft,style){
    if(!validDraft(current,draft))return;
    try{await navigator.clipboard.writeText(draft.trim());current.panel.report("已复制。请检查后自行发送。");
      void chrome.runtime.sendMessage({type:"REPLY_COPILOT_HISTORY",requestId:current.requestId,event:"copied",style,reply:draft.trim()}).catch(()=>{});
    }catch{current.panel.report("复制失败，可以手动选择草稿文字。");}
  }
  function scan(){
    scheduled=false;
    if(awaiting){
      if(performance.now()-awaiting.since>10000){awaiting=null;if(!session)cleanup();return;}
      if(matchQuoteEditor(awaiting.post)){open(awaiting.post);return;}
    }
    if(session&&!matchQuoteEditor(session.post)){
      if(!closingTimeout)closingTimeout=setTimeout(()=>{closingTimeout=null;if(session&&!matchQuoteEditor(session.post))cleanup({cancel:true});},500);
    }else if(closingTimeout){clearTimeout(closingTimeout);closingTimeout=null;}
  }
  function queueScan(){if(scheduled)return;scheduled=true;queueMicrotask(scan);}
  function observe(){
    if(observer)return;
    observer=new MutationObserver(queueScan);
    observer.observe(document.documentElement,{childList:true,subtree:true});
    queueScan();
  }
  document.addEventListener("click",event=>{
    if(!event.isTrusted)return;
    const target=event.target;
    if(!(target instanceof Element))return;
    const button=target.closest(REPOST);
    if(button?.closest("article")){
      lastRepost={post:capturePost(button),since:performance.now()};
      return;
    }
    const item=target.closest('[role="menuitem"]');
    if(!item||!/\bquote\b|引用|引用推文|引用貼文|引用转发|kutip/i.test(normalize(item.textContent)))return;
    if(!lastRepost?.post||performance.now()-lastRepost.since>12000||session)return;
    // One trusted menu activation, one canonical source identity.
    awaiting={post:lastRepost.post,since:performance.now()};
    lastRepost=null;observe();
    setTimeout(()=>{if(awaiting&&performance.now()-awaiting.since>=10000)cleanup();},10100);
  },true);
})();
