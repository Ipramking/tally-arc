// Popup: look up any address on any configured chain. Runs under the
// extension's host permissions, so it calls the lookup library directly.
// Built entirely with DOM APIs and textContent: nothing from the chain is ever
// parsed as HTML, and links are only created from validated URLs.
/* global TALLY_CHAINS, TallySafeUrl, TallyStatus, TallyLookup */
(function () {
  "use strict";

  const config = globalThis.TALLY_CHAINS;
  const safe = globalThis.TallySafeUrl;
  const status = globalThis.TallyStatus;
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(text, href) {
    const a = el("a", "", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function currentChain() {
    return safe.chainByKey(config, $("chain").value) || config.chains[0];
  }

  function setBox(className) {
    const box = $("result");
    box.className = "result " + className;
    box.replaceChildren();
    return box;
  }

  function row(dl, term, valueNode) {
    dl.append(el("dt", "", term), (() => {
      const dd = el("dd");
      dd.append(valueNode);
      return dd;
    })());
  }

  function render(chain, address, outcome) {
    const level = outcome.level;
    const meta = status.LEVELS[level] || status.LEVELS.unknown;
    const box = setBox(level);

    box.append(el("div", "badge", meta.label));
    if (!outcome.ok) {
      box.append(el("p", "", "Could not read " + chain.name + ": " + safe.displayText(outcome.error || "unknown error", 120)));
      return;
    }
    box.append(el("p", "", status.describe(level, outcome.registration, outcome.repo)));

    const reg = outcome.registration;
    if (reg) {
      const dl = el("dl");
      row(dl, "Signer", el("code", "", safe.shorten(reg.signer)));
      const parsed = safe.parseGithubRepo(reg.githubRepo);
      row(dl, "Repo", parsed ? link(parsed.owner + "/" + parsed.repo, parsed.url) : el("span", "", safe.displayText(reg.githubRepo, 60) || "\u2014"));
      if (reg.buildHash) row(dl, "Build", el("code", "", safe.displayText(reg.buildHash, 66)));
      row(dl, "Registry", el("span", "", "v" + reg.registryVersion));
      box.append(dl);
    }

    const href = level === "unverified" ? safe.studioRegisterUrl(config, chain, address) : safe.studioDetailUrl(config, chain, address);
    const cta = link(level === "unverified" ? "Register this contract \u2192" : "Open full record \u2192", href);
    cta.className = "cta";
    box.append(cta);
  }

  async function check(address) {
    const chain = currentChain();
    const box = setBox("loading");
    box.textContent = "Querying " + chain.name + "\u2026";
    const outcome = await globalThis.TallyLookup.lookup({ chain, address, fetchImpl: fetch.bind(globalThis) });
    render(chain, address, outcome);
  }

  function showError(message) {
    const box = setBox("unknown");
    box.textContent = message;
  }

  function refreshPresets() {
    const chain = currentChain();
    const presets = chain.presets || {};
    $("presets").classList.toggle("hidden", !presets.verified && !presets.unverified);
    document.querySelectorAll(".preset").forEach((button) => {
      button.hidden = !presets[button.dataset.preset];
    });
  }

  function init() {
    for (const chain of config.chains) {
      const option = el("option", "", chain.name + " \u00b7 " + chain.id);
      option.value = chain.key;
      $("chain").append(option);
    }
    $("chain").value = config.defaultChain;
    $("studioLink").href = config.studioUrl;
    refreshPresets();

    $("chain").addEventListener("change", () => {
      refreshPresets();
      $("result").className = "result hidden";
    });

    $("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const address = $("addr").value.trim();
      if (safe.isAddress(address)) check(address);
      else showError("Enter a valid 0x\u2026 address (42 characters).");
    });

    document.querySelectorAll(".preset").forEach((button) => {
      button.addEventListener("click", () => {
        const address = (currentChain().presets || {})[button.dataset.preset];
        if (!address) return;
        $("addr").value = address;
        check(address);
      });
    });
  }

  init();
})();
