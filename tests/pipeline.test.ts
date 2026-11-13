import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildPlan, manualEntity } from "../src/core/plan";
import { ProcessingBlocked, type Entity, type Mode } from "../src/core/types";
import { processDocx, restoreDocx, scanDocx } from "../src/document/pipeline";
import { checkIntegrity, openPackage } from "../src/document/package";
import { decryptMapping, encryptMapping } from "../src/security/mappingCrypto";
import { allText, buildDocx, englishDocx, frenchDocx, para, partList, readPart, run } from "./fixtures";

const CASE = "123e4567-e89b-42d3-a456-426614174000";
async function anon(bytes: Uint8Array, mode: Mode, tweak: (e: Entity[]) => Entity[] = e => e) {
  const scan = await scanDocx(bytes, mode);
  const plan = buildPlan(tweak(scan.entities), mode);
  return { scan, plan, out: await processDocx(bytes, plan, { caseId: CASE }) };
}
const blocked = async (p: Promise<unknown>) => p.then(() => null, (e: ProcessingBlocked) => e.issues.map(i => i.code));
const FR_SECRETS = ["Jean Dupont", "Dupont", "MARTIN-LEFÈVRE", "Marie-Claire", "ABC Conseil", "552 100 554", "jean.dupont@exemple.fr", "06 12 34 56 78", "FR14", "12 rue de la Paix", "Pierre Lambert", "Alice Moreau", "Cabinet Moreau", "23/04567"];

describe("pseudonymisation", () => {
  it("is consistent: same identity → same pseudonym, different identities → different", async () => {
    const { out } = await anon(await frenchDocx(), "pseudonymise");
    const doc = await readPart(out.bytes, "word/document.xml");
    const jean = out.entries.find(e => e.original === "Jean Dupont")!;
    expect(jean).toBeDefined();
    expect(doc.split(jean.token + "<").length - 1 + doc.split(jean.token + " ").length - 1).toBeGreaterThan(2);
    const persons = out.entries.filter(e => e.kind === "PERSON").map(e => e.token);
    expect(new Set(persons).size).toBe(persons.length);
    expect(out.entries.find(e => e.original.includes("MARTIN-LEFÈVRE"))!.token).not.toBe(jean.token);
  });
  it("handles accents, hyphens, apostrophes and split runs; never touches partial words", async () => {
    const bytes = await frenchDocx();
    const { out } = await anon(bytes, "pseudonymise");
    const txt = await allText(out.bytes);
    for (const s of FR_SECRETS) expect(txt, s).not.toContain(s);
    expect(out.entries.some(e => e.original === "Marie-Claire MARTIN-LEFÈVRE")).toBe(true);
    // "Durand" must not be merged with "Jean" across the tab separator
    expect(txt).toContain("Durand ne doit pas");
  });
  it("case variants share one identity but restore exactly", async () => {
    const bytes = await buildDocx({ body: para(run("Contact: Jean Dupont. Puis JEAN DUPONT. Puis jean dupont. Dupontel reste.")) });
    const { out, plan } = await anon(bytes, "pseudonymise", () => [manualEntity("Jean Dupont", "PERSON", 3)]);
    expect(plan.identities).toHaveLength(1);
    expect(out.entries.map(e => e.original).sort()).toEqual(["JEAN DUPONT", "Jean Dupont", "jean dupont"]);
    const txt = await readPart(out.bytes, "word/document.xml");
    expect(txt).toContain("Dupontel");
    const mapping = { caseId: CASE, entries: out.entries };
    const restored = await restoreDocx(out.bytes, mapping);
    const rt = await readPart(restored.bytes, "word/document.xml");
    expect(rt).toContain("Contact: Jean Dupont. Puis JEAN DUPONT. Puis jean dupont. Dupontel reste.");
  });
  it("preserves run formatting, tables, headers/footers, hyperlinks, footnotes, bookmarks, section", async () => {
    const { out } = await anon(await frenchDocx(), "pseudonymise");
    const doc = await readPart(out.bytes, "word/document.xml");
    expect(doc).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>PERSON_\d+<\/w:t>/); // bold "Jean" run keeps <w:b/> and carries the token
    expect(doc).toContain("<w:i/>"); expect(doc).toContain('w:val="FF0000"'); expect(doc).toContain('w:ascii="Garamond"');
    expect(doc).toContain("<w:tbl>"); expect(doc.match(/<w:tbl>/g)).toHaveLength(2); // nested table intact
    expect(doc).toContain("w:hyperlink"); expect(doc).toContain("w:bookmarkStart"); expect(doc).toContain("w:headerReference"); expect(doc).toContain("w:pgSz");
    expect(await readPart(out.bytes, "word/header1.xml")).toMatch(/PERSON_\d+/);
    expect(await readPart(out.bytes, "word/footer1.xml")).toMatch(/EMAIL_\d+/);
    expect(await readPart(out.bytes, "word/footnotes.xml")).toMatch(/PERSON_\d+/);
    const rels = await readPart(out.bytes, "word/_rels/document.xml.rels");
    expect(rels).not.toContain("jean-dupont");
  });
  it("keeps tracked changes, pseudonymising deleted text, and neutralises authors", async () => {
    const { out } = await anon(await frenchDocx(), "pseudonymise");
    const doc = await readPart(out.bytes, "word/document.xml");
    expect(doc).toContain("<w:del "); expect(doc).toContain("<w:delText"); expect(doc).not.toContain("Alice Moreau"); expect(doc).toContain('w:author="Author"');
    expect(await readPart(out.bytes, "word/comments.xml")).toContain('w:author="Author"');
  });
  it("wipes metadata and adds only a random case marker", async () => {
    const { out } = await anon(await frenchDocx(), "pseudonymise");
    const core = await readPart(out.bytes, "docProps/core.xml");
    expect(core).not.toMatch(/Dupont|Moreau/);
    const custom = await readPart(out.bytes, "docProps/custom.xml");
    expect(custom).toContain(CASE); expect(custom).not.toContain("Jean");
  });
  it("blocks when the document already contains pseudonym-shaped text", async () => {
    const bytes = await buildDocx({ body: para(run("Jean Dupont et PERSON_001")) });
    expect(await blocked(anon(bytes, "pseudonymise", () => [manualEntity("Jean Dupont", "PERSON", 1)]))).toEqual(["TOKEN_COLLISION"]);
  });
  it("processes English documents too", async () => {
    const { out } = await anon(await englishDocx(), "pseudonymise");
    const txt = await allText(out.bytes);
    for (const s of ["John Smith", "Baker Street", "NW1 6XE", "7946 0958", "john.smith@example.co.uk", "GB29", "HC-2023-000123", "Acme Holdings", "3 April 1975"]) expect(txt, s).not.toContain(s);
  });
});

