const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, vectors } = require("./helpers");

const status = lib("status.js");
const v = vectors("status.json");

test("decideLevel matches the shared vectors", () => {
  for (const c of v.decideLevel) {
    assert.equal(status.decideLevel(c.registration, c.repo), c.expected, c.name);
  }
});

test("pickBest matches the shared vectors", () => {
  for (const c of v.pickBest) {
    const picked = status.pickBest(c.registrations);
    const expected = c.expectedIndex === null ? null : c.registrations[c.expectedIndex];
    assert.equal(picked, expected, c.name);
  }
});

test("every level has a label, and 'Verified' wording is reserved for verified", () => {
  for (const [level, meta] of Object.entries(status.LEVELS)) {
    assert.ok(meta.label && meta.short, level);
    if (level !== "verified") assert.doesNotMatch(meta.label, /verified/i === null ? /$^/ : /^Tally Verified$/, level);
  }
  assert.equal(status.LEVELS.verified.label, "Tally Verified");
  assert.equal(status.LEVELS.unverified.label, "Unverified"); // contains "verified" but is the opposite
});

test("describe never claims more than the level", () => {
  const reg = (extra) => ({ provenance: "CONTROL_PROVEN", registryVersion: 2, controlCurrent: true, codeCurrent: true, ...extra });
  assert.match(status.describe("verified", reg(), { status: "confirmed" }), /repository lists this contract/);
  assert.match(status.describe("control-proven", reg(), { status: "not-listed" }), /does not list this contract.*unconfirmed/);
  assert.match(status.describe("control-proven", reg(), { status: "unavailable" }), /could not be checked/);
  assert.match(status.describe("control-proven", reg({ registryVersion: 1 }), { status: "confirmed" }), /legacy v1/);
  assert.match(status.describe("stale", reg({ codeCurrent: false })), /code at this address changed/);
  assert.match(status.describe("stale", reg({ controlCurrent: false })), /no longer controls/);
  assert.match(status.describe("self-attested"), /without any on-chain proof/);
  assert.match(status.describe("unverified"), /No Tally record/);
  assert.match(status.describe("unknown"), /Could not read/);
});
