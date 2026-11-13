import type { Span } from "../core/matcher";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const SEPARATOR = "\u0001";

/** Descendant elements (document order), optionally filtered by namespace and local names. Linear time (jsdom's getElementsByTagName* is quadratic). */
export function elements(root: Node, ns?: string, ...locals: string[]): Element[] {
  const out: Element[] = [];
  const visit = (e: Element) => {
    if ((ns === undefined || e.namespaceURI === ns) && (!locals.length || locals.includes(e.localName))) out.push(e);
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) visit(c);
  };
  const start = root.nodeType === 9 ? (root as Document).documentElement : (root as Element);
  if (start) visit(start);
  return out;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (elements(doc, undefined, "parsererror").length) throw new Error("XML_PARSE");
  return doc;
}

export function serializeXml(doc: Document): string {
  const body = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^?]*\?>\s*/, "");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${body}`;
}

/** A piece of text that can be matched as one string and rewritten without touching run formatting. */
export interface Unit {
  text: string;
  /** Attribute/field-code/URL context: replacement labels must be free of brackets. */
  plain: boolean;
  /** Apply sorted, non-overlapping spans (offsets into `text`). */
  apply(spans: Span[]): void;
}

interface Seg { node: Element | null; attr?: string; text: string }

function makeUnit(segs: Seg[], plain: boolean): Unit {
  const starts: number[] = []; let pos = 0;
  for (const s of segs) { starts.push(pos); pos += s.text.length; }
  const lens = segs.map(s => s.text.length);
  return {
    text: segs.map(s => s.text).join(""),
    plain,
    apply(spans) {
      const touched = new Set<number>();
      for (const sp of [...spans].reverse()) {
        let first = true;
        for (let i = 0; i < segs.length; i++) {
          const s0 = starts[i], e0 = s0 + lens[i];
          if (e0 <= sp.start || s0 >= sp.end) continue;
          const seg = segs[i];
          const from = Math.max(sp.start, s0) - s0, to = Math.min(sp.end, e0) - s0;
          seg.text = seg.text.slice(0, from) + (first ? sp.replacement : "") + seg.text.slice(to);
          first = false; touched.add(i);
        }
      }
      for (const i of touched) {
        const { node, attr, text } = segs[i];
        if (!node) continue;
        if (attr) node.setAttribute(attr, text);
        else {
          node.textContent = text;
          if (node.namespaceURI === W && /^\s|\s$|\s\s/.test(text)) node.setAttributeNS(XML_NS, "xml:space", "preserve");
        }
      }
    }
  };
}

const isW = (e: Element, ...names: string[]) => e.namespaceURI === W && names.includes(e.localName);
const isP = (e: Element) => (e.namespaceURI === W || e.namespaceURI === A) && e.localName === "p";

/** Attributes that carry free text (alt text, tooltips, bookmark/field names, WordArt, content-control labels). */
const ATTRS: Array<[string, string]> = [
  ["docPr", "descr"], ["docPr", "title"], ["docPr", "name"], ["cNvPr", "descr"], ["cNvPr", "title"], ["cNvPr", "name"],
  ["hlinkClick", "tooltip"], ["hyperlink", "tooltip"], ["hyperlink", "anchor"], ["bookmarkStart", "name"],
  ["fldSimple", "instr"], ["alias", "val"], ["tag", "val"], ["listItem", "displayText"], ["listItem", "value"],
  ["shape", "alt"], ["shape", "title"], ["imagedata", "title"], ["textpath", "string"], ["rect", "alt"]
];

/**
 * Collect every matchable text unit of a part:
 *  - one unit per paragraph (w:p / a:p) over its w:t / a:t text, across runs (nested paragraphs, e.g. text boxes, are separate units)
 *  - one unit per paragraph over its tracked-deleted w:delText
 *  - field instructions, chart cached values, and whitelisted text attributes
 * Tabs/breaks are separators, so a match never spans them.
 */
export function collectUnits(doc: Document): Unit[] {
  const units: Unit[] = [];
  const walkPara = (p: Element, live: Seg[], del: Seg[]) => {
    for (const child of Array.from(p.children)) {
      if (isP(child)) continue;
      const ns = child.namespaceURI, ln = child.localName;
      if ((ns === W && ln === "t") || (ns === A && ln === "t")) live.push({ node: child, text: child.textContent ?? "" });
      else if (ns === W && ln === "delText") del.push({ node: child, text: child.textContent ?? "" });
      else if ((ns === W && ["tab", "br", "cr", "noBreakHyphen", "softHyphen", "ptab", "instrText", "delInstrText", "sym"].includes(ln)) || (ns === A && ln === "br")) {
        live.push({ node: null, text: SEPARATOR }); del.push({ node: null, text: SEPARATOR });
        if (ns === W && (ln === "instrText" || ln === "delInstrText")) units.push(makeUnit([{ node: child, text: child.textContent ?? "" }], true));
      } else walkPara(child, live, del);
    }
  };
  for (const el of elements(doc)) {
    if (isP(el)) {
      const live: Seg[] = [], del: Seg[] = [];
      walkPara(el, live, del);
      if (live.some(s => s.node)) units.push(makeUnit(live, false));
      if (del.some(s => s.node)) units.push(makeUnit(del, false));
    } else if (el.namespaceURI === C && el.localName === "v") {
      units.push(makeUnit([{ node: el, text: el.textContent ?? "" }], false));
    }
    for (const [ln, attr] of ATTRS) {
      if (el.localName !== ln) continue;
      const attrNode = el.getAttributeNode(attr) ?? Array.from(el.attributes).find(a => a.localName === attr);
      if (attrNode?.value) units.push(makeUnit([{ node: el, attr: attrNode.name, text: attrNode.value }], true));
    }
  }
  return units.filter(u => u.text.trim());
}

/** Does any w:vanish (hidden text) exist? Hidden text is processed like visible text; reported for transparency. */
export function hasHiddenText(doc: Document): boolean {
  return elements(doc, W, "vanish").length > 0;
}

export function hasTrackedChanges(doc: Document): boolean {
  return elements(doc, W, "ins", "del", "moveFrom", "moveTo").length > 0;
}

const rm = (e: Element) => { e.parentNode?.removeChild(e); };
const unwrap = (e: Element) => { const p = e.parentNode; if (!p) return; while (e.firstChild) p.insertBefore(e.firstChild, e); p.removeChild(e); };

/** Accept all tracked changes: deleted content is dropped, insertions are kept, revision metadata removed. Returns true if modified. */
export function acceptTrackedChanges(doc: Document): boolean {
  let changed = false;
  const all = (n: string) => elements(doc, W, n);
  for (const n of ["del", "moveFrom"]) for (const e of all(n)) { rm(e); changed = true; }
  for (const n of ["ins", "moveTo"]) for (const e of all(n)) { if (e.parentElement && isW(e.parentElement, "rPr")) rm(e); else unwrap(e); changed = true; }
  for (const n of ["rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "tcPrChange", "trPrChange", "tblGridChange", "tblPrExChange", "numberingChange",
    "cellIns", "cellDel", "cellMerge", "moveFromRangeStart", "moveFromRangeEnd", "moveToRangeStart", "moveToRangeEnd", "delText", "delInstrText"]) {
    for (const e of all(n)) { rm(e); changed = true; }
  }
  return changed;
}

/** Remove comment anchors from a part whose comments part is being dropped. */
export function stripCommentMarkers(doc: Document): boolean {
  let changed = false;
  for (const n of ["commentRangeStart", "commentRangeEnd", "commentReference", "annotationRef"]) {
    for (const e of elements(doc, W, n)) { rm(e); changed = true; }
  }
  return changed;
}

/** Author/initials of revisions and comments are personal data: neutralise in every mode. */
export function anonymiseAuthors(doc: Document): boolean {
  let changed = false;
  for (const el of elements(doc)) {
    if (el.namespaceURI !== W) continue;
    if (el.hasAttributeNS(W, "author") && el.getAttributeNS(W, "author") !== "Author") { el.setAttributeNS(W, el.prefix ? `${el.prefix}:author` : "w:author", "Author"); changed = true; }
    if (el.hasAttributeNS(W, "initials") && el.getAttributeNS(W, "initials") !== "") { el.setAttributeNS(W, el.prefix ? `${el.prefix}:initials` : "w:initials", ""); changed = true; }
  }
  return changed;
}

/** Content-control data bindings would re-pull original values from custom XML; drop bindings (cached content stays). */
export function removeDataBindings(doc: Document): boolean {
  const list = elements(doc, W, "dataBinding");
  list.forEach(rm);
  return list.length > 0;
}

/** settings.xml: remove document variables, mail-merge sources, attached template path. */
export function cleanSettings(doc: Document): boolean {
  const list = elements(doc, W, "docVars", "mailMerge", "attachedTemplate", "rsids");
  list.forEach(rm);
  return list.length > 0;
}

export function removeXmlComments(doc: Document): boolean {
  let changed = false;
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 8 || c.nodeType === 7) { n.removeChild(c); changed = true; } else walk(c);
    }
  };
  walk(doc);
  return changed;
}

/** Everything text-like in a part, for leak verification: all text nodes, attribute values, and per-paragraph joined text. */
export function allTextSurfaces(doc: Document): string[] {
  const out: string[] = collectUnits(doc).map(u => u.text);
  const walk = (el: Element) => {
    for (const a of Array.from(el.attributes)) if (!a.name.startsWith("xmlns")) out.push(a.value);
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 || n.nodeType === 4 || n.nodeType === 8) out.push(n.nodeValue ?? "");
      else if (n.nodeType === 1) walk(n as Element);
    }
  };
  if (doc.documentElement) walk(doc.documentElement);
  return out.filter(s => s.trim());
}