describe("restoration", () => {
  it("restores exact originals through an encrypted mapping and leaves the input untouched", async () => {
    const original = await frenchDocx();
    const snapshot = original.slice();
    const { out } = await anon(original, "pseudonymise");
    const file = await encryptMapping({ caseLabel: "X", entries: out.entries }, "a long enough password 1!", { caseId: CASE, iterations: 100_000 });
    const m = await decryptMapping(file, "a long enough password 1!");
    const pseudoSnapshot = out.bytes.slice();
    const restored = await restoreDocx(out.bytes, { caseId: m.caseId, entries: m.payload.entries });
    const doc = await readPart(restored.bytes, "word/document.xml");
    expect(doc).toContain("Jean"); expect(doc).toContain("jean.dupont@exemple.fr");
    expect(doc).not.toMatch(/PERSON_\d|EMAIL_\d/);
    expect(await readPart(restored.bytes, "word/header1.xml")).toContain("Jean Dupont");
    expect(await readPart(restored.bytes, "word/_rels/document.xml.rels")).toContain("https://exemple.fr/jean-dupont");
    expect(await partList(restored.bytes)).not.toContain("docProps/custom.xml");
    expect(original).toEqual(snapshot);            // source document unchanged
    expect(out.bytes).toEqual(pseudoSnapshot);     // pseudonymised input unchanged
    expect(restored.replacements).toBeGreaterThan(10);
  });
  it("rejects a mapping from another case, tokens it does not know, and documents without tokens", async () => {
    const { out } = await anon(await frenchDocx(), "pseudonymise");
    expect(await blocked(restoreDocx(out.bytes, { caseId: "00000000-0000-4000-8000-000000000000", entries: out.entries }))).toEqual(["CASE_MISMATCH"]);
    expect(await blocked(restoreDocx(out.bytes, { caseId: CASE, entries: out.entries.slice(0, 1) }))).toEqual(["UNMAPPED_TOKENS"]);
    const plain = await buildDocx({ body: para(run("Rien ici")) });
    expect(await blocked(restoreDocx(plain, { caseId: CASE, entries: out.entries }))).toEqual(["NO_TOKENS_FOUND"]);
  });
  it("does not restore look-alike strings (case-sensitive, boundary-aware)", async () => {
    const bytes = await buildDocx({ body: para(run("PERSON_001 person_001 PERSON_0011 XPERSON_001")), extra: {}, custom: false });
    const e = [{ token: "PERSON_001", kind: "PERSON" as const, original: "Jean" }];
    expect(await blocked(restoreDocx(bytes, { caseId: CASE, entries: e }))).toEqual(["UNMAPPED_TOKENS"]); // PERSON_0011 is unknown → refuse rather than guess
    const ok = await buildDocx({ body: para(run("PERSON_001 person_001 XPERSON_001")) });
    const r = await restoreDocx(ok, { caseId: CASE, entries: e });
    expect(await readPart(r.bytes, "word/document.xml")).toContain("Jean person_001 XPERSON_001");
  });
  it("restores text split across runs", async () => {
    const bytes = await buildDocx({ body: para(run("PERS", "<w:b/>") + run("ON_0") + run("01", "<w:i/>")) });
    const r = await restoreDocx(bytes, { caseId: CASE, entries: [{ token: "PERSON_001", kind: "PERSON", original: "Jean" }] });
    expect(await readPart(r.bytes, "word/document.xml")).toMatch(/<w:b\/><\/w:rPr><w:t[^>]*>Jean<\/w:t>/);
  });
});

