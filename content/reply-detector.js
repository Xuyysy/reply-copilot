(() => {
  // X exposes stable data-testid=reply even when the UI is localized.
  const labels = new Set([
    "reply", "回复", "回覆", "返信", "답글", "답글 달기",
    "responder", "répondre", "antworten", "rispondi", "ответить",
    "رد", "balas", "trả lời", "ตอบกลับ", "yanıtla", "जवाब दें",
    "odpowiedz", "beantwoorden", "відповісти"
  ]);
  function isReplyControl(element) {
    if (!element?.matches?.('button,[role="button"],a')) return false;
    if (element.getAttribute("data-testid") === "reply") return true;
    // Exact UI labels only: never treat "Replying to", a user bio, or a
    // nearby translation/action menu as a reply click.
    for (const label of [element.getAttribute("aria-label"), element.innerText || element.textContent]) {
      const normalized = (label || "").normalize("NFKC").trim().toLocaleLowerCase();
      if (labels.has(normalized) || /^reply\s+\d+(?:[.,]\d+)?$/i.test(normalized)) return true;
    }
    return false;
  }
  function findReplyControl(target, event) {
    // Preserve the original element API for existing callers. Only when the
    // event target is retargeted by translation/shadow wrappers, inspect the
    // original browser event's composed path for a verified X Reply control.
    const direct=target?.closest?.('button,[role="button"],a');
    if(isReplyControl(direct))return direct;
    const path=typeof event?.composedPath==="function" ? event.composedPath():[];
    for(const node of path) {
      const control=node?.closest?.('button,[role="button"],a');
      if(isReplyControl(control))return control;
    }
    return null;
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.replyDetector = { isReplyControl, findReplyControl };
})();
