(() => {
  function findComposer(article) {
    const selectors = '[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]';
    let candidates = [...(article?.querySelectorAll?.(selectors) || [])];
    if (!candidates.length) candidates = [...(document.querySelector('[role="dialog"]')?.querySelectorAll?.(selectors) || [])];
    candidates = [...new Set(candidates)].filter((node) => node.isConnected && !node.closest('[aria-hidden="true"]'));
    return candidates.length === 1 ? candidates[0] : null;
  }
  function readText(editor) { return (editor?.innerText ?? editor?.textContent ?? "").replace(/\u00a0/g, " ").trim(); }
  function hasContent(editor) { return Boolean((editor?.innerText ?? editor?.textContent ?? "").replace(/\u00a0/g, " ")); }
  function focusEmpty(editor) {
    if (!editor?.isConnected || hasContent(editor)) return false;
    editor.focus();
    if (document.activeElement !== editor || hasContent(editor)) return false;
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
    const selection = window.getSelection();
    if (!isCurrent() || !editor?.isConnected || document.activeElement !== editor || hasContent(editor) || !selection?.isCollapsed || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return false;
    attempted.add(requestId);
    if (attempted.size > 1000) attempted.delete(attempted.values().next().value);
    try { return document.execCommand('insertText', false, text) === true; } catch { return false; }
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.composerAdapter = { findComposer, readText, hasContent, focusEmpty, insertOnce };
})();
