/**
 * Public hero CTA uses the Base layout's existing authenticated /v1/me result.
 * Unknown or failed checks must never guess that a signed-in user is a guest.
 * /account/ already provides a safe signed-out sign-in entry.
 */
export function replyAssistantCta(accountState,language="zh") {
 const guest=accountState==="guest";
 const authenticated=["ready","pending","empty"].includes(accountState);
 const english=language==="en";
 return {
  href:guest?"/login?mode=register":"/account/",
  label:authenticated
    ?english?"Open AI reply assistant":"进入 AI 回复助手"
    :english?"Start with AI replies":"免费体验 AI 回复助手"
 };
}
