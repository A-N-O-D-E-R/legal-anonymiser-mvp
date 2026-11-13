import type JSZip from "jszip";
import { createFinder, createPseudonymizer, createRedactor, createRestorer, type Replacer, type Span } from "../core/matcher";
import { builtinDetectors, detect, nlpDetect } from "../detection";
import { entitiesFromDetections } from "../core/plan";
import { ProcessingBlocked, TOKEN_SHAPE, type Detection, type Entity, type Issue, type MappingEntry, type Mode, type Plan } from "../core/types";
import {
  acceptTrackedChanges, anonymiseAuthors, cleanSettings, collectUnits, elements, hasHiddenText, hasTrackedChanges, parseXml,
  removeDataBindings, removeXmlComments, serializeXml, stripCommentMarkers, allTextSurfaces, W, type Unit
} from "./ooxml";
import {
  auditPackage, checkIntegrity, classify, openPackage, partNames, readMarker, relsOf, removePart, wipeMetadata, writeMarker
} from "./package";

const TOKEN_GLOBAL = new RegExp(TOKEN_SHAPE.source, "gu");

function relUnits(doc: Document): Unit[] {
  return relsOf(doc).filter(r => r.getAttribute("TargetMode") === "External" && r.getAttribute("Target")).map(r => {
    let text = r.getAttribute("Target")!;
    return { text, plain: true, apply(spans: Span[]) { for (const s of [...spans].reverse()) text = text.slice(0, s.start) + s.replacement + text.slice(s.end); r.setAttribute("Target", text); } };
  });
}

/** Parts whose XML we parse: ordinary XML, rels, and comment parts (kept and processed in pseudonymise mode). */
const isParsed = (name: string) => { const c = classify(name); return c === "xml" || c === "rels" || c === "remove-redact"; };
/** Underscore is a word character for matching, but identifiers such as bookmark names ("Dupont_clause") must not hide an identity. */
const relax = (t: string) => t.replace(/_/g, " ");

const isRemoved = (name: string, mode: Mode) => { const c = classify(name); return c === "remove-always" || (c === "remove-redact" && mode === "redact"); };

interface Loaded { zip: JSZip; docs: Map<string, Document>; issues: Issue[] }

/** Open, audit (throws ProcessingBlocked on blockers) and parse all XML parts. */
async function load(bytes: Uint8Array, mode: Mode | "restore"): Promise<Loaded> {
  const zip = await openPackage(bytes);
  const issues = await auditPackage(zip, mode);
  const blocks = issues.filter(i => i.severity === "block");
  if (blocks.length) throw new ProcessingBlocked(blocks);
  const docs = new Map<string, Document>();
  for (const n of partNames(zip)) {
    if (isParsed(n)) {
      try { docs.set(n, parseXml(await zip.file(n)!.async("string"))); } catch { throw new ProcessingBlocked([{ severity: "block", code: "INTEGRITY", part: n }]); }
    }
  }
  return { zip, docs, issues };
}

const unitsFor = (name: string, doc: Document) => name.endsWith(".rels") ? relUnits(doc) : collectUnits(doc);

export interface ScanResult { entities: Entity[]; issues: Issue[]; texts: string[] }

/** Detect candidate entities. Nothing is modified; `texts` stays in memory only so manual additions can be counted. */
export async function scanDocx(bytes: Uint8Array, mode: Mode, opts: { nlp?: boolean; onProgress?: (pct: number) => void } = {}): Promise<ScanResult> {
  const { docs, issues } = await load(bytes, mode);
  const texts: string[] = [], dets: Detection[] = [];
  let hidden = false, tracked = false;
  for (const [name, doc] of docs) {
    if (isRemoved(name, mode)) continue;
    hidden ||= hasHiddenText(doc); tracked ||= hasTrackedChanges(doc);
    if (mode === "redact") acceptTrackedChanges(doc);
    for (const u of unitsFor(name, doc)) { texts.push(u.text);
      const nlp = opts.nlp ? await nlpDetect(u.text, opts.onProgress) : [];
      dets.push(...detect(u.text, [...builtinDetectors(), { id: "nlp", run: () => nlp }]));
    }
  }
  if (hidden) issues.push({ severity: "warn", code: "HIDDEN_TEXT" });
  if (tracked) issues.push({ severity: "warn", code: mode === "redact" ? "TRACKED_ACCEPTED" : "TRACKED_KEPT" });
  return { entities: entitiesFromDetections(dets), issues, texts };
}

export function countOccurrences(texts: string[], surface: string): number {
  const re = createFinder([surface]);
  if (!re) return 0;
  const g = new RegExp(re.source, "giu");
  return texts.reduce((n, t) => n + (t.match(g)?.length ?? 0), 0);
}

function applyReplacer(units: Unit[], replacer: Replacer, relaxUnderscore: boolean): number {
  let n = 0;
  for (const u of units) {
    const spans = replacer.spans(relaxUnderscore ? relax(u.text) : u.text);
    if (!spans.length) continue;
    if (u.plain) for (const s of spans) s.replacement = s.replacement.replace(/^\[(.*)\]$/, "$1");
    u.apply(spans); n += spans.length;
  }
  return n;
}

