/** Public invite copy only. No API calls, rewards calculation or writes.
 * @param {string} link
 * @param {string} origin
 * @param {string} language
 */
export function buildReferralShareText(link, origin, language) {
  let url, site;
  try { url = new URL(link); site = new URL(origin); } catch { return ""; }
  if (!["http:", "https:"].includes(site.protocol) || url.origin !== site.origin ||
      url.username || url.password || url.hash || !/^\/login\/?$/.test(url.pathname)) return "";
  const params = url.searchParams;
  if ([...params.keys()].length !== 2 || params.getAll("mode").length !== 1 ||
      params.getAll("ref").length !== 1 || params.get("mode") !== "register" ||
      !/^[a-f0-9]{16}$/i.test(params.get("ref") || "")) return "";
  return language === "en"
    ? "x-Reply-Helper helps draft replies on X. You choose what to edit and send. If you want to try it, here’s my invite link:\n" + url.href
    : "分享一个 X 回复助手：x-Reply-Helper。它提供回复草稿，最终怎么改、发不发都由你决定。感兴趣可以用我的邀请链接试试：\n" + url.href;
}
