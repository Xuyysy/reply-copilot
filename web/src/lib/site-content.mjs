import {isXTutorialUrl} from '../../../utils/x-tutorial-url.js';
// Public configuration is plain text. External links are independently checked here.
export function safeSiteLink(value, kind) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    if (kind === "xTutorialUrl") return isXTutorialUrl(value) ? new URL(value).href : "";
    const url = new URL(value);
    const hosts = kind === "xProfileUrl" ? ["x.com", "www.x.com"] : ["chromewebstore.google.com"];
    const pathAllowed = kind === "xProfileUrl" ? /^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname) : /^\/detail\/(?:[^/]+\/)?[a-p]{32}\/?$/.test(url.pathname);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !pathAllowed || !hosts.includes(url.hostname)) return "";
    return url.href;
  } catch { return ""; }
}
export function safeSupportEmail(value) {
  return typeof value === "string" && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value) ? value : "";
}
export function createSiteContentLoader(fetchContent) {
  let pending;
  return (refresh = false) => {
    if (refresh) pending = undefined;
    return pending ||= Promise.resolve().then(fetchContent).then(result => result?.content || {}).catch(() => ({}));
  };
}
export function applySiteContent(document, content, language) {
  const suffix = language === "en" ? "En" : "Zh";
  document.querySelectorAll("[data-site-text]").forEach(element => {
    if (element.dataset.siteDynamicText === "true") return;
    const key = element.dataset.siteText;
    // Keep the original translation for either missing locale.
    if (element.dataset.siteFallbackZh === undefined) {
      element.dataset.siteFallbackZh = element.dataset.zh || "";
      element.dataset.siteFallbackEn = element.dataset.en || element.textContent || "";
    }
    const zh = typeof content[key + "Zh"] === "string" && content[key + "Zh"].trim() ? content[key + "Zh"] : element.dataset.siteFallbackZh;
    const en = typeof content[key + "En"] === "string" && content[key + "En"].trim() ? content[key + "En"] : element.dataset.siteFallbackEn;
    element.dataset.zh = zh; element.dataset.en = en;
    element.textContent = suffix === "En" ? en : zh;
    element.hidden = !element.textContent;
  });
  document.querySelectorAll("[data-site-faq-default]").forEach(element => {
    const customFaq = content["faq" + suffix];
    element.hidden = typeof customFaq === "string" && Boolean(customFaq.trim());
  });
  document.querySelectorAll("[data-site-link]").forEach(element => {
    const href = safeSiteLink(content[element.dataset.siteLink], element.dataset.siteLink);
    if (element.dataset.siteHideIfEmpty === "true") element.hidden = !href;
    if (href) { element.setAttribute("href", href); element.removeAttribute("aria-disabled"); }
    else { element.removeAttribute("href"); element.setAttribute("aria-disabled", "true"); }
  });
  const customPrimary = document.querySelector?.("[data-site-primary]");
  if (customPrimary) {
    const customText = content["homeCta" + suffix];
    const enabled = typeof customText === "string" && Boolean(customText.trim());
    customPrimary.hidden = !enabled;
    customPrimary.setAttribute("href", safeCtaLink(content.homeCtaHref) || "/guide");
    document.querySelectorAll("[data-default-primary]").forEach(element => { element.dataset.sitePrimaryOverride = enabled ? "true" : "false"; });
    document.dispatchEvent?.(new Event("reply-copilot-primary-cta"));
  }
  document.querySelectorAll("[data-site-internal]").forEach(element => {
    if (!element.dataset.siteDefaultHref) element.dataset.siteDefaultHref = element.getAttribute("href") || "/guide";
    element.setAttribute("href", safeInternalLink(content[element.dataset.siteInternal]) || element.dataset.siteDefaultHref);
  });
  const nav = document.querySelector?.("[data-site-navigation]");
  if (nav) siteNavigation(content).forEach(item => {
    const element = nav.querySelector(`[data-nav-id="${item.id}"]`);
    if (!element) return;
    element.hidden = item.visible === false;
    element.style.order = String(item.sortOrder);
    nav.append(element);
    element.textContent = language === "en" ? item.labelEn : item.labelZh;
    if (item.href) { element.setAttribute("href",item.href); element.removeAttribute("aria-disabled"); }
    else { element.removeAttribute("href"); element.setAttribute("aria-disabled","true"); }
  });
  document.querySelectorAll("[data-site-email]").forEach(element => {
    const email = safeSupportEmail(content.supportEmail);
    element.hidden = !email; element.textContent = email;
    if (email) element.setAttribute("href", `mailto:${email}`); else element.removeAttribute("href");
  });
}
export const DEFAULT_NAVIGATION = [
  {id:'x',labelZh:'我的 X',labelEn:'My X',href:'',visible:true,sortOrder:0},
  {id:'install',labelZh:'安装插件',labelEn:'Install',href:'',visible:true,sortOrder:1},
  {id:'guide',labelZh:'使用指南',labelEn:'Guide',href:'/guide',visible:true,sortOrder:2},
  {id:'pricing',labelZh:'价格',labelEn:'Pricing',href:'/pricing',visible:true,sortOrder:3},
  {id:'faq',labelZh:'常见问题',labelEn:'FAQ',href:'/faq',visible:true,sortOrder:4},
];
export function safeInternalLink(value) { return ['/','/guide','/pricing','/faq','/privacy','/terms','/refunds','/feedback'].includes(value) ? value : ''; }
export function siteNavigation(content) {
 const source=Array.isArray(content.navigation)?content.navigation:DEFAULT_NAVIGATION;
 return DEFAULT_NAVIGATION.map(fallback=>{const item=source.find(entry=>entry?.id===fallback.id)||fallback;const externalKey=item.id==='x'?'xProfileUrl':item.id==='install'?'chromeStoreUrl':'';const href=externalKey?safeSiteLink(item.href||content[externalKey],externalKey):safeInternalLink(item.href);return {...fallback,...item,href,sortOrder:Number.isInteger(item.sortOrder)?item.sortOrder:fallback.sortOrder};}).sort((a,b)=>a.sortOrder-b.sortOrder||DEFAULT_NAVIGATION.findIndex(n=>n.id===a.id)-DEFAULT_NAVIGATION.findIndex(n=>n.id===b.id));
}

export function safeCtaLink(value) { return ['/login','/login?mode=register','/login?mode=login','/account'].includes(value) ? value : safeInternalLink(value); }

export function shouldHideAccountCta(accountState, override) { return accountState === 'loading' || accountState === 'error' || override === 'true'; }
