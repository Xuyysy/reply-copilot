const extensionIds: Record<string, string> = {
  "https://app.x-reply-helper.top": "fgfjajofkapebgphfidblngcjomkbdaj",
  "https://staging.x-reply-helper.top": "kaaehkpihjenlhjjfjcopkjhegmfmchk",
};
const proofPattern = /^[a-f0-9-]{36}$/i;
export function readBindingProof(code: string | null) {
  if (!code || typeof window === "undefined") return null;
  try {
    const key = `xrh-binding:${code}`;
    const hash = new URLSearchParams(location.hash.slice(1));
    const proof = hash.get("binding");
    if (proof && proofPattern.test(proof)) {
      sessionStorage.setItem(key, proof);
      const url = new URL(location.href);
      url.hash = "";
      history.replaceState(history.state, "", url);
      return proof;
    }
    return sessionStorage.getItem(key);
  } catch { return null; }
}

export async function bindingMessage(type: "XRH_BINDING_VERIFY" | "XRH_BINDING_STATUS", deviceCode: string, proof: string, userId: string) {
  const id = extensionIds[location.origin];
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: {
    sendMessage?: (id: string, value: object, callback: (reply?: {status?: string}) => void) => void;
    lastError?: unknown;
  } } }).chrome?.runtime;
  if (!id || !runtime?.sendMessage || !proofPattern.test(proof)) return "unavailable";
  return new Promise<string>(resolve => {
    const timer = setTimeout(() => resolve("network_error"), 3500);
    try {
      runtime.sendMessage!(id, {type,deviceCode,proof,userId}, reply => {
        clearTimeout(timer);
        resolve(runtime.lastError ? "unavailable" : reply?.status || "unavailable");
      });
    } catch { clearTimeout(timer); resolve("unavailable"); }
  });
}
