const cfg = globalThis.TALLY_CONFIG;
const $ = (id) => document.getElementById(id);

document.getElementById("studioLink").href = cfg.STUDIO_URL;

function shorten(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function render(address, reg) {
  const box = $("result");
  box.classList.remove("hidden");

  if (!reg || reg.provenance === "NONE") {
    box.className = "result unverified";
    box.innerHTML = `
      <div class="badge">&#9888; Unverified</div>
      <p>No provenance record on Arc for <code>${shorten(address)}</code>.</p>
      <a class="cta" href="${cfg.STUDIO_URL}/register?address=${address}" target="_blank">Register this contract →</a>`;
    return;
  }

  if (reg.isVerified) {
    box.className = "result verified";
    box.innerHTML = `
      <div class="badge">&#10003; Tally Verified <small>owner-proven</small></div>
      <dl>
        <dt>Repo</dt><dd><a href="${reg.githubRepo}" target="_blank">${reg.githubRepo}</a></dd>
        <dt>Build</dt><dd><code>${reg.buildHash || "—"}</code></dd>
        <dt>Owner</dt><dd><code>${shorten(reg.owner)}</code></dd>
      </dl>`;
    return;
  }

  // SELF_ATTESTED
  box.className = "result selfattested";
  box.innerHTML = `
    <div class="badge">&#9679; Self-attested <small>unproven</small></div>
    <p>Source was claimed, but on-chain ownership was <b>not</b> verified.</p>
    <dl>
      <dt>Repo</dt><dd><a href="${reg.githubRepo}" target="_blank">${reg.githubRepo}</a></dd>
      <dt>Claimed by</dt><dd><code>${shorten(reg.owner)}</code></dd>
    </dl>`;
}

async function lookup(address) {
  const box = $("result");
  box.classList.remove("hidden");
  box.className = "result loading";
  box.textContent = "Querying Arc…";
  try {
    const reg = await globalThis.TallyRegistry.getRegistration(address);
    render(address, reg);
  } catch (e) {
    box.className = "result unverified";
    box.textContent = `Lookup failed: ${e.message}`;
  }
}

$("check").addEventListener("click", () => {
  const a = $("addr").value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) lookup(a);
  else {
    const box = $("result");
    box.classList.remove("hidden");
    box.className = "result unverified";
    box.textContent = "Enter a valid 0x… address.";
  }
});

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const address = cfg.PRESETS[btn.dataset.preset];
    if (!address || /^0x0+$/.test(address)) {
      const box = $("result");
      box.classList.remove("hidden");
      box.className = "result unverified";
      box.textContent = "Preset not configured yet (set it in config.js).";
      return;
    }
    $("addr").value = address;
    lookup(address);
  });
});
