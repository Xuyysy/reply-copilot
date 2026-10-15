import { useEffect, useState } from "react";
import { ApiError } from "./api";

export type Language = "zh" | "en";
export const phrase = (language: Language, chinese: string, english: string) => language === "zh" ? chinese : english;

export function useLanguage(): Language {
  const [language, setLanguage] = useState<Language>("zh");
  useEffect(() => {
    const sync = () => setLanguage(document.documentElement.lang === "en" ? "en" : "zh");
    sync();
    window.addEventListener("reply-copilot-language", sync);
    return () => window.removeEventListener("reply-copilot-language", sync);
  }, []);
  return language;
}

export function readableError(error: unknown, language: Language) {
  const message = error instanceof Error ? error.message : "";
  if (/Failed to fetch|NetworkError|网络连接失败/i.test(message)) return phrase(language, "网络连接失败，请检查本地服务后重试。", "Network unavailable. Check the local service and retry.");
  if (language === "en" && error instanceof ApiError) {
    const known: Record<string, string> = { INVALID_CREDENTIALS: "Incorrect email or password.", TOO_MANY_REQUESTS: "Too many requests. Please try again later.", UNAUTHORIZED: "Please sign in again.", FORBIDDEN: "You do not have access to this action.", INSUFFICIENT_CREDITS: "Not enough credits.", INVALID_TURNSTILE: "Verification failed. Please try again.", INVALID_CODE: "The code is incorrect or expired." };
    return known[error.code] || "Request failed. Please check your details and try again.";
  }
  return message || phrase(language, "操作失败，请稍后重试。", "Something went wrong. Please retry.");
}
