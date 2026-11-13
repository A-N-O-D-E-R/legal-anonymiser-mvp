import { TOKEN_PREFIX, redactionLabel, type Plan, type MappingEntry, type EntityKind } from "./types";

const APOS = "['’ʼ‘`´]";
const HYPH = "[-‐‑‒–]";
const WS = "[ \\u00a0\\u202f]+";

/** Canonical comparison key: NFC, case-folded, whitespace/apostrophe/hyphen variants unified. */
export function matchKey(s: string): string {
  return s.normalize("NFC").replace(/[\s\u00a0\u202f]+/g, " ").trim().toLowerCase()
    .replace(/[’ʼ‘`´]/g, "'").replace(/[‐‑‒–]/g, "-");
}

/** Digits-only style keys so "06 12 34 56 78" and "+33 6 12 34 56 78" share one identity. */
export function identityKey(kind: EntityKind, s: string): string {
  switch (kind) {
    case "PHONE": {
      let d = s.replace(/\D/g, "");
      if (d.startsWith("0033")) d = "0" + d.slice(4);
      else if (d.startsWith("33") && d.length === 11) d = "0" + d.slice(2);
      else if (d.startsWith("44") && d.length >= 11) d = "0" + d.slice(2);
      else if (d.startsWith("1") && d.length === 11) d = d.slice(1);
      return d;
    }
    case "IBAN": case "ID": return s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    default: return matchKey(s);
  }
}

const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/** Regex source matching a literal surface tolerant to whitespace, apostrophe, hyphen and NFC/NFD variants. */
export function surfaceToPattern(surface: string): string {
  const chars = [...surface.normalize("NFC").trim()];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/[\s\u00a0\u202f]/.test(c)) { if (!out.endsWith(WS)) out += WS; continue; }
    if (/['’ʼ‘`´]/.test(c)) { out += APOS; continue; }
    if (/[-‐‑‒–]/.test(c)) { out += HYPH; continue; }
    const nfd = c.normalize("NFD");
    out += nfd !== c ? `(?:${esc(c)}|${esc(nfd)})` : esc(c);
  }
  const first = chars[0], last = chars[chars.length - 1];
  const pre = first && isWordChar(first) ? "(?<![\\p{L}\\p{N}_])" : "";
  const post = last && isWordChar(last) ? "(?![\\p{L}\\p{N}_])" : "";
  return `${pre}(?:${out})${post}`;
}

export interface Span { start: number; end: number; replacement: string }

export class Replacer {
  constructor(
    private re: RegExp | null,
    private resolve: (matched: string) => string | null
  ) {}
  /** Non-overlapping, left-to-right, longest-alternative-first spans. */
  spans(text: string): Span[] {
    if (!this.re) return [];
    const out: Span[] = [];
    this.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = this.re.exec(text))) {
      if (m[0].length === 0) { this.re.lastIndex++; continue; }
      const replacement = this.resolve(m[0]);
      if (replacement !== null) out.push({ start: m.index, end: m.index + m[0].length, replacement });
    }
    return out;
  }
}

function combine(patterns: string[], flags: string): RegExp | null {
  if (!patterns.length) return null;
  return new RegExp(patterns.join("|"), flags);
}

export interface PseudonymTracker {
  replacer: Replacer;
  /** Mapping entries in creation order (one per distinct exact spelling). */
  entries(): MappingEntry[];
  counts: Map<string, number>;
}

/**
 * Pseudonymising replacer. All spellings that differ only by case/spacing/apostrophes share the
 * identity's base number; each distinct *exact* spelling gets its own token (…_V2, …_V3) so that
 * restoration is exact.
 */
export function createPseudonymizer(plan: Plan): PseudonymTracker {
  const byKey = new Map<string, number>();
  plan.identities.forEach((id, i) => id.surfaces.forEach(s => { if (!byKey.has(matchKey(s))) byKey.set(matchKey(s), i); }));
  const patterns = [...new Set(plan.identities.flatMap(i => i.surfaces))]
    .sort((a, b) => b.length - a.length).map(surfaceToPattern);
  const variants = plan.identities.map(() => new Map<string, string>());
  const entries: MappingEntry[] = [];
  const counts = new Map<string, number>();
  const replacer = new Replacer(combine(patterns, "giu"), matched => {
    const idx = byKey.get(matchKey(matched));
    if (idx === undefined) return null;
    const id = plan.identities[idx];
    const exact = matched.normalize("NFC");
    let token = variants[idx].get(exact);
    if (!token) {
      const n = variants[idx].size;
      token = n === 0 ? id.base : `${id.base}_V${n + 1}`;
      variants[idx].set(exact, token);
      entries.push({ token, kind: id.kind, original: exact });
    }
    counts.set(id.id, (counts.get(id.id) ?? 0) + 1);
    return token;
  });
  return { replacer, entries: () => entries, counts };
}

export function createRedactor(plan: Plan): { replacer: Replacer; counts: Map<string, number> } {
  const byKey = new Map<string, number>();
  plan.identities.forEach((id, i) => id.surfaces.forEach(s => { if (!byKey.has(matchKey(s))) byKey.set(matchKey(s), i); }));
  const patterns = [...new Set(plan.identities.flatMap(i => i.surfaces))]
    .sort((a, b) => b.length - a.length).map(surfaceToPattern);
  const counts = new Map<string, number>();
  const replacer = new Replacer(combine(patterns, "giu"), matched => {
    const idx = byKey.get(matchKey(matched));
    if (idx === undefined) return null;
    const id = plan.identities[idx];
    counts.set(id.id, (counts.get(id.id) ?? 0) + 1);
    return redactionLabel(id.kind);
  });
  return { replacer, counts };
}

/** Restores ONLY exact, case-sensitive tokens present in the mapping. */
export function createRestorer(entries: MappingEntry[]): { replacer: Replacer; counts: Map<string, number> } {
  const byToken = new Map(entries.map(e => [e.token, e.original]));
  const alt = [...byToken.keys()].sort((a, b) => b.length - a.length).map(esc);
  // `_` is not a boundary character here: pseudonymised identifiers such as bookmark names ("PERSON_003_clause") must restore too.
  const re = alt.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt.join("|")})(?![\\p{L}\\p{N}])`, "gu") : null;
  const counts = new Map<string, number>();
  return {
    counts,
    replacer: new Replacer(re, tok => {
      const o = byToken.get(tok);
      if (o === undefined) return null;
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
      return o;
    })
  };
}

/** Case-insensitive finder for verification (any included surface). */
export function createFinder(surfaces: string[]): RegExp | null {
  return combine([...new Set(surfaces)].sort((a, b) => b.length - a.length).map(surfaceToPattern), "iu");
}

export function tokenFor(kind: EntityKind, n: number): string {
  return `${TOKEN_PREFIX[kind]}_${String(n).padStart(3, "0")}`;
}
