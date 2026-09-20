// Injects Tally provenance badges on Arc block explorer pages.
(function () {
  const cfg = globalThis.TALLY_CONFIG;
  const ADDRESS_RE = /0x[a-fA-F0-9]{40}/;
  const seen = new WeakSet();
  const cache = new Map(); // address -> registration result
  const badged = new Set(); // addresses already given a badge (one per page)

  function studioRegisterUrl(address) {
    return `${cfg.STUDIO_URL}/register?address=${address}`;
  }

  function makeBadge(reg, address) {
    const el = document.createElement("span");
    el.className = "tally-badge";

    if (reg && reg.isVerified) {
      el.classList.add("tally-verified");
      el.innerHTML = `<span class="tally-dot"></span> Tally Verified`;
      el.title = `Owner-proven provenance\nRepo: ${reg.githubRepo}\nBuild: ${reg.buildHash}`;
      if (reg.githubRepo) {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => window.open(reg.githubRepo, "_blank"));
      }
    } else if (reg && reg.provenance === "SELF_ATTESTED") {
      el.classList.add("tally-selfattested");
      el.innerHTML = `<span class="tally-dot"></span> Self-attested (unproven)`;
      el.title = `Claimed source, but ownership NOT verified on-chain.\nRepo: ${reg.githubRepo}`;
      if (reg.githubRepo) {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => window.open(reg.githubRepo, "_blank"));
      }
    } else {
      el.classList.add("tally-unverified");
      el.innerHTML = `<span class="tally-dot"></span> Unverified &middot; Register`;
      el.title = "No Tally provenance record. Click to register.";
      el.style.cursor = "pointer";
      el.addEventListener("click", () =>
        window.open(studioRegisterUrl(address), "_blank")
      );
    }
    return el;
  }

  async function resolve(address) {
    const key = address.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const p = globalThis.TallyRegistry.getRegistration(address).catch((e) => {
      console.debug("[Tally] lookup failed", e.message);
      return null;
    });
    cache.set(key, p);
    return p;
  }

  async function decorate(node, address) {
    if (seen.has(node)) return;
    seen.add(node);
    const key = address.toLowerCase();
    if (badged.has(key)) return; // at most one badge per address, page-wide
    badged.add(key);
    const reg = await resolve(address);
    const badge = makeBadge(reg, address);
    node.insertAdjacentElement("afterend", badge);
  }

  // 1) Primary address from the URL (…/address/0x…)
  function decoratePrimary() {
    const m = location.pathname.match(ADDRESS_RE);
    if (!m) return;
    const address = m[0];
    if (badged.has(address.toLowerCase())) return; // already placed inline
    const header =
      document.querySelector("h1, h2, [data-testid='address-hash']") ||
      document.body;
    if (header && !header.querySelector(".tally-badge")) {
      const anchor = document.createElement("span");
      header.prepend(anchor);
      decorate(anchor, address);
    }
  }

  // 2) Inline addresses rendered as links on the page.
  function decorateInline() {
    const links = document.querySelectorAll(
      "a[href*='/address/0x'], a[href*='/token/0x']"
    );
    links.forEach((a) => {
      const m = a.getAttribute("href").match(ADDRESS_RE);
      if (m) decorate(a, m[0]);
    });
  }

  function run() {
    try {
      // Inline first so the badge lands on the address in the header (nicely
      // placed); decoratePrimary is only a fallback when the address isn't a
      // link. Dedup keeps it to one badge per unique address on the page.
      decorateInline();
      decoratePrimary();
    } catch (e) {
      console.debug("[Tally] run error", e);
    }
  }

  run();
  // Explorers are SPAs — re-scan on DOM churn (debounced).
  let t;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(run, 400);
  }).observe(document.body, { childList: true, subtree: true });
})();
