// Strict parsing and sanitising of values that come from the chain or from a
// repository. Everything read from a registry is attacker-controlled text:
// validate it before it is linked, fetched or shown.
//
// Mirrors studio/lib/safe-url.ts; both are tested against test-vectors/safe-url.json.
(function (root, factory) {
  const api = factory();
  root.TallySafeUrl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
  // GitHub login: 1-39 chars, alphanumeric or hyphen, no leading/trailing hyphen.
  const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
  const REPO_PREFIX = "https://github.com/";
  const MAX_REPO_URL_LENGTH = 200;
  // Control characters, zero-width characters and bidi overrides/isolates.
  const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

  function isAddress(value) {
    return typeof value === "string" && ADDRESS_RE.test(value);
  }

  /**
   * Parse a repository URL taken from a registry record.
   * Accepts only https://github.com/<owner>/<repo>[/more/path] built from
   * [A-Za-z0-9._/-]. Returns the canonical form (extra path dropped) or null.
   * The canonical URL is the only thing clients may link to.
   */
  function parseGithubRepo(value) {
    if (typeof value !== "string" || value.length > MAX_REPO_URL_LENGTH) return null;
    if (!value.startsWith(REPO_PREFIX)) return null;
    const rest = value.slice(REPO_PREFIX.length);
    if (!/^[A-Za-z0-9._/-]+$/.test(rest)) return null;
    const parts = rest.split("/");
    if (parts[parts.length - 1] === "") parts.pop(); // one trailing slash is fine
    if (parts.length < 2) return null;
    for (const part of parts) if (part === "" || part === "." || part === "..") return null;
    const owner = parts[0];
    let repo = parts[1];
    if (repo.endsWith(".git")) repo = repo.slice(0, -4);
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") return null;
    return { owner, repo, url: REPO_PREFIX + owner + "/" + repo };
  }

  /** URL of the tally.json that must list a contract before it can be "verified". */
  function tallyJsonUrl(parsed) {
    return "https://raw.githubusercontent.com/" + parsed.owner + "/" + parsed.repo + "/HEAD/tally.json";
  }

  /** Make untrusted text safe to display: drop invisible/bidi characters, cap length. */
  function displayText(value, max) {
    const limit = typeof max === "number" ? max : 80;
    if (typeof value !== "string") return "";
    const clean = value.replace(INVISIBLE_RE, "");
    return clean.length > limit ? clean.slice(0, limit - 1) + "\u2026" : clean;
  }

  function shorten(address) {
    return isAddress(address) ? address.slice(0, 6) + "\u2026" + address.slice(-4) : "";
  }

  /** The configured chain whose explorer is served from `hostname`, or null. */
  function chainForHostname(config, hostname) {
    if (typeof hostname !== "string") return null;
    const host = hostname.toLowerCase();
    for (const chain of config.chains) {
      if (new URL(chain.explorer.url).hostname === host) return chain;
    }
    return null;
  }

  function chainByKey(config, key) {
    return config.chains.find((chain) => chain.key === key) || null;
  }

  function studioDetailUrl(config, chain, address) {
    return config.studioUrl + "/c/" + address + "?chain=" + encodeURIComponent(chain.key);
  }

  function studioRegisterUrl(config, chain, address) {
    return config.studioUrl + "/register?address=" + address + "&chain=" + encodeURIComponent(chain.key);
  }

  return {
    isAddress,
    parseGithubRepo,
    tallyJsonUrl,
    displayText,
    shorten,
    chainForHostname,
    chainByKey,
    studioDetailUrl,
    studioRegisterUrl,
  };
});
