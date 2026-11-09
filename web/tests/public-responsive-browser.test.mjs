import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMomentumBrowser } from "../../tests/helpers/momentum-browser.js";

// Test ACTUAL built Astro markup/styles in headless Chrome, no live API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = path.join(root, "dist", "_astro");
const css = readdirSync(assetDir).filter(f => f.endsWith(".css"))
  .map(f => readFileSync(path.join(assetDir, f), "utf8")).join("\n");

function staticFixture(route) {
  const file = path.join(root, "dist", ...(route === "index" ? ["index.html"] : [route, "index.html"]));
  const html = readFileSync(file, "utf8");
  const body = html.match(/<body\b[^>]*>[\s\S]*?<\/body>/i)?.[0];
  assert.ok(body, "Missing built body for "+route);
  // Isolate rendered structure. Auth/payment behavior has separate browser tests.
  const safeBody = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  return '<html lang="zh-CN"><head><meta charset="utf-8"><style>'
    + css.replaceAll("</style", "<\\/style") + '</style></head>'
    + safeBody + '<script>window.momentumReady=true</script></html>';
}

const routes = ["index", "guide", "login", "account", "faq", "feedback", "pricing", "checkout", "privacy", "terms", "refunds"];

test("real built user pages fit phone, tablet and desktop viewports", { timeout: 180_000 }, async () => {
  for (const route of routes) {
    await withMomentumBrowser(staticFixture(route), async ({ evaluate, call }) => {
      assert.equal(await evaluate("document.body.classList.contains('public-refresh')"), true, route+": public theme");
      for (const width of [320, 375, 768, 1280]) {
        await call("Emulation.setDeviceMetricsOverride", {
          width, height: 850, deviceScaleFactor: 1, mobile: width <= 768
        });
        const result = await evaluate("({html:document.documentElement.scrollWidth,body:document.body.scrollWidth,view:innerWidth,main:!!document.querySelector('#site-main'),nav:getComputedStyle(document.querySelector('.mobile-nav')).display})");
        assert.ok(result.html <= result.view + 1, route+"@"+width+": html overflows "+JSON.stringify(result));
        assert.ok(result.body <= result.view + 1, route+"@"+width+": body overflows "+JSON.stringify(result));
        assert.ok(result.main, route+": missing accessible main landmark");
        assert.equal(result.nav === "none", width > 820, route+"@"+width+": mobile nav");
      }
      if (route === "index") {
        assert.equal(await evaluate('Boolean(document.querySelector("#creator-momentum .momentum-curve"))'), true);
        assert.match(await evaluate('document.querySelector(".momentum-signature").dataset.zh'), /互动是蓄势/);
      }
      if (route === "faq") {
        assert.equal(await evaluate("document.querySelectorAll('.public-faq-item').length"), 6);
        assert.equal(await evaluate("document.querySelector('.public-faq-item').open"), true);
      }
    });
  }
});