describe("irreversible redaction", () => {
  it("removes identities from every part of the package, produces no mapping, wipes metadata", async () => {
    const { out } = await anon(await frenchDocx(), "redact");
    const txt = await allText(out.bytes);
    for (const s of FR_SECRETS) expect(txt, s).not.toContain(s);
    expect(out.entries).toEqual([]);
    expect(txt).toContain("[REDACTED_PERSON]");
    const names = await partList(out.bytes);
    expect(names.filter(n => /custom|comments|people|customXml|thumbnail/.test(n))).toEqual([]);
    const rels = await readPart(out.bytes, "word/_rels/document.xml.rels");
    expect(rels).not.toMatch(/comments|jean-dupont/);
    expect(rels).toContain("REDACTED_PERSON"); // hyperlink target is bracket-free
  });
  it("drops tracked deletions and comments entirely", async () => {
    const { out } = await anon(await frenchDocx(), "redact");
    const doc = await readPart(out.bytes, "word/document.xml");
    expect(doc).not.toMatch(/w:del[ >]|w:delText|w:ins[ >]|commentReference|commentRange/);
    expect(await allText(out.bytes)).not.toContain("Pierre Lambert");
    expect(doc).toContain("Nouveau client"); // insertion accepted
  });
  it("cannot be restored: no marker, no tokens", async () => {
    const { out } = await anon(await frenchDocx(), "redact");
    expect(await partList(out.bytes)).not.toContain("docProps/custom.xml");
    expect(await blocked(restoreDocx(out.bytes, { caseId: CASE, entries: [{ token: "PERSON_001", kind: "PERSON", original: "x" }] }))).toEqual(["NO_TOKENS_FOUND"]);
  });
  it("fails closed when an included identity survives somewhere unsupported", async () => {
    // Identity only present split across a styles.xml attribute-like location that no rewriter touches.
    const bytes = await buildDocx({ body: para(run("Jean Dupont")), extra: {} });
    const z = await JSZip.loadAsync(bytes);
    z.file("word/styles.xml", (await z.file("word/styles.xml")!.async("string")).replace('w:val="Normal"', 'w:val="Jean Dupont"'));
    const tampered = await z.generateAsync({ type: "uint8array" });
    expect(await blocked(anon(tampered, "redact", () => [manualEntity("Jean Dupont", "PERSON", 1)]))).toEqual(["RESIDUAL"]);
  });
});

