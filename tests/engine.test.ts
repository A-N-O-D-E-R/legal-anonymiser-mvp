import { describe, expect, it } from "vitest";
import { buildPlan, manualEntity } from "../src/core/plan";
import { processDocx } from "../src/document/pipeline";
import { buildDocx, para, readPart, run } from "./fixtures";

const CASE = "123e4567-e89b-42d3-a456-426614174000";
async function pseudo(body: string, names: string[]) {
  const plan = buildPlan(names.map(n => manualEntity(n, "PERSON", 1)), "pseudonymise");
  const out = await processDocx(await buildDocx({ body }), plan, { caseId: CASE });
  return readPart(out.bytes, "word/document.xml");
}

describe("run-aware replacement engine", () => {
  it("keeps every run and its properties; token lands in the run where the match starts", async () => {
    const xml = await pseudo(para(run("Hi Jean ", "<w:b/>") + run("Du", "<w:i/>") + run("pont", "<w:u w:val=\"single\"/>") + run(" bye", "<w:strike/>")), ["Jean Dupont"]);
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Hi PERSON_001</w:t>'.replace("Hi PERSON_001", "Hi PERSON_001"));
    expect(xml).toContain("<w:i/>"); expect(xml).toContain("<w:strike/>"); expect(xml).toContain('<w:u w:val="single"/>');
    expect((xml.match(/<w:r>/g) ?? []).length).toBe(4);
    expect(xml).toContain(" bye");
  });
  it("handles several matches inside one run and a match that ends exactly at a run boundary", async () => {
    const xml = await pseudo(para(run("Jean Dupont, Jean Dupont") + run(" et Marie Martin")), ["Jean Dupont", "Marie Martin"]);
    expect(xml).toContain("PERSON_001, PERSON_001"); expect(xml).toContain(" et PERSON_002");
  });
  it("preserves leading/trailing whitespace with xml:space", async () => {
    const xml = await pseudo(para(run("Jean Dupont ", "<w:b/>") + run(" fin")), ["Jean Dupont"]);
    expect(xml).toMatch(/<w:t xml:space="preserve">PERSON_001 <\/w:t>/);
  });
  it("does not modify parts it has no reason to touch (byte-identical)", async () => {
    const bytes = await buildDocx({ body: para(run("Jean Dupont")), header: para(run("Sans nom")) });
    const plan = buildPlan([manualEntity("Jean Dupont", "PERSON", 1)], "pseudonymise");
    const out = await processDocx(bytes, plan, { caseId: CASE });
    expect(await readPart(out.bytes, "word/header1.xml")).toBe(await readPart(bytes, "word/header1.xml"));
    expect(await readPart(out.bytes, "word/styles.xml")).toBe(await readPart(bytes, "word/styles.xml"));
  });
  it("copes with a large document in reasonable time", async () => {
    const body = Array.from({ length: 3000 }, (_, i) => para(run(`Paragraphe ${i} : Jean `) + run("Dupont", "<w:b/>") + run(" a signé le contrat avec ABC Conseil SAS.")) ).join("");
    const t0 = Date.now();
    const plan = buildPlan([manualEntity("Jean Dupont", "PERSON", 3000)], "pseudonymise");
    const out = await processDocx(await buildDocx({ body }), plan, { caseId: CASE });
    expect(out.replacements).toBe(3000);
    expect(Date.now() - t0).toBeLessThan(30_000);
  });
});
