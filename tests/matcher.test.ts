import { describe, expect, it } from "vitest";
import { createPseudonymizer, createRedactor, createRestorer, identityKey } from "../src/core/matcher";
import { buildPlan, manualEntity } from "../src/core/plan";

const plan = (...names: Array<[string, "PERSON" | "COMPANY"]>) => buildPlan(names.map(([n, k]) => manualEntity(n, k, 1)), "pseudonymise");
const sub = (text: string, r: ReturnType<typeof createPseudonymizer>["replacer"]) => {
  let out = text; for (const s of [...r.spans(text)].reverse()) out = out.slice(0, s.start) + s.replacement + out.slice(s.end); return out;
};

describe("matcher", () => {
  it("never replaces inside unrelated words", () => {
    const p = createPseudonymizer(plan(["Dupont", "PERSON"]));
    expect(sub("Dupont, Dupontel, XDupont, Dupont-Martin?", p.replacer)).toBe("PERSON_001, Dupontel, XDupont, PERSON_001-Martin?");
  });
  it("handles apostrophe, hyphen, spacing and Unicode normalisation variants", () => {
    const p = createPseudonymizer(plan(["Jean-Luc D’Arc", "PERSON"]));
    const nfd = "Jean-Luc D'Arc".normalize("NFD");
    expect(sub(`${nfd} / jean\u2011luc  d’arc / Jean\u00a0Luc D'Arc`, p.replacer)).toContain("PERSON_001 / PERSON_001_V2");
    const accents = createPseudonymizer(plan(["Hélène Müller-Lefèvre", "PERSON"]));
    expect(sub("hélène müller-lefèvre et HÉLÈNE MÜLLER-LEFÈVRE et Helene".normalize("NFD"), accents.replacer)).toMatch(/PERSON_001.*PERSON_001_V2.* et Helene/);
  });
  it("redactor labels by category", () => {
    const r = createRedactor(plan(["ABC SAS", "COMPANY"], ["Jean Dupont", "PERSON"]));
    expect(sub("ABC SAS / Jean Dupont", r.replacer as never)).toBe("[REDACTED_COMPANY] / [REDACTED_PERSON]");
  });
  it("restorer only touches exact mapped tokens", () => {
    const r = createRestorer([{ token: "PERSON_001", kind: "PERSON", original: "Jean" }]);
    expect(sub("PERSON_001 person_001 PERSON_002 MYPERSON_001", r.replacer as never)).toBe("Jean person_001 PERSON_002 MYPERSON_001");
  });
  it("phone and IBAN identity keys ignore formatting", () => {
    expect(identityKey("PHONE", "06 12 34 56 78")).toBe(identityKey("PHONE", "+33 6 12 34 56 78"));
    expect(identityKey("IBAN", "fr14 2004")).toBe("FR142004");
  });
  it("different identities never share a pseudonym; same identity (any case) shares the base", () => {
    const pl = plan(["Jean Dupont", "PERSON"], ["Marie Martin", "PERSON"], ["ABC SAS", "COMPANY"]);
    expect(pl.identities.map(i => i.base)).toEqual(["PERSON_001", "PERSON_002", "COMPANY_001"]);
  });
});

import { entitiesFromDetections } from "../src/core/plan";
describe("person merge", () => {
  const d = (value: string) => ({ start: 0, end: 0, kind: "PERSON" as const, value, confidence: "medium" as const, source: "t" });
  const n = (...v: string[]) => entitiesFromDetections(v.map(d)).length;
  it("merges partial / reordered / accent / particle variants", () => {
    expect(n("Rémi Masson", "Masson")).toBe(1);
    expect(n("Rémi Masson", "Rémi")).toBe(1);
    expect(n("Rémi Masson", "MASSON Rémi")).toBe(1);
    expect(n("Remi Masson", "Rémi Masson")).toBe(1);
    expect(n("Jean de La Fontaine", "Fontaine", "La Fontaine")).toBe(1);
    expect(n("Jean Pierre Dupont", "Jean Dupont", "Dupont")).toBe(1);
  });
  it("keeps ambiguous / different apart", () => {
    expect(n("Rémi Masson", "Paul Masson", "Masson")).toBe(3);
    expect(n("Rémi Masson", "Rémi Martin")).toBe(2);
  });
  it("keeps surfaces + counts", () => {
    const e = entitiesFromDetections([d("Rémi Masson"), d("Masson"), d("Masson")]);
    expect(e[0].surfaces).toEqual([{ text: "Rémi Masson", count: 1 }, { text: "Masson", count: 2 }]);
  });
});
