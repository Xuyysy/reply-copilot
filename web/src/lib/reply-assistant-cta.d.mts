export type ReplyAssistantAccountState = "loading" | "guest" | "ready" | "pending" | "empty" | "error";
export type ReplyAssistantCta = { href: string; label: string };
export declare function replyAssistantCta(
  accountState: ReplyAssistantAccountState,
  language?: "zh" | "en"
): ReplyAssistantCta;
