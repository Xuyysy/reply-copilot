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
  if (/Failed to fetch|NetworkError|网络连接失败/i.test(message)) return phrase(language, "未能连接云端服务，可能与网络或浏览器访问限制有关，请检查连接后重试。", "Could not reach the cloud service. Check your connection or browser access restrictions and retry.");
  if (language === "en" && error instanceof ApiError) {
    const known: Record<string, string> = { API_NETWORK_ERROR:"Could not reach the cloud service. The browser cannot distinguish a network issue from an access restriction.", API_TIMEOUT:"The request timed out. Its processing status is unknown; avoid repeated submissions.", API_CANCELLED:"The request was cancelled.", HTTP_ERROR:`The service returned HTTP ${error.status}. Please try later.`, TURNSTILE_REQUIRED:"Complete verification first.", TURNSTILE_INVALID:"Verification was rejected. Please verify again.", TURNSTILE_UNAVAILABLE:"Verification is temporarily unavailable. Please retry later.", TURNSTILE_NOT_CONFIGURED:"Verification is unavailable. Please contact support.", RATE_LIMITED:"Too many requests. Please wait before retrying.", MAIL_UNAVAILABLE:"The verification email could not be confirmed. Please check your inbox before retrying.", INVALID_CREDENTIALS: "Incorrect email or password.", TOO_MANY_REQUESTS: "Too many requests. Please try again later.", UNAUTHORIZED: "Please sign in again.", FORBIDDEN: "You do not have access to this action.", INSUFFICIENT_CREDITS: "Not enough credits.", INVALID_TURNSTILE: "Verification failed. Please try again.", INVALID_CODE: "The code is incorrect or expired." };
    return known[error.code] || "Request failed. Please check your details and try again.";
  }
  return message || phrase(language, "操作失败，请稍后重试。", "Something went wrong. Please retry.");
}
