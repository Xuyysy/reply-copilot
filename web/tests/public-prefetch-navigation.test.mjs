import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("public informational pages get selective navigation prefetch; auth and checkout stay native", () => {
  const config = read("web/astro.config.mjs");
  const layout = read("web/src/layouts/Base.astro");
  assert.match(config, /prefetch:\s*\{\s*prefetchAll:\s*false,\s*defaultStrategy:\s*"hover"\s*\}/);
  assert.doesNotMatch(layout, /ClientRouter|ViewTransitions/);
  for (const name of ["guide", "pricing", "faq"]) {
    assert.match(layout, new RegExp('data-nav-id="'+name+'" href="/'+name+'" data-astro-prefetch="hover"'));
    assert.match(layout, new RegExp('<a href="/'+name+'" data-astro-prefetch="hover"'));
  }
  for (const name of ["login", "account", "checkout", "admin"]) {
    assert.doesNotMatch(layout, new RegExp('href="/'+name+'"[^>]*data-astro-prefetch'));
  }
  assert.doesNotMatch(config, /prefetchAll:\s*true/);
  assert.doesNotMatch(config, /clientPrerender/);
});
