// Dependency-free reader for TallyRegistry over Arc's public JSON-RPC.
// Encodes getRegistration(address) and decodes the returned tuple by hand so
// the extension ships with zero npm dependencies.
(function () {
  const cfg = globalThis.TALLY_CONFIG;

  // 4-byte selector of getRegistration(address).
  // keccak256("getRegistration(address)")[0:4]
  const GET_REGISTRATION_SELECTOR = "0x72731062";

  const PROVENANCE = { 0: "NONE", 1: "SELF_ATTESTED", 2: "OWNER_PROVEN" };

  function padAddress(addr) {
    return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function hexWord(data, wordIndex) {
    const start = wordIndex * 64;
    return data.slice(start, start + 64);
  }

  function decodeString(data, byteOffset) {
    const lenStart = byteOffset * 2;
    const len = parseInt(data.slice(lenStart, lenStart + 64), 16);
    if (!len) return "";
    const strStart = lenStart + 64;
    const hex = data.slice(strStart, strStart + len * 2);
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    try {
      return decodeURIComponent(escape(out)); // utf-8 safe
    } catch {
      return out;
    }
  }

  async function getRegistration(targetAddress) {
    if (
      !cfg.REGISTRY_ADDRESS ||
      /^0x0+$/.test(cfg.REGISTRY_ADDRESS)
    ) {
      throw new Error("Registry address not configured");
    }

    const callData =
      GET_REGISTRATION_SELECTOR + padAddress(targetAddress);

    const res = await fetch(cfg.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: cfg.REGISTRY_ADDRESS, data: callData }, "latest"],
      }),
    });

    const json = await res.json();
    if (json.error) throw new Error(json.error.message);

    const data = json.result.replace(/^0x/, "");
    if (data.length < 6 * 64) {
      return { provenance: "NONE", isVerified: false };
    }

    const offset1 = parseInt(hexWord(data, 0), 16);
    const offset2 = parseInt(hexWord(data, 1), 16);
    const owner = "0x" + hexWord(data, 2).slice(24);
    const registeredAt = parseInt(hexWord(data, 3), 16);
    const provCode = parseInt(hexWord(data, 4), 16);
    const isVerified = parseInt(hexWord(data, 5), 16) === 1;

    return {
      githubRepo: decodeString(data, offset1),
      buildHash: decodeString(data, offset2),
      owner,
      registeredAt,
      provenance: PROVENANCE[provCode] || "NONE",
      isVerified,
    };
  }

  globalThis.TallyRegistry = { getRegistration };
})();
