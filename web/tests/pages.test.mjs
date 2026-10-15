import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = (name) => readFileSync(path.join(root, "dist", name === "index" ? "index.html" : `${name}/index.html`), "utf8");

test("all required pages build as static HTML", () => {
  for (const name of ["index", "pricing", "faq", "guide", "privacy", "terms", "refunds", "login", "account", "feedback"]) {
    assert.ok(existsSync(path.join(root, "dist", name === "index" ? "index.html" : `${name}/index.html`)), name);
  }
});
test("pricing is accurate and does not expose a fake checkout", () => {
  const html = page("pricing");
  assert.match(html, /Seven consecutive days from email verification/);
  assert.match(html, /30 generations per day|Up to 30 generations per day/);
  assert.match(html, /\$10/);
  assert.match(html, /\$15/);
  assert.match(html, /does not include free lifetime AI API calls/);
  assert.match(html, /Payments have not launched|Payments have not launched|purchases are not available/);
});
test("language switch and responsive layout are present", () => {
  const html = page("index");
  const css = readFileSync(path.join(root, "src/styles/global.css"), "utf8");
  assert.match(html, /id="language-toggle"/);
  assert.match(html, /data-zh="每一次回复，都更像你。"/);
  assert.match(html, /replyCopilotLanguage/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /\.grid-span-2 \{ grid-column: auto; \}/);
});
test("account page requests protected data from the API", () => {
  const source = readFileSync(path.join(root, "src/pages/account.astro"), "utf8");
  for (const endpoint of ["/v1/me", "/v1/entitlements", "/v1/usage", "/v1/license/devices"]) assert.ok(source.includes(endpoint));
  assert.match(source, /error\.status === 401/);
});
