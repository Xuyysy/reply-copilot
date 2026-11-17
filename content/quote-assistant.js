(() => {
  // Isolated, user-controlled UI. Never clicks X's Post button.
  function mount({ onGenerate, onInsert, onCopy, onClose }) {
    const host = document.createElement("div");
    host.setAttribute("data-reply-copilot-quote-ui", "1");
    host.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483001;width:min(420px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;";
    const shadow = host.attachShadow({mode:"open"});
    const style = document.createElement("style");
    style.textContent = [
      ":host{all:initial;font:14px/1.5 system-ui,sans-serif;}",
      "section{box-sizing:border-box;background:#fff;color:#17233c;border:1px solid #cbd9f9;border-radius:16px;box-shadow:0 15px 50px #152b4a38;padding:16px;}",
      ".head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;}strong{font-size:15px;}",
      ".small{font-size:12px;color:#65758e;}.status{font-size:12px;color:#415270;margin:8px 0;}button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid #cbd9f9;padding:8px 10px;background:white;color:#17233c;}",
      "button.primary{background:#315be8;color:#fff;border-color:#315be8;font-weight:700;}button:hover{filter:brightness(.94)}button:focus-visible,textarea:focus-visible{outline:3px solid #8ea6fb;outline-offset:2px;}",
      "button:disabled{opacity:.5;cursor:default}.controls,.styles{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.styles button[aria-pressed=true]{background:#eef4ff;border-color:#315be8;color:#294bbf;font-weight:700;}",
      "textarea{box-sizing:border-box;width:100%;min-height:96px;resize:vertical;border:1px solid #cbd9f9;border-radius:10px;padding:10px;background:#fff;color:#17233c;font:14px/1.6 system-ui,sans-serif;}",
      "[hidden]{display:none!important}.close{border:0;background:transparent;font-size:20px;padding:0 6px;}.note{font-size:11px;color:#65758e;}"
    ].join("\n");
    const section = document.createElement("section");
    section.setAttribute("role","region");
    section.setAttribute("aria-label","AI Quote 引用创作助手");
    section.innerHTML = '<div class="head"><strong>✦ AI Quote · 引用创作</strong><button type="button" class="close" data-action="close" aria-label="关闭 AI Quote">×</button></div><div class="small">在自己的时间线上发表观点，而不是回复原作者</div><p class="status" role="status" aria-live="polite">已识别引用帖子。点击生成获得三种独立观点。</p><button type="button" class="primary" data-action="generate">生成 AI Quote</button><div class="output" hidden><div class="styles" role="group" aria-label="引用文案风格"><button type="button" data-style="natural">自然</button><button type="button" data-style="light_humor">幽默</button><button type="button" data-style="thoughtful">观点</button></div><label class="small" for="quote-draft">引用文案（可编辑）</label><textarea id="quote-draft" aria-label="可编辑的 Quote 草稿"></textarea><div class="controls"><button type="button" class="primary" data-action="insert">填入 X Quote</button><button type="button" data-action="copy">复制</button></div><p class="note">只填入草稿，不自动发布。你可以在 X 中继续编辑，最后自行点击 Post。</p></div>';
    shadow.append(style,section);
    document.documentElement.append(host);
    const $ = selector => section.querySelector(selector);
    const status=$(".status"),generate=$('[data-action="generate"]'),textarea=$("textarea");
    const draftMap={}; let selected="natural",ready=false,busy=false;
    function report(text){status.textContent=String(text||"");}
    function select(key){
      if(!ready||!Object.hasOwn(draftMap,key))return;
      if(Object.hasOwn(draftMap,selected))draftMap[selected]=textarea.value;
      selected=key; textarea.value=draftMap[key];
      for(const b of section.querySelectorAll("[data-style]"))b.setAttribute("aria-pressed",String(b.dataset.style===key));
    }
    function setBusy(value){busy=Boolean(value);generate.disabled=busy;for(const b of section.querySelectorAll('[data-action="insert"],[data-action="copy"]'))b.disabled=busy;}
    function showResults(replies,preferred){
      for(const key of ["natural","light_humor","thoughtful"]){
        if(typeof replies?.[key]!=="string"||!replies[key].trim()){report("AI 返回的引用文案不完整。");return;}
        draftMap[key]=replies[key].trim();
      }
      ready=true;
      // select() stores the old textarea only when a previous batch was ready.
      selected="natural";textarea.value=draftMap.natural;
      $(".output").hidden=false;
      select(["natural","light_humor","thoughtful"].includes(preferred)?preferred:"natural");
      report("已生成 3 条引用文案。选择、修改后再填入。");
    }
    for(const b of section.querySelectorAll("[data-style]"))b.addEventListener("click",()=>select(b.dataset.style));
    generate.addEventListener("click",()=>{if(!busy)void onGenerate();});
    $('[data-action="insert"]').addEventListener("click",()=>{if(ready&&!busy)void onInsert(textarea.value,selected);});
    $('[data-action="copy"]').addEventListener("click",()=>{if(ready&&!busy)void onCopy(textarea.value,selected);});
    $('[data-action="close"]').addEventListener("click",()=>{host.remove();onClose();});
    return {host,report,setBusy,showResults,close:()=>host.remove(),get ready(){return ready;}};
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.quoteAssistant={mount};
})();