describe("unsupported structures and integrity", () => {
  it("blocks embedded objects, alt chunks, unknown parts and non-hyperlink external links", async () => {
    const emb = await buildDocx({ body: para(run("x")), extra: { "word/embeddings/oleObject1.bin": new Uint8Array([1, 2, 3]) } });
    expect(await blocked(scanDocx(emb, "redact"))).toEqual(["EMBEDDED_OBJECT"]);
    const unk = await buildDocx({ body: para(run("x")), extra: { "customUI/customUI.xml": "<a/>" } });
    expect(await blocked(scanDocx(unk, "pseudonymise"))).toEqual(["UNKNOWN_PART"]);
    const ext = await buildDocx({ body: para(run("x")), rels: `<Relationship Id="rId30" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/Users/jdupont/t.dotm" TargetMode="External"/>` });
    expect(await blocked(scanDocx(ext, "redact"))).toEqual(["EXTERNAL_RELATIONSHIP"]);
    expect(await blocked(scanDocx(new Uint8Array([1, 2, 3]), "redact"))).toEqual(["NOT_DOCX"]);
  });
  it("warns that images are not analysed", async () => {
    const bytes = await buildDocx({ body: para(run("Jean Dupont")), extra: { "word/media/image1.png": new Uint8Array([137, 80]) } });
    const { issues } = await scanDocx(bytes, "redact");
    expect(issues.find(i => i.code === "IMAGES")?.count).toBe(1);
  });
  it("produces structurally valid packages (all XML parses, relationships and content types resolve)", async () => {
    for (const mode of ["pseudonymise", "redact"] as const) for (const make of [frenchDocx, englishDocx]) {
      const { out } = await anon(await make(), mode);
      expect(await checkIntegrity(await openPackage(out.bytes))).toEqual([]);
    }
  });
  it("removes custom XML, drops data bindings and mail merge/doc vars", async () => {
    const body = para(run("x")) + `<w:sdt><w:sdtPr><w:dataBinding w:xpath="/a" w:storeItemID="{1}"/></w:sdtPr><w:sdtContent>${para(run("Jean Dupont"))}</w:sdtContent></w:sdt>`;
    const bytes = await buildDocx({ body, extra: { "customXml/item1.xml": "<a>Jean Dupont</a>", "customXml/_rels/item1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` }, rels: `<Relationship Id="rId40" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>`, extraOverrides: `<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>` });
    const { out } = await anon(bytes, "pseudonymise", () => [manualEntity("Jean Dupont", "PERSON", 1)]);
    expect(await partList(out.bytes)).not.toContain("customXml/item1.xml");
    expect(await readPart(out.bytes, "word/document.xml")).not.toContain("dataBinding");
    expect(await readPart(out.bytes, "word/_rels/document.xml.rels")).not.toContain("customXml");
    expect(await allText(out.bytes)).not.toContain("Jean Dupont");
  });
  it("stops with an explicit error when nothing is selected", async () => {
    expect(await blocked(anon(await frenchDocx(), "redact", e => e.map(x => ({ ...x, include: false }))))).toEqual(["NO_ENTITIES"]);
  });
});

describe("scan", () => {
  it("detects entities from all parts with categories and counts; low confidence is not pre-selected", async () => {
    const { entities } = await scanDocx(await frenchDocx(), "pseudonymise");
    const kinds = new Set(entities.map(e => e.kind));
    for (const k of ["PERSON", "COMPANY", "ADDRESS", "EMAIL", "PHONE", "IBAN", "ID", "DOB", "CASE_REF"]) expect(kinds.has(k as never), k).toBe(true);
    expect(entities.filter(e => e.confidence === "low").every(e => !e.include)).toBe(true);
    const jean = entities.find(e => e.surfaces.some(s => s.text === "Jean Dupont"))!;
    expect(jean.surfaces[0].count).toBeGreaterThan(3);
  });
});