/** Re-open the produced bytes and look for anything that must not be there. Throws ProcessingBlocked. */
async function verify(bytes: Uint8Array, leak: RegExp | null, mode: Mode | "restore"): Promise<void> {
  const zip = await openPackage(bytes);
  const bad: Issue[] = await checkIntegrity(zip);
  const names = partNames(zip);
  for (const n of names) if (leak?.test(n)) bad.push({ severity: "block", code: "RESIDUAL", part: "(part name)" });
  for (const n of names) {
    const c = classify(n);
    if (isParsed(n) || c === "ct" || c === "meta") {
      const doc = parseXml(await zip.file(n)!.async("string"));
      if (leak && allTextSurfaces(doc).some(s => leak.test(s) || (mode !== "restore" && leak.test(relax(s))))) bad.push({ severity: "block", code: "RESIDUAL", part: n });
      if (mode === "redact" && c === "xml" && elements(doc, W, "del", "ins", "delText", "moveFrom", "moveTo", "commentReference").length) bad.push({ severity: "block", code: "RESIDUAL", part: n });
    }
  }
  if (mode === "redact") for (const n of names) if (isRemoved(n, "redact")) bad.push({ severity: "block", code: "RESIDUAL", part: n });
  if (bad.length) throw new ProcessingBlocked(bad);
}

export interface ProcessResult { bytes: Uint8Array; replacements: number; perIdentity: Map<string, number>; entries: MappingEntry[]; issues: Issue[] }

export async function processDocx(bytes: Uint8Array, plan: Plan, opts: { caseId?: string } = {}): Promise<ProcessResult> {
  const { mode } = plan;
  if (mode === "pseudonymise" && !opts.caseId) throw new Error("caseId required");
  if (!plan.identities.length) throw new ProcessingBlocked([{ severity: "block", code: "NO_ENTITIES" }]);
  const { zip, docs, issues } = await load(bytes, mode);
  issues.push(...plan.warnings);

  // Pseudonym-shaped text already present would make restoration ambiguous.
  if (mode === "pseudonymise") {
    for (const [n, d] of docs) if (unitsFor(n, d).some(u => TOKEN_SHAPE.test(u.text))) throw new ProcessingBlocked([{ severity: "block", code: "TOKEN_COLLISION", part: n }]);
  }

  for (const n of partNames(zip).filter(n => isRemoved(n, mode))) { docs.delete(n); await removePart(zip, n); }

  const tracker = mode === "pseudonymise" ? createPseudonymizer(plan) : null;
  const redactor = mode === "redact" ? createRedactor(plan) : null;
  const replacer = (tracker ?? redactor)!.replacer;
  let replacements = 0, hidden = false, tracked = false;
  for (const name of [...docs.keys()]) {
    // Re-read relationships of parts after removal (rels files may have changed on disk).
    let dirty = false;
    if (name.endsWith(".rels")) { const fresh = zip.file(name); if (!fresh) continue; docs.set(name, parseXml(await fresh.async("string"))); }
    const d = docs.get(name)!;
    if (name.endsWith(".xml")) {
      hidden ||= hasHiddenText(d); tracked ||= hasTrackedChanges(d);
      if (mode === "redact") { dirty = acceptTrackedChanges(d) || dirty; dirty = stripCommentMarkers(d) || dirty; }
      dirty = anonymiseAuthors(d) || dirty;
      dirty = removeDataBindings(d) || dirty;
      dirty = removeXmlComments(d) || dirty;
      if (name === "word/settings.xml") dirty = cleanSettings(d) || dirty;
    }
    const n = applyReplacer(unitsFor(name, d), replacer, true);
    replacements += n;
    if (n || dirty) zip.file(name, serializeXml(d));
  }
  wipeMetadata(zip);
  if (mode === "pseudonymise") await writeMarker(zip, opts.caseId!);
  if (hidden) issues.push({ severity: "warn", code: "HIDDEN_TEXT" });
  if (tracked) issues.push({ severity: "warn", code: mode === "redact" ? "TRACKED_ACCEPTED" : "TRACKED_KEPT" });

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const leak = createFinder(plan.identities.flatMap(i => i.surfaces));
  await verify(out, leak, mode);

  const counts = (tracker ?? redactor)!.counts;
  return { bytes: out, replacements, perIdentity: new Map(counts), entries: tracker?.entries() ?? [], issues };
}

export interface RestoreResult { bytes: Uint8Array; replacements: number; issues: Issue[] }

/** Restore exact pseudonyms from a decrypted mapping into a new package. */
export async function restoreDocx(bytes: Uint8Array, mapping: { caseId: string; entries: MappingEntry[] }): Promise<RestoreResult> {
  const { zip, docs, issues } = await load(bytes, "restore");
  const known = new Set(mapping.entries.map(e => e.token));
  const found = new Set<string>();
  for (const [n, d] of docs) for (const u of unitsFor(n, d)) for (const m of u.text.matchAll(TOKEN_GLOBAL)) found.add(m[0]);
  const marker = await readMarker(zip);
  if (marker && marker !== mapping.caseId) throw new ProcessingBlocked([{ severity: "block", code: "CASE_MISMATCH" }]);
  if (!marker) issues.push({ severity: "warn", code: "NO_CASE_MARKER" });
  const unmapped = [...found].filter(t => !known.has(t));
  if (unmapped.length) throw new ProcessingBlocked([{ severity: "block", code: "UNMAPPED_TOKENS", count: unmapped.length }]);
  if (!found.size) throw new ProcessingBlocked([{ severity: "block", code: "NO_TOKENS_FOUND" }]);

  const restorer = createRestorer(mapping.entries);
  let replacements = 0;
  for (const [name, d] of docs) {
    const n = applyReplacer(unitsFor(name, d), restorer.replacer, false);
    if (n) { replacements += n; zip.file(name, serializeXml(d)); }
  }
  if (zip.file("docProps/custom.xml") && marker) await removePart(zip, "docProps/custom.xml");
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await verify(out, TOKEN_SHAPE, "restore");
  return { bytes: out, replacements, issues };
}
