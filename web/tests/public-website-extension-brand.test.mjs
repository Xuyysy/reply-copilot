import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Keep website styling tied to the Chrome extension's existing Design System V1.
// Intentional public-only styling: account, pricing and landing pages share it;
// the /admin page is explicitly excluded.
const read = (name) => readFileSync(name, "utf8");
const extension = read("content/design-tokens.css");
const site = read("web/src/styles/global.css");
const layout = read("web/src/layouts/Base.astro");
const home = read("web/src/pages/index.astro");

test("public site uses exact extension brand and PRO colors", () => {
  for (const [token, hex] of Object.entries({
    "--xrh-brand": "#315be8",
    "--xrh-ink": "#17233c",
    "--xrh-muted": "#65758e",
    "--xrh-canvas": "#f6f8fc",
    "--xrh-surface": "#ffffff",
    "--xrh-pro-surface": "#eef4ff",
    "--xrh-pro-line": "#cbd9f9",
  })) {
    const extensionHex = token === "--xrh-surface" ? "#ffffff" : hex;
    assert.match(extension.toLowerCase(), new RegExp(token + "\\s*:\\s*" + extensionHex.toLowerCase()), token + " must exist in the extension");
    const webHex = token === "--xrh-surface" ? "#fff" : hex;
    assert.match(site.toLowerCase(), new RegExp(token + "\\s*:\\s*" + webHex.toLowerCase()), token + " must match the extension");
  }
  assert.match(site, /\.public-refresh \.home-hero \{/);
  assert.match(site, /\.public-refresh \.momentum-showcase \{/);
  assert.match(site, /background:var\(--xrh-pro-surface\)/);
});

test("redesign stays out of administrator views and preserves browser navigation", () => {
  assert.match(layout, /const isAdminPage = Astro\.url\.pathname\.startsWith\("\/admin"\)/);
  assert.match(layout, /"public-refresh": !isAdminPage/);
  assert.match(layout, /<main id="site-main"><slot \/><\/main>/);
  assert.match(layout, /<details class="mobile-nav">/);
  assert.doesNotMatch(layout, /ClientRouter|ViewTransitions/);
});

test("home preserves dynamic account, package, CMS and bilingual momentum story", () => {
  assert.match(home, /id="creator-momentum"/);
  assert.match(home, /data-site-text="homeTitle"/);
  assert.match(home, /data-account-cta/);
  assert.match(home, /renderFeaturedPackages/);
  assert.match(home, /\/v1\/packages/);
  assert.match(home, /我认为，原创帖的传播机会/);
  assert.match(home, /我将这种互动积累过程中/);
  assert.match(home, /互动是蓄势，临界是信号，原创是释放。/);
  assert.match(home, /Engagement builds momentum\. Thresholds signal opportunity/);
  assert.match(home, /role="img"/);
});

test("momentum-first first-fold replaces generic reply hero while retaining CMS and pricing", () => {
  const firstFold = home.indexOf('<section id="creator-momentum" class="momentum-v2-landing"');
  const replySection = home.indexOf('id="reply-assistant"');
  const formerGenericHero = home.indexOf('class="container hero home-hero"');
  const research = home.indexOf('id="momentum-framework"');
  assert.ok(firstFold > 0 && firstFold < replySection, "Founder framework should lead the homepage");
  assert.ok(replySection < formerGenericHero && formerGenericHero < research, "Reply assistant becomes a secondary product showcase");
  assert.equal((home.match(/id="creator-momentum"/g) || []).length, 1);
  assert.match(home, /id="momentum-v2-title"/);
  assert.match(home, /momentum-v2-chart/);
  // Both core capabilities need to be present in the FIRST visual workspace,
  // not one full-screen promotional hero followed by the other.
  const firstFoldEnd = home.indexOf('id="reply-assistant"');
  const firstFoldSource = home.slice(firstFold, firstFoldEnd);
  assert.match(firstFoldSource, /momentum-v2-reply-module/);
  assert.match(firstFoldSource, /AI REPLY ASSISTANT/);
  assert.match(firstFoldSource, /data-zh="示意草稿 · 由你确认发送"/);
  assert.match(firstFoldSource, /data-zh="AI 回复助手 · 实用功能"/);
  assert.match(firstFoldSource, /href="\/login\?mode=register" class="button momentum-v2-primary"/);
  assert.match(firstFoldSource, /href="#momentum-framework" class="button secondary momentum-v2-secondary"/);

  assert.match(home, /数据/); // research copy is retained with the narrative below
  assert.match(home, /data-site-text="homeTitle"/);
  assert.match(home, /data-account-cta/);
  assert.match(home, /renderFeaturedPackages/);
  assert.match(home, /\/v1\/packages/);
  const layout = read("web/src/layouts/Base.astro");
  assert.match(layout, /!isAdminPage && <a data-nav-id="momentum-terminal" class="momentum-terminal-entry"/);
  assert.match(site, /\.public-refresh \.momentum-v2-landing/);
  assert.match(site, /\.public-refresh \.momentum-v2-device/);
});
