(() => {
  const isTextarea=editor=>editor?.localName==='textarea';
  const writableTextarea=editor=>isTextarea(editor)&&!editor.disabled&&!editor.readOnly&&
    Boolean(editor.getAttribute('aria-label'))&&
    editor.getAttribute('aria-disabled')!=='true'&&editor.getAttribute('aria-readonly')!=='true'&&
    !editor.closest?.('[aria-hidden="true"],[hidden],[inert]');
  function findComposer(article) {
    const selectors = '[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]';
    let candidates = [...(article?.querySelectorAll?.(selectors) || [])];
    if (!candidates.length) candidates = [...(document.querySelector('[role="dialog"]')?.querySelectorAll?.(selectors) || [])];
    candidates = [...new Set(candidates)].filter((node) => node.isConnected && !node.closest('[aria-hidden="true"]'));
    return candidates.length === 1 ? candidates[0] : null;
  }
  function readText(editor) { return (isTextarea(editor)?editor.value:(editor?.innerText ?? editor?.textContent ?? "")).replace(/\u00a0/g, " ").trim(); }
  function modernDraftMedia(editor) {
    const dialog=editor.closest?.('[role="dialog"]');
    const scope=editor.closest?.('form')||dialog;
    if(!scope)return false;
    // Native draft attachments are outside the textarea. Never count the
    // original post preview BEFORE the editor or the extension's own UI.
    for(const node of scope.querySelectorAll('input[type="file"],[data-testid="attachments"],img[src^="blob:"],video[src^="blob:"],img[src*="pbs.twimg.com/media/"],[data-slot="embedded-tweet-frame"]')){
      if(node.closest('[data-zane-reply-copilot]')||node.closest('[role="dialog"]')!==dialog)continue;
      if(node.localName==='input'){if(node.files?.length)return true;continue;}
      if(!(editor.compareDocumentPosition(node)&4))continue;
      if(node.getAttribute('data-testid')==='attachments'&&!node.children.length)continue;
      if(!node.closest('[hidden],[aria-hidden="true"],[inert]'))return true;
    }
    return false;
  }
  function verifyReadback(editor,text) {
    if(readText(editor)!==text.trim())return false;
    if(!isTextarea(editor))return true;
    // XDS may display its controlled value in an aria-hidden mirror with
    // transparent textarea ink. Require that visual representation too
    // when the transparent native-editor pattern is present.
    const color=editor.ownerDocument.defaultView.getComputedStyle(editor).color;
    if(color!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color))return true;
    const mirrors=[...(editor.parentElement?.children||[])].filter(node=>{
      if(node===editor||node.getAttribute('aria-hidden')!=='true')return false;
      const ws=editor.ownerDocument.defaultView.getComputedStyle(node).whiteSpace;
      return ['pre-wrap','pre-line','break-spaces'].includes(ws)||node.classList.contains('whitespace-pre-wrap');
    });
    return mirrors.length===1&&(mirrors[0].innerText||mirrors[0].textContent||'').replace(/\u00a0/g,' ').trim()===text.trim();
  }
  function hasContent(editor) {
    if(isTextarea(editor)&&modernDraftMedia(editor))return true;
    if (editor?.querySelector?.('img,video,[data-testid="attachments"]')) return true;
    const raw=isTextarea(editor)?editor.value:(editor?.innerText ?? editor?.textContent ?? "");
    // X/Draft.js's pristine editor renders a single BR as a layout newline.
    // Do not trim arbitrary whitespace: a user's spaces or extra blank lines are drafts.
    if (raw==="\n" && editor.textContent==="" && editor.querySelectorAll?.('br').length===1) return false;
    return Boolean(raw.replace(/\u00a0/g," "));
  }
  function focusEmpty(editor) {
    if (!editor?.isConnected || hasContent(editor) || (isTextarea(editor)&&!writableTextarea(editor))) return false;
    editor.focus();
    if (document.activeElement !== editor || hasContent(editor)) return false;
    if(isTextarea(editor)){
      try{editor.setSelectionRange(0,0);return editor.selectionStart===0&&editor.selectionEnd===0;}catch{return false;}
    }
    const selection = window.getSelection();
    if (!selection) return false;
    if (!editor.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return editor.contains(selection.anchorNode);
  }

  const attempted = new Set();
  function insertOnce(editor, requestId, text, isCurrent) {
    if (typeof requestId !== 'string' || !requestId || attempted.has(requestId) || typeof text !== 'string' || !text.trim() || typeof isCurrent !== 'function') return false;
    if(isTextarea(editor)){
      // The caller supplies the same verified, current reply-session fence.
      // Use native textarea value semantics, never mutate contenteditable.
      if(!isCurrent()||!editor.isConnected||!writableTextarea(editor)||
         document.activeElement!==editor||hasContent(editor)||
         editor.selectionStart!==0||editor.selectionEnd!==0||
         (editor.maxLength>=0&&text.length>editor.maxLength))return false;
      attempted.add(requestId);
      if(attempted.size>1000)attempted.delete(attempted.values().next().value);
      try{
        const view=editor.ownerDocument.defaultView;
        const setter=Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype,'value')?.set;
        if(!setter||!isCurrent()||!writableTextarea(editor)||hasContent(editor)||document.activeElement!==editor)return false;
        setter.call(editor,text);
        editor.dispatchEvent(new view.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:text}));
        return editor.value===text;
      }catch{return false;}
    }
    const selection = window.getSelection();
    if (!isCurrent() || !editor?.isConnected || document.activeElement !== editor || hasContent(editor) || !selection?.isCollapsed || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return false;
    attempted.add(requestId);
    if (attempted.size > 1000) attempted.delete(attempted.values().next().value);
    try {
      const data=new DataTransfer();data.setData('text/plain',text);
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,composed:true,clipboardData:data});
      // The page's public paste handler must accept this event. There is no
      // browser default insertion for synthetic paste and no second strategy.
      editor.dispatchEvent(event);
      return event.defaultPrevented;
    } catch { return false; }
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.composerAdapter = { findComposer, readText, hasContent, focusEmpty, insertOnce, verifyReadback };
})();
