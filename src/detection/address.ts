import type { Detection } from "../core/types";
import type { Detector } from "./rules";

const SP = "[ \\u00a0]";
const CAPW = "\\p{Lu}[\\p{L}'’\\-]*";
const PART = "(?:de la|de|du|des|d['’]|l['’]|la|le|les|et|sur|en|aux?|saint|sainte|st)";
const FR_NAME = `(?:${PART}${SP}?)*${CAPW}(?:${SP}+(?:${PART}${SP}?)*${CAPW}){0,5}`;
const ci = (w: string) => w.replace(/\[[^\]]*\]|\p{L}/gu, m => m.length > 1 ? m.slice(0, -1) + m.slice(1, -1).toUpperCase() + "]" : `[${m}${m.toUpperCase()}]`);
const FR_TYPE = ci("(?:rue|avenue|av\\.|boulevard|bd|place|chemin|impasse|all[ée]e|quai|route|cours|passage|square|cit[ée]|villa|r[ée]sidence|faubourg|lotissement|esplanade|promenade|ruelle|sentier|zone industrielle|ZI|ZA)");
const FR_POST = `(?:,?${SP}*(?:\\d{5})${SP}+\\p{Lu}[\\p{L}'’\\-]*(?:[ \\-]\\p{Lu}[\\p{L}'’\\-]*){0,3}(?:${SP}+CEDEX(?:${SP}*\\d{1,2})?)?)`;
const FR_ADDR = new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,4}(?:${SP}?(?:bis|ter|quater|[A-D]))?,?${SP}+${FR_TYPE}${SP}+${FR_NAME}${FR_POST}?`, "gu");

const FR_POSTCODE = new RegExp(`(?<![\\p{L}\\p{N}])\\d{5}${SP}+\\p{Lu}[\\p{L}'’\\-]*(?:[ \\-]\\p{Lu}[\\p{L}'’\\-]*){0,3}`, "gu");
const SUFFIX = "(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr|Close|Court|Ct|Way|Place|Pl|Square|Gardens|Terrace|Crescent|Hill|Park|Row|Mews|Grove|Boulevard|Blvd|Parkway|Pkwy|Circle|Highway|Hwy)";
const EN_STREET = `\\d{1,5}[A-Z]?${SP}+(?:\\p{Lu}[\\p{L}'’\\-]*${SP}+){1,3}${SUFFIX}\\b\\.?`;
const UK_POST = "\\b[A-Z]{1,2}\\d[A-Z\\d]?" + SP + "?\\d[A-Z]{2}\\b";
const CITY = `\\p{Lu}[\\p{L}.\\-]*(?![\\p{L}\\p{N}])(?:${SP}\\p{Lu}[\\p{L}.\\-]*(?![\\p{L}\\p{N}])){0,2}`;
const TAIL = `(?:,${SP}*${CITY})?(?:,${SP}*[A-Z]{2}${SP}+\\d{5}(?:-\\d{4})?|,?${SP}*${UK_POST})?`;
const EN_ADDR = new RegExp(`(?<![\\p{L}\\p{N}])${EN_STREET}${TAIL}`, "gu");
const UK_POSTCODE = new RegExp(`(?<![\\p{L}\\p{N}])${UK_POST}`, "gu");

function collect(id: string, re: RegExp, text: string, confidence: Detection["confidence"]): Detection[] {
  const out: Detection[] = [];
  for (const m of text.matchAll(re)) {
    const value = m[0].replace(/[\s,;.]+$/u, "");
    out.push({ start: m.index!, end: m.index! + value.length, kind: "ADDRESS", value, confidence, source: id });
  }
  return out;
}

export const addressDetectors: Detector[] = [
  { id: "fr-address", run: t => collect("fr-address", FR_ADDR, t, "medium") },
  { id: "en-address", run: t => collect("en-address", EN_ADDR, t, "medium") },
  // Postcode + city on its own line (street is in another paragraph).
  { id: "fr-postcode", run: t => collect("fr-postcode", FR_POSTCODE, t, "medium") },
  // A bare UK postcode is a weaker signal than a full street address.
  { id: "uk-postcode", run: t => collect("uk-postcode", UK_POSTCODE, t, "low") }
];
