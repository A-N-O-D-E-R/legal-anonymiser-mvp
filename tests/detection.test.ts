import { describe, expect, it } from "vitest";
import { detect } from "../src/detection";

const find = (t: string, kind?: string) => detect(t).filter(d => !kind || d.kind === kind).map(d => d.value);

describe("detection (heuristic, FR/EN)", () => {
  it("emails", () => expect(find("Écrire à jean.dupont@exemple.fr.", "EMAIL")).toEqual(["jean.dupont@exemple.fr"]));
  it("French phones", () => {
    expect(find("Tél 06 12 34 56 78 ou +33 6 12 34 56 78 ou 01.23.45.67.89", "PHONE")).toEqual(["06 12 34 56 78", "+33 6 12 34 56 78", "01.23.45.67.89"]);
  });
  it("UK and US phones", () => {
    expect(find("Call +44 20 7946 0958", "PHONE")).toEqual(["+44 20 7946 0958"]);
    expect(find("Call (415) 555-2671 or 415-555-2671", "PHONE")).toEqual(["(415) 555-2671", "415-555-2671"]);
  });
  it("IBAN needs a valid checksum", () => {
    expect(find("IBAN FR14 2004 1010 0505 0001 3M02 606", "IBAN")).toEqual(["FR14 2004 1010 0505 0001 3M02 606"]);
    expect(find("GB29 NWBK 6016 1331 9268 19", "IBAN")).toHaveLength(1);
    expect(find("FR14 2004 1010 0505 0001 3M02 607", "IBAN")).toHaveLength(1); // FR-shaped: low confidence kept for review
    expect(detect("DE00 1234 5678 9012 3456 78").filter(d => d.kind === "IBAN")).toHaveLength(0);
  });
  it("SIREN/SIRET with Luhn", () => {
    expect(find("SIREN 552 100 554", "ID")).toEqual(["552 100 554"]);
    expect(find("SIRET 552 100 554 00005", "ID")).toHaveLength(1);
    expect(find("SIREN 552 100 555", "ID")).toHaveLength(0);
  });
  it("dates of birth only with a birth keyword", () => {
    expect(find("né le 12 mars 1980 à Lyon", "DOB")).toEqual(["12 mars 1980"]);
    expect(find("born on 3 April 1975", "DOB")).toEqual(["3 April 1975"]);
    expect(find("Fait à Paris le 1er janvier 2024", "DOB")).toEqual([]);
  });
  it("case references", () => {
    expect(find("RG n° 23/04567", "CASE_REF")).toHaveLength(1);
    expect(find("Claim No. HC-2023-000123 and [2023] EWHC 1234 (Ch)", "CASE_REF")).toEqual(["Claim No. HC-2023-000123", "[2023] EWHC 1234 (Ch)"]);
  });
  it("addresses FR/UK/US", () => {
    expect(find("demeurant 12 rue de la Paix, 75002 Paris, et", "ADDRESS")).toEqual(["12 rue de la Paix, 75002 Paris"]);
    expect(find("of 221B Baker Street, London NW1 6XE and", "ADDRESS")).toEqual(["221B Baker Street, London NW1 6XE"]);
    expect(find("500 Market Street, San Francisco, CA 94105.", "ADDRESS")).toEqual(["500 Market Street, San Francisco, CA 94105"]);
  });
  it("persons: given+surname, compound, accents, titles, ALLCAPS", () => {
    expect(find("Entre Jean Dupont et Marie-Claire MARTIN-LEFÈVRE.", "PERSON")).toEqual(["Jean Dupont", "Marie-Claire MARTIN-LEFÈVRE"]);
    expect(find("représentée par M. Dupont", "PERSON")).toEqual(["Dupont"]);
    expect(find("DUPONT Jean est présent", "PERSON")).toEqual(["DUPONT Jean"]);
    expect(find("Mr. Smith and Dr Brown", "PERSON")).toEqual(["Smith", "Brown"]);
    expect(find("Jean de La Fontaine", "PERSON")).toEqual(["Jean de La Fontaine"]);
  });
  it("persons: avoids obvious false positives", () => {
    expect(find("Le tribunal a statué. La Cour a jugé.", "PERSON")).toEqual([]);
    expect(find("Paul et Marie", "PERSON")).toEqual([]);
  });
  it("companies via legal form", () => {
    expect(find("La société ABC Conseil SAS (SIREN", "COMPANY")).toEqual(["ABC Conseil SAS"]);
    expect(find("with Acme Holdings Ltd (company", "COMPANY")).toEqual(["Acme Holdings Ltd"]);
  });
  it("does not span tab/break separators", () => {
    expect(find("Jean\u0001Dupont", "PERSON")).toEqual([]);
  });
});
