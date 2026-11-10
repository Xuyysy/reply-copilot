import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMomentumBrowser } from "../../tests/helpers/momentum-browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const css = readdirSync(path.join(dist, "_astro"))
  .filter(name => name.endsWith(".css"))
  .map(name => readFileSync(path.join(dist, "_astro", name), "utf8")).join("\n");

function built(route) {
  return readFileSync(path.join(dist, ...(route === "index" ? ["index.html"] : [route, "index.html"])), "utf8");
}

function fixture(route, language) {
  const html = built(route);
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(match => match[0]);
  const headLocale = scripts.find(script => script.includes('localStorage.getItem("replyCopilotLanguage")'));
  const bootstrap = scripts.find(script => script.includes("data-language-bootstrap"));
  assert.ok(headLocale, route + ": early locale preference must be inline");
  assert.ok(bootstrap, route + ": pre-paint language bootstrap must be inline");
  assert.ok(html.includes("html:not([data-language-ready]) body"), route + ": page must be hidden before first language pass");
  // Strip async modules and live network calls so this fixture only exercises first paint.
  let safe = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const pref = '<script>Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem(key){return key==="replyCopilotLanguage"?' + JSON.stringify(language==="en"?"en":null) + ':null},setItem(){}}});</script>';
  safe = safe.replace("<head>", "<head>" + pref + headLocale + "<style>" + css.replaceAll("</style", "<\\/style") + "</style>");
  const probe = '<script>window.beforeLocale={visibility:getComputedStyle(document.body).visibility,guide:document.querySelector(\'[data-nav-id="guide"] span\')?.textContent};</script>';
  safe = safe.replace("</body>", probe + bootstrap + "<script>window.momentumReady=true;</script></body>");
  return safe;
}

test("public pages localize before the first visible paint in Chinese and English", { timeout: 120_000 }, async () => {
  for (const language of ["zh", "en"]) {
    for (const route of ["index", "guide", "pricing", "faq"]) {
      await withMomentumBrowser(fixture(route, language), async ({ evaluate }) => {
        const result = await evaluate(`({
          before:window.beforeLocale,
          visible:getComputedStyle(document.body).visibility,
          ready:document.documentElement.hasAttribute("data-language-ready"),
          lang:document.documentElement.lang,
          label:document.querySelector('[data-nav-id="guide"] span')?.textContent,
          english:document.querySelector('[data-nav-id="guide"] span')?.dataset.en,
          toggle:document.getElementById("language-toggle")?.textContent,
          title:document.title
        })`);
        assert.equal(result.before.visibility, "hidden", route + ": English must not paint before translation");
        assert.equal(result.before.guide, "Guide", route + ": fixture should begin with raw English HTML");
        assert.equal(result.visible, "visible", route + ": language bootstrap must reveal the page");
        assert.equal(result.ready, true, route + ": ready flag missing");
        assert.equal(result.lang, language === "zh" ? "zh-CN" : "en", route + ": browser preference ignored");
        assert.equal(result.label, language === "zh" ? "使用指南" : "Guide", route + ": wrong first visible language");
        assert.equal(result.english, "Guide", route + ": English toggle cache not preserved");
        assert.equal(result.toggle, language === "zh" ? "English" : "中文", route + ": toggle control not initialized");
        assert.ok(result.title.endsWith("x-Reply-Helper"), route + ": localized document title missing");
      });
    }
  }
});

test("all compiled routes contain the shared safe-language bootstrap", () => {
  for (const route of ["index", "guide", "pricing", "faq", "login", "account", "checkout", "feedback", "privacy", "terms", "refunds", "admin"]) {
    const html = built(route);
    assert.match(html, /data-language-bootstrap/, route + ": missing shared pre-paint initializer");
    assert.match(html, /data-language-ready/, route + ": missing first-paint guard");
    assert.match(html, /<noscript>/, route + ": no-JavaScript fallback must stay visible");
  }
});
