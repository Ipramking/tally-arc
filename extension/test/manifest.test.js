const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root, chains } = require("./helpers");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const origin = (url) => new URL(url).origin;

test("manifest is MV3 with a semver version that matches package.json", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
});

test("every file the manifest references exists", () => {
  const files = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...(c.css || [])]),
  ];
  for (const file of files) assert.ok(exists(file), file);
});

test("least privilege: no API permissions, hosts are exactly the RPCs and the repo host", () => {
  assert.equal(manifest.permissions, undefined);
  const expected = [...new Set(chains.chains.map((c) => origin(c.rpcUrl) + "/*")), "https://raw.githubusercontent.com/*"];
  assert.deepEqual([...manifest.host_permissions].sort(), expected.sort());
  for (const pattern of [...manifest.host_permissions, ...manifest.content_scripts[0].matches]) {
    assert.doesNotMatch(pattern, /<all_urls>|\*:\/\/|http:\/\/|\/\/\*\./, pattern);
  }
});

test("content scripts run on exactly the configured explorers", () => {
  const expected = chains.chains.map((c) => origin(c.explorer.url) + "/*");
  assert.deepEqual([...manifest.content_scripts[0].matches].sort(), expected.sort());
});

test("the content script has no network code; the service worker loads every library it needs", () => {
  const contentFiles = manifest.content_scripts[0].js;
  assert.ok(!contentFiles.some((f) => /registry|repo-proof|lookup|net\.js/.test(f)), contentFiles.join(","));
  const worker = read("background.js");
  const imported = [...worker.matchAll(/"((?:lib\/|chains)[^"]+\.js)"/g)].map((m) => m[1]);
  for (const file of ["chains.generated.js", "lib/net.js", "lib/safe-url.js", "lib/registry.js", "lib/repo-proof.js", "lib/status.js", "lib/lookup.js"]) {
    assert.ok(imported.includes(file), file);
  }
  for (const file of imported) assert.ok(exists(file), file);
});

test("CSP allows only the extension's own scripts", () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-|https?:|data:|blob:|\*/);
});

test("popup page has no inline script or handlers and loads only local files", () => {
  const html = read("popup/popup.html");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, "inline script");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline handler");
  for (const ref of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    assert.doesNotMatch(ref[1], /^(?:https?:)?\/\//, "remote resource " + ref[1]);
    assert.ok(exists(path.join("popup", ref[1])), ref[1]);
  }
});

test("no dangerous DOM or code-execution sinks anywhere in the extension", () => {
  const sinks = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|window\.open|setTimeout\(\s*["']/;
  const files = ["background.js", ...fs.readdirSync(path.join(root, "lib")).map((f) => "lib/" + f), "content/content.js", "popup/popup.js"];
  for (const file of files) assert.doesNotMatch(read(file), sinks, file);
});

test("the content script never calls the network itself", () => {
  assert.doesNotMatch(read("content/content.js"), /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test("sources are ASCII, so no hidden bidi or invisible characters", () => {
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
  for (const file of walk(".").filter((f) => /\.(js|json|css|html)$/.test(f) && !f.includes("package-lock"))) {
    const text = read(file);
    const bad = [...text].find((ch) => ch.charCodeAt(0) > 127);
    assert.equal(bad, undefined, `${file} contains non-ASCII U+${bad ? bad.codePointAt(0).toString(16) : ""}`);
  }
});
