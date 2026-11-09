// The website receives only a status. Device and session tokens stay in the extension.
export function matchesBindingSender({sender, message, websiteUrl, record}) {
  if (!record || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || record.tabId !== sender.tab.id ||
      !/^[A-F0-9]{8}$/.test(message?.deviceCode || "") || record.deviceCode !== message.deviceCode ||
      typeof record.proof !== "string" || record.proof !== message.proof || !(Date.parse(record.expiresAt) > Date.now())) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "https:" && url.origin === websiteUrl && /^\/account\/?$/.test(url.pathname) &&
      url.searchParams.get("device_code") === record.deviceCode;
  } catch { return false; }
}
