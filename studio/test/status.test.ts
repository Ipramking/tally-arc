import { describe, expect, it } from "vitest";
import { decideLevel, describe as describeLevel, LEVELS, pickBest, type Level } from "@/lib/status";
import { vectors } from "./helpers";

const v = vectors("status.json");

describe("status", () => {
  it("decideLevel matches the shared vectors", () => {
    for (const c of v.decideLevel) expect(decideLevel(c.registration, c.repo), c.name).toBe(c.expected);
  });

  it("pickBest matches the shared vectors", () => {
    for (const c of v.pickBest) {
      const expected = c.expectedIndex === null ? null : c.registrations[c.expectedIndex];
      expect(pickBest(c.registrations), c.name).toBe(expected);
    }
  });

  it("every level has a label and a distinct css class", () => {
    const css = new Set(Object.values(LEVELS).map((l) => l.css));
    expect(css.size).toBe(Object.keys(LEVELS).length);
    expect(LEVELS.verified.label).toBe("Tally Verified");
  });

  it("describe never claims more than the level", () => {
    const reg = (extra: object = {}) => ({ provenance: "CONTROL_PROVEN" as const, registryVersion: 2 as const, controlCurrent: true, codeCurrent: true, upgradeable: false, ...extra });
    expect(describeLevel("verified")).toMatch(/repository lists this contract/);
    expect(describeLevel("verified")).toMatch(/names the signer's wallet/);
    expect(describeLevel("control-proven", reg({ upgradeable: true }), { status: "confirmed", bound: true })).toMatch(/upgradeable proxy/);
    expect(describeLevel("control-proven", reg(), { status: "confirmed", bound: false })).toMatch(/does not name the wallet/);
    expect(describeLevel("control-proven", reg(), { status: "confirmed" })).toMatch(/does not name the wallet/);
    expect(describeLevel("control-proven", reg(), { status: "not-listed" })).toMatch(/does not list this contract.*unconfirmed/);
    expect(describeLevel("control-proven", reg(), { status: "unavailable" })).toMatch(/could not be checked/);
    expect(describeLevel("control-proven", reg({ registryVersion: 1 }), { status: "confirmed" })).toMatch(/legacy v1/);
    expect(describeLevel("stale", reg({ codeCurrent: false }))).toMatch(/code at this address changed/);
    expect(describeLevel("stale", reg({ controlCurrent: false }))).toMatch(/no longer controls/);
    const all: Level[] = ["verified", "control-proven", "stale", "self-attested", "unverified", "unknown"];
    for (const level of all) expect(describeLevel(level, reg()).length).toBeGreaterThan(20);
  });
});
