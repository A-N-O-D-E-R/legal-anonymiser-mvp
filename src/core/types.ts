export const ENTITY_KINDS = [
  "PERSON", "COMPANY", "ADDRESS", "EMAIL", "PHONE", "IBAN", "DOB", "CASE_REF", "ID", "CUSTOM"
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Prefix used in pseudonyms, e.g. PERSON_001. */
export const TOKEN_PREFIX: Record<EntityKind, string> = {
  PERSON: "PERSON", COMPANY: "COMPANY", ADDRESS: "ADDRESS", EMAIL: "EMAIL", PHONE: "PHONE",
  IBAN: "IBAN", DOB: "DOB", CASE_REF: "CASEREF", ID: "ID", CUSTOM: "CUSTOM"
};

const prefixes = Object.values(TOKEN_PREFIX).join("|");
/** Shape of every pseudonym this app generates (used for collision checks only; restoration uses exact mapped tokens). */
export const TOKEN_SHAPE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${prefixes})_\\d{3,}(?:_V\\d+)?(?![\\p{L}\\p{N}])`, "u");
export const TOKEN_SHAPE_STRICT = new RegExp(`^(?:${prefixes})_\\d{3,}(?:_V\\d+)?$`);

export function redactionLabel(kind: EntityKind): string {
  return `[REDACTED_${kind}]`;
}

/** "manual" = added by the user. Everything else is a heuristic: never a guarantee. */
export type Confidence = "high" | "medium" | "low" | "manual";

export interface Detection {
  start: number;
  end: number;
  kind: EntityKind;
  value: string;
  confidence: Confidence;
  /** Detector id, e.g. "iban", "fr-address". Never contains document text. */
  source: string;
}

export interface Surface { text: string; count: number }

export interface Entity {
  id: string;
  kind: EntityKind;
  surfaces: Surface[];
  confidence: Confidence;
  source: string;
  include: boolean;
  manual: boolean;
}

export type Mode = "pseudonymise" | "redact";

export interface PlanIdentity {
  id: string;
  kind: EntityKind;
  /** Pseudonym of the first-seen spelling, e.g. PERSON_001. */
  base: string;
  surfaces: string[];
}
export interface Plan { mode: Mode; identities: PlanIdentity[]; warnings: Issue[] }

export interface MappingEntry { token: string; kind: EntityKind; original: string }

export type IssueSeverity = "block" | "warn";
export interface Issue {
  severity: IssueSeverity;
  /** Stable code, translated by the UI. */
  code: IssueCode;
  /** Package part name or short count; NEVER document text. */
  part?: string;
  count?: number;
}

/** Thrown when processing must stop rather than produce a misleading document. */
export class ProcessingBlocked extends Error {
  constructor(public issues: Issue[]) {
    super("Processing blocked: " + issues.map(i => i.code + (i.part ? `(${i.part})` : "")).join(", "));
  }
}

export const ISSUE_CODES = [
  "UNKNOWN_PART", "EMBEDDED_OBJECT", "ALT_CHUNK", "EXTERNAL_RELATIONSHIP", "TOKEN_COLLISION",
  "UNMAPPED_TOKENS", "CASE_MISMATCH", "NO_CASE_MARKER", "RESIDUAL", "INTEGRITY", "NOT_DOCX", "TOO_LARGE",
  "IMAGES", "TRACKED_ACCEPTED", "COMMENTS_REMOVED", "CUSTOM_XML_REMOVED", "METADATA_WIPED", "HIDDEN_TEXT",
  "PARTS_REMOVED", "TRACKED_KEPT", "NAME_CONFLICT", "NO_ENTITIES", "NO_TOKENS_FOUND", "MAPPING_INVALID"
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
