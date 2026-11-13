import type { Detection } from "../core/types";
import type { Detector } from "./rules";
import { FIRST_NAMES, STOPWORDS } from "./names-data";
import { fold } from "./validators";

const TOKEN = /\p{L}[\p{L}'’-]*/gu;
const isCap = (t: string) => /^\p{Lu}\p{Ll}/u.test(t) || /^(?:O|D|L)['’]\p{Lu}/u.test(t);
const isAllCaps = (t: string) => /^\p{Lu}{2,}(?:['’-]\p{Lu}+)*$/u.test(t);
const isStop = (t: string) => STOPWORDS.has(fold(t));
const PARTICLE = new Set(["de", "du", "des", "van", "von", "der", "den", "di", "da", "del", "le", "la", "el", "al", "ben", "bin", "d'", "d’"]);
const isFirst = (t: string) => isCap(t) && t.split("-").every(p => FIRST_NAMES.has(fold(p)));
const TITLES = /^(?:M|MM|Mme|Mmes|Mlle|Monsieur|Madame|Mademoiselle|Maître|Maitre|Me|Mr|Mrs|Ms|Miss|Mx|Dr|Pr|Prof|Professor|Sir|Dame|Judge|Justice|Hon)$/u;

interface Tok { text: string; start: number; end: number }

function tokenize(text: string): Tok[] {
  return [...text.matchAll(TOKEN)].map(m => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}
const adjacent = (text: string, a: Tok, b: Tok) => /^[ \u00a0]+$/.test(text.slice(a.end, b.start));
const nameLike = (t: string) => (isCap(t) || isAllCaps(t)) && !isStop(t);

/** Collect up to `max` surname tokens (with optional lowercase particles) starting at index i. Returns end index (exclusive) or i. */
function surnameRun(text: string, toks: Tok[], i: number, max: number): number {
  let j = i, count = 0, endIdx = i;
  while (j < toks.length && count < max && (j === i || adjacent(text, toks[j - 1], toks[j]))) {
    const t = toks[j].text;
    if (PARTICLE.has(t.toLowerCase()) && j + 1 < toks.length && adjacent(text, toks[j], toks[j + 1]) && (nameLike(toks[j + 1].text) || PARTICLE.has(toks[j + 1].text.toLowerCase()))) { j++; continue; }
    if (!nameLike(t)) break;
    j++; count++; endIdx = j;
  }
  return count ? endIdx : i;
}

function persons(text: string): Detection[] {
  const toks = tokenize(text);
  const out: Detection[] = [];
  const push = (a: number, b: number, confidence: Detection["confidence"], source: string) =>
    out.push({ start: toks[a].start, end: toks[b - 1].end, kind: "PERSON", value: text.slice(toks[a].start, toks[b - 1].end), confidence, source });

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].text;
    // 1. Civility title + name(s)
    const bare = t.replace(/\.$/, "");
    if (TITLES.test(bare) && i + 1 < toks.length && adjacent(text.replace(/\./g, " "), toks[i], toks[i + 1]) ) {
      const end = surnameRun(text, toks, i + 1, 3);
      if (end > i + 1) { push(i + 1, end, "medium", "person-title"); i = end - 1; continue; }
    }
    // 2. Given name(s) followed by surname run: "Jean Dupont", "Marie-Claire Martin", "Jean de La Fontaine"
    if (isFirst(t)) {
      let j = i + 1;
      if (j < toks.length && adjacent(text, toks[i], toks[j]) && isFirst(toks[j].text) && j + 1 < toks.length && adjacent(text, toks[j], toks[j + 1]) && nameLike(toks[j + 1].text)) j++; // two given names
      const end = surnameRun(text, toks, j, 2);
      if (end > j) { push(i, end, "medium", "person-given-surname"); i = end - 1; continue; }
    }
    // 3. "DUPONT Jean" (ALL-CAPS surname before given name)
    if (isAllCaps(t) && !isStop(t) && i + 1 < toks.length && adjacent(text, toks[i], toks[i + 1]) && isFirst(toks[i + 1].text)) {
      push(i, i + 2, "medium", "person-surname-given"); i++; continue;
    }
  }
  return out;
}

const W = "\\p{Lu}[\\p{L}\\p{N}&'’\\-]*";
const LEGAL = "SASU|SAS|SARL|SELARL|SELAS|EURL|SCI|SNC|SCP|SCM|GIE|SA|S\\.A\\.S\\.|S\\.A\\.R\\.L\\.|S\\.A\\.|Ltd\\.?|Limited|LLC|LLP|Inc\\.?|Incorporated|Corp\\.?|Corporation|PLC|plc|GmbH|AG|N\\.V\\.|B\\.V\\.|LP";
const COMPANY = new RegExp(`(?<![\\p{L}\\p{N}])${W}(?:[ \\u00a0]+(?:${W}|&|and|et|of|de|du|des|la|le)){0,4}[ \\u00a0]+(?:${LEGAL})(?![\\p{L}\\p{N}])`, "gu");
const ORG_PREFIX = new RegExp(`(?<![\\p{L}\\p{N}])(?:Cabinet|Association|Fondation|Soci[ée]t[ée]|Banque|Universit[ée]|University of|Bank of|Law Firm of)[ \\u00a0]+(?:(?:de|du|des|d['’]|of)[ \\u00a0]+)?${W}(?:[ \\u00a0]+(?:${W}|&|et|and)){0,3}`, "gu");

function trimLeadingStop(text: string, start: number, end: number): number {
  const re = /^(\p{L}+)[ \u00a0]+/u;
  let s = start;
  for (;;) {
    const m = re.exec(text.slice(s, end));
    if (!m || !isStop(m[1]) || /^(?:cabinet|societe)$/.test(fold(m[1]))) return s;
    s += m[0].length;
  }
}

function companies(text: string): Detection[] {
  const out: Detection[] = [];
  const add = (re: RegExp, confidence: Detection["confidence"], source: string) => {
    for (const m of text.matchAll(re)) {
      const start = trimLeadingStop(text, m.index!, m.index! + m[0].length);
      const value = text.slice(start, m.index! + m[0].length).replace(/[\s,;]+$/u, "");
      if (value.split(/[ \u00a0]+/).length < 2) continue;
      out.push({ start, end: start + value.length, kind: "COMPANY", value, confidence, source });
    }
  };
  add(COMPANY, "medium", "company-legal-form");
  add(ORG_PREFIX, "low", "org-prefix");
  return out;
}

export const nameDetectors: Detector[] = [
  { id: "person", run: persons },
  { id: "company", run: companies }
];
