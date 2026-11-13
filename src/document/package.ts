import JSZip from "jszip";
import { ProcessingBlocked, type Issue, type IssueCode, type Mode } from "../core/types";
import { elements, parseXml, serializeXml } from "./ooxml";

export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
const CUSTOM_CT = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
export const MARKER_NAME = "LegalAnonymiserCaseId";

export type PartClass = "ct" | "rels" | "xml" | "media" | "inert" | "meta" | "remove-always" | "remove-redact" | "embed" | "altchunk" | "unknown";

const XML_PARTS = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|styles|stylesWithEffects|settings|webSettings|fontTable|numbering|theme\/[^/]+|charts\/[^/]+|diagrams\/[^/]+|drawings\/[^/]+|ink\/[^/]+|glossary\/.+)\.xml$/;
const RULES: Array<[RegExp, PartClass]> = [
  [/^\[Content_Types\]\.xml$/, "ct"],
  [/\.rels$/, "rels"],
  [/^docProps\/thumbnail\./i, "remove-always"],
  [/^docProps\/(?:core|app)\.xml$/, "meta"],
  [/^docProps\/custom\.xml$/, "remove-always"],
  [/^customXml\//, "remove-always"],
  [/^word\/(?:people|peopleExtensible)\.xml$/, "remove-always"],
  [/^word\/printerSettings\//, "remove-always"],
  [/^word\/webextensions\//, "remove-always"],
  [/^word\/(?:comments|commentsExtended|commentsIds|commentsExtensible)\.xml$/, "remove-redact"],
  [/^word\/(?:embeddings|activeX)\/|^word\/vba/i, "embed"],
  [/^word\/(?:afchunk|chunk)/i, "altchunk"],
  [/^word\/(?:glossary\/)?media\/.+\.(?:png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp|jfif|wdp|hdp)$/i, "media"],
  [/^word\/fonts\/.+\.(?:odttf|ttf|otf)$/i, "inert"],
  [XML_PARTS, "xml"]
];
export function classify(name: string): PartClass {
  for (const [re, c] of RULES) if (re.test(name)) return c;
  return "unknown";
}

export const MAX_BYTES = 150 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED = 1024 * 1024 * 1024;

export async function openPackage(bytes: Uint8Array): Promise<JSZip> {
  if (bytes.length > MAX_BYTES) throw new ProcessingBlocked([{ severity: "block", code: "TOO_LARGE" }]);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new ProcessingBlocked([{ severity: "block", code: "NOT_DOCX" }]); }
  const names = partNames(zip);
  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) throw new ProcessingBlocked([{ severity: "block", code: "NOT_DOCX" }]);
  // JSZip keeps declared sizes in a private field; use it only as a zip-bomb guard.
  const total = names.reduce((n, f) => n + ((zip.files[f] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (names.length > MAX_ENTRIES || total > MAX_UNCOMPRESSED) throw new ProcessingBlocked([{ severity: "block", code: "TOO_LARGE" }]);
  return zip;
}

export const partNames = (zip: JSZip) => Object.keys(zip.files).filter(n => !zip.files[n].dir);

/** Resolve a relationship target relative to its source part. */
export function resolveTarget(relsPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const srcDir = relsPath.replace(/(^|\/)_rels\/[^/]*$/, "$1").replace(/\/$/, "");
  const parts = (srcDir ? srcDir.split("/") : []).concat(target.split("/"));
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}

export function relsOf(doc: Document) { return elements(doc, REL_NS, "Relationship"); }

/** Static structural audit. Blocks for content that cannot be sanitised; warnings for transparency. */
export async function auditPackage(zip: JSZip, mode: Mode | "restore"): Promise<Issue[]> {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], code: IssueCode, part?: string, count?: number) => issues.push({ severity, code, part, count });
  const names = partNames(zip);
  let images = 0; const removed: string[] = [];
  for (const n of names) {
    const c = classify(n);
    if (c === "unknown") { if (mode !== "restore") add("block", "UNKNOWN_PART", n); }
    else if (c === "embed") add("block", "EMBEDDED_OBJECT", n);
    else if (c === "altchunk") add("block", "ALT_CHUNK", n);
    else if (c === "media") images++;
    else if (mode !== "restore" && (c === "remove-always" || (c === "remove-redact" && mode === "redact"))) removed.push(n);
  }
  for (const n of names.filter(n => classify(n) === "rels")) {
    const doc = parseXml(await zip.file(n)!.async("string"));
    for (const r of relsOf(doc)) {
      const type = r.getAttribute("Type") ?? "";
      if (/\/aFChunk$/.test(type)) add("block", "ALT_CHUNK", n);
      if (r.getAttribute("TargetMode") === "External" && !/\/(hyperlink|image)$/.test(type)) add("block", "EXTERNAL_RELATIONSHIP", n);
    }
  }
  if (mode === "restore") return issues;
  if (images) add("warn", "IMAGES", undefined, images);
  if (removed.some(n => /^customXml\//.test(n))) add("warn", "CUSTOM_XML_REMOVED");
  if (removed.some(n => /comments/.test(n))) add("warn", "COMMENTS_REMOVED");
  if (removed.length) add("warn", "PARTS_REMOVED", undefined, removed.length);
  add("warn", "METADATA_WIPED");
  return issues;
}

async function readDoc(zip: JSZip, name: string) { return parseXml(await zip.file(name)!.async("string")); }

/** Remove a part together with its relationships and content-type override. */
export async function removePart(zip: JSZip, name: string): Promise<void> {
  zip.remove(name);
  for (const rels of partNames(zip).filter(n => n.endsWith(".rels"))) {
    const doc = await readDoc(zip, rels);
    let changed = false;
    for (const r of relsOf(doc)) {
      if (r.getAttribute("TargetMode") !== "External" && resolveTarget(rels, r.getAttribute("Target") ?? "") === name) { r.parentNode!.removeChild(r); changed = true; }
    }
    if (changed) zip.file(rels, serializeXml(doc));
  }
  // Rels belonging to the removed part go too.
  const own = name.replace(/([^/]*)$/, "_rels/$1.rels");
  if (zip.file(own)) zip.remove(own);
  const ct = await readDoc(zip, "[Content_Types].xml");
  for (const o of elements(ct, CT_NS, "Override")) {
    if (o.getAttribute("PartName") === "/" + name) o.parentNode!.removeChild(o);
  }
  zip.file("[Content_Types].xml", serializeXml(ct));
}

export async function writeMarker(zip: JSZip, caseId: string): Promise<void> {
  zip.file("docProps/custom.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="${MARKER_NAME}"><vt:lpwstr>${caseId}</vt:lpwstr></property></Properties>`);
  const ct = await readDoc(zip, "[Content_Types].xml");
  const o = ct.createElementNS(CT_NS, "Override");
  o.setAttribute("PartName", "/docProps/custom.xml"); o.setAttribute("ContentType", CUSTOM_CT);
  ct.documentElement.appendChild(o);
  zip.file("[Content_Types].xml", serializeXml(ct));
  const root = await readDoc(zip, "_rels/.rels");
  const r = root.createElementNS(REL_NS, "Relationship");
  const ids = new Set(relsOf(root).map(x => x.getAttribute("Id")));
  let i = 1; while (ids.has(`rIdLA${i}`)) i++;
  r.setAttribute("Id", `rIdLA${i}`); r.setAttribute("Type", CUSTOM_REL); r.setAttribute("Target", "docProps/custom.xml");
  root.documentElement.appendChild(r);
  zip.file("_rels/.rels", serializeXml(root));
}

export async function readMarker(zip: JSZip): Promise<string | null> {
  const f = zip.file("docProps/custom.xml");
  if (!f) return null;
  const doc = parseXml(await f.async("string"));
  for (const p of elements(doc, undefined, "property")) {
    if (p.getAttribute("name") === MARKER_NAME) return p.textContent?.trim() || null;
  }
  return null;
}

/** Replace core/app properties with empty ones (author, title, company, TitlesOfParts… are personal or document-derived). */
export function wipeMetadata(zip: JSZip): void {
  if (zip.file("docProps/core.xml")) zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`);
  if (zip.file("docProps/app.xml")) zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`);
}

/** Structural validity: every XML part parses, every internal relationship target exists, every r:* reference resolves, every part has a content type. */
export async function checkIntegrity(zip: JSZip): Promise<Issue[]> {
  const bad: Issue[] = [];
  const names = partNames(zip);
  const fail = (part: string) => bad.push({ severity: "block", code: "INTEGRITY", part });
  const ct = await readDoc(zip, "[Content_Types].xml").catch(() => null);
  const defaults = new Set(ct ? elements(ct, CT_NS, "Default").map(d => (d.getAttribute("Extension") ?? "").toLowerCase()) : []);
  const overrides = new Set(ct ? elements(ct, CT_NS, "Override").map(o => (o.getAttribute("PartName") ?? "").slice(1)) : []);
  const relIds = new Map<string, Set<string>>();
  for (const n of names) {
    if (n !== "[Content_Types].xml" && !overrides.has(n) && !defaults.has((n.split(".").pop() ?? "").toLowerCase())) fail(n);
    if (!/\.(xml|rels)$/i.test(n) || classify(n) === "media") continue;
    let doc: Document;
    try { doc = parseXml(await zip.file(n)!.async("string")); } catch { fail(n); continue; }
    if (n.endsWith(".rels")) {
      const ids = new Set<string>();
      for (const r of relsOf(doc)) {
        ids.add(r.getAttribute("Id") ?? "");
        if (r.getAttribute("TargetMode") !== "External" && !zip.file(resolveTarget(n, r.getAttribute("Target") ?? ""))) fail(n);
      }
      relIds.set(n, ids);
    }
  }
  for (const n of names.filter(n => /\.xml$/i.test(n) && classify(n) !== "ct" && classify(n) !== "media")) {
    const doc = parseXml(await zip.file(n)!.async("string"));
    const relsName = n.replace(/([^/]*)$/, "_rels/$1.rels");
    const ids = relIds.get(relsName) ?? new Set<string>();
    for (const el of elements(doc)) for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI === R_NS && a.value && !ids.has(a.value)) { fail(n); }
    }
  }
  return bad;
}
