export function mountMomentumTesting(document) {
  const card=document.createElement('section');
  card.className='dashboard-card';
  card.innerHTML='<h2>提醒效果测试 · Staging</h2><label>预览阶段 <select aria-label="预览阶段"><option value="1">阶段 1</option><option value="2">阶段 2</option><option value="3">阶段 3</option></select></label><p>模拟下一次回复只测试门控，不调用 AI、不改活动计数、免打扰或提醒记录。</p><div class="dashboard-actions"><button type="button" class="button">在 X 页面预览提醒</button><button type="button" class="button secondary">模拟下一次回复触发</button><button type="button" class="button secondary">读取只读诊断</button></div><p role="status"></p><pre hidden style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
  const [preview,arm,diagnose]=card.querySelectorAll('button');
  const status=card.querySelector('[role=status]');
  const report=card.querySelector('pre');
  async function run(button,message) {
    button.disabled=true;
    try {
      if (message.type === 'MOMENTUM_STAGING_PREVIEW' || message.type === 'MOMENTUM_STAGING_ARM_NEXT_REPLY') {
        const [activeTab] = await chrome.tabs.query({active:true,currentWindow:true});
        message = {...message,windowId:activeTab?.windowId};
      }
      const result=await chrome.runtime.sendMessage(message);
      status.textContent=result?.ok ? (result.diagnostic?'已读取本机诊断。':result.armed?'已设置：下一次在 X 点击「回复」时触发一次隔离门控；关闭后不调用 AI。':'已在 X 回复浮窗显示测试提醒。') : result?.error || '测试不可用，请重试。';
      if (result?.diagnostic) {
        report.textContent=JSON.stringify(result.diagnostic,null,2);
        report.hidden=false;
      }
    } catch { status.textContent='测试不可用，请重试。'; }
    finally {button.disabled=false;}
  }
  preview.onclick=()=>void run(preview,{type:'MOMENTUM_STAGING_PREVIEW',stage:Number(card.querySelector('select').value)});
  arm.onclick=()=>void run(arm,{type:'MOMENTUM_STAGING_ARM_NEXT_REPLY',stage:Number(card.querySelector('select').value)});
  diagnose.onclick=()=>void run(diagnose,{type:'MOMENTUM_STAGING_DIAGNOSE'});
  document.getElementById('momentum-control')?.after(card);
}
