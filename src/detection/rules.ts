import type { Confidence, Detection, EntityKind } from "../core/types";
import { ibanValid, luhn } from "./validators";

export interface Detector { id: string; run(text: string): Detection[] }

const SP = "[ \\u00a0\\u202f]";
const MONTHS_FR = "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";
const MONTHS_EN = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec";

/** Regex detector helper: `group` selects the capture group holding the sensitive value (0 = whole match). */
function rx(id: string, kind: EntityKind, re: RegExp, confidence: Confidence | ((m: RegExpExecArray) => Confidence | null), group = 0): Detector {
  return {
    id,
    run(text) {
      const out: Detection[] = [];
      for (const m of text.matchAll(re)) {
        const c = typeof confidence === "function" ? confidence(m as RegExpExecArray) : confidence;
        if (!c) continue;
        let value = m[group];
        if (!value) continue;
        const start = m.index! + (group === 0 ? 0 : m[0].indexOf(value));
        const trimmed = value.replace(/[.,;:\s]+$/u, "");
        value = trimmed; if (!value) continue;
        out.push({ start, end: start + value.length, kind, value, confidence: c, source: id });
      }
      return out;
    }
  };
}

const email = rx("email", "EMAIL", /(?<![\p{L}\p{N}._%+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/gu, "high");

// Phones. FR: 0X XX XX XX XX / +33 X ... ; UK: +44 / 0 prefix 10-11 digits; US/CA: (555) 123-4567, 555-123-4567, +1 ...
const phoneFR = rx("phone-fr", "PHONE", new RegExp(`(?<![\\p{L}\\p{N}+])(?:(?:\\+|00)33${SP}?(?:\\(0\\)${SP}?)?|0)[1-9](?:[ .\\-\\u00a0]?\\d{2}){4}(?![\\p{L}\\p{N}])`, "gu"), "medium");
const phoneUK = rx("phone-uk", "PHONE", new RegExp(`(?<![\\p{L}\\p{N}+])(?:(?:\\+|00)44${SP}?(?:\\(0\\)${SP}?)?|0)(?:\\d${SP}?){9,10}(?![\\p{L}\\p{N}])`, "gu"),
  m => { const d = m[0].replace(/\D/g, ""); return /^(?:0|0044|44)/.test(d) && d.replace(/^0044|^44/, "0").length >= 10 && d.replace(/^0044|^44/, "0").length <= 11 && /^(?:0|0044|44)[1-37]/.test(d) ? "medium" : null; });
const phoneUS = rx("phone-us", "PHONE", new RegExp(`(?<![\\p{L}\\p{N}+])(?:\\+1[ .\\-]?)?(?:\\([2-9]\\d{2}\\)${SP}?|[2-9]\\d{2}[ .\\-])\\d{3}[ .\\-]\\d{4}(?![\\p{L}\\p{N}])`, "gu"), "medium");

const iban = rx("iban", "IBAN", /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?:[ \u00a0]?[A-Z0-9]{4}){2,7}(?:[ \u00a0]?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/gu,
  m => ibanValid(m[0].replace(/\u00a0/g, " ")) ? "high" : (/^FR\d{2}/.test(m[0]) && m[0].replace(/\s/g, "").length === 27 ? "low" : null));

// SIREN (9) / SIRET (14): Luhn-valid; context keyword raises confidence.
const siren = rx("fr-siren-siret", "ID", new RegExp(`(?<![\\p{L}\\p{N}])(?:SIRE[NT]|RCS(?:${SP}+[\\p{Lu}][\\p{L}\\-]+)?|n°${SP}?)?${SP}*:?${SP}*(\\d{3}${SP}?\\d{3}${SP}?\\d{3}(?:${SP}?\\d{5})?)(?![\\p{L}\\p{N}])`, "gu"),
  m => { const d = m[1].replace(/\D/g, ""); if (d.length !== 9 && d.length !== 14) return null; if (!luhn(d)) return null; return /SIRE[NT]|RCS/.test(m[0]) ? "high" : "medium"; }, 1);
const vat = rx("vat", "ID", /(?<![\p{L}\p{N}])(?:FR[ ]?[0-9A-Z]{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}|GB[ ]?\d{3}[ ]?\d{4}[ ]?\d{2}(?:[ ]?\d{3})?)(?![\p{L}\p{N}])/gu, "medium");
const ukCompany = rx("uk-company-no", "ID", /(?:company|registration|registered)[ \u00a0]+(?:no\.?|number|n°)[ \u00a0]*:?[ \u00a0]*((?:SC|NI|OC)?\d{6,8})(?![\p{L}\p{N}])/giu, "medium", 1);
const ein = rx("us-ein", "ID", /(?:EIN|Tax[ \u00a0]+ID|TIN)[ \u00a0]*(?:No\.?|#|:)?[ \u00a0]*(\d{2}-\d{7})(?!\d)/giu, "medium", 1);
const ssn = rx("us-ssn", "ID", /(?<![\p{L}\p{N}-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\p{L}\p{N}-])/gu, "medium");
const nir = rx("fr-nir", "ID", new RegExp(`(?<![\\p{L}\\p{N}])[12]${SP}?\\d{2}${SP}?(?:0[1-9]|1[0-2])${SP}?(?:\\d{2}|2[AB])${SP}?\\d{3}${SP}?\\d{3}(?:${SP}?\\d{2})?(?![\\p{L}\\p{N}])`, "gu"), "medium");

// Dates of birth: only dates preceded by a birth keyword within the same sentence fragment.
const DATE = `(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{1,2}(?:er)?${SP}+(?:${MONTHS_FR})${SP}+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?${SP}+(?:of${SP}+)?(?:${MONTHS_EN})\\.?,?${SP}+\\d{4}|(?:${MONTHS_EN})\\.?${SP}+\\d{1,2}(?:st|nd|rd|th)?,?${SP}+\\d{4}|\\d{4}-\\d{2}-\\d{2})`;
const dob = rx("dob", "DOB", new RegExp(`(?:n[ée]e?${SP}+le|n[ée]e?${SP}+en|date${SP}+de${SP}+naissance|born(?:${SP}+on)?|date${SP}+of${SP}+birth|d\\.?o\\.?b\\.?|birth${SP}*date)${SP}*[:,]?${SP}*(${DATE})`, "giu"), "medium", 1);

// Case / court references.
const caseRef = rx("case-ref", "CASE_REF", new RegExp([
  `(?:N°${SP}*)?\\bRG${SP}*(?:n°|N°|:)?${SP}*\\d{2}[/.]\\d{3,6}`,
  `\\[\\d{4}\\]${SP}+(?:EWHC|EWCA|UKSC|UKHL|UKUT|UKFTT|CSIH|CSOH|NICA)${SP}+\\d+(?:${SP}*\\([A-Za-z]+\\))?`,
  `(?:Claim|Case|Cause|Docket|Appeal)${SP}+(?:No\\.?|Number|n°|#)${SP}*:?${SP}*(?=[A-Z0-9\\-/]*\\d)[A-Z0-9][A-Z0-9\\-/]{3,24}`,
  `\\b\\d{1,2}:\\d{2}-(?:cv|cr|mc|md|bk)-\\d{3,6}(?:-[A-Z]{2,5})?`,
  `(?:parquet|dossier|affaire|pourvoi|requête)${SP}+(?:n°|N°|no\\.?)${SP}*:?${SP}*(?=[A-Z0-9\\-/. ]*\\d)[A-Z0-9][A-Z0-9\\-/. ]{3,20}[A-Z0-9]`
].join("|"), "giu"), "medium");

export const ruleDetectors: Detector[] = [email, iban, siren, vat, ukCompany, ein, ssn, nir, phoneFR, phoneUK, phoneUS, dob, caseRef];
