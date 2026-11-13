import { ENTITY_KINDS, TOKEN_SHAPE_STRICT, type MappingEntry } from "../core/types";

/**
 * .lamap v2: JSON envelope. Everything except `ciphertext` is plaintext but AUTHENTICATED: the header is the
 * AES-GCM additional data, so tampering with iterations, salt, IV, caseId or timestamp fails decryption.
 * Plaintext header holds only: random case id, creation time, algorithm names and KDF/cipher parameters.
 * The user-visible case label and all identities live inside the encrypted payload.
 */
export const FORMAT = "legal-anonymiser-mapping";
export const VERSION = 2;
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 2_000_000; // a hostile file must not be able to pin the CPU for minutes
export const MAX_MAPPING_BYTES = 16 * 1024 * 1024; // whole .lamap file, checked before any read/parse
export const MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024; // decrypted payload JSON
export const MAX_ENTRIES = 50_000;
export const MAX_ORIGINAL = 2000;
export const MAX_LABEL = 200;
export const MIN_PASSWORD = 12;

export interface MappingPayload { caseLabel: string; entries: MappingEntry[] }
export interface MappingFile { caseId: string; createdAt: string; iterations: number; payload: MappingPayload }

export type MappingErrorCode = "INVALID_FILE" | "UNSUPPORTED_VERSION" | "AUTH_FAILED" | "INVALID_PAYLOAD" | "WEAK_PASSWORD" | "TOO_LARGE";
export class MappingError extends Error {
  constructor(public code: MappingErrorCode) { super(code); }
}

const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true });

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(v: string): Uint8Array<ArrayBuffer> {
  if (typeof v !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw new MappingError("INVALID_FILE");
  const s = atob(v), out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function newCaseId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** NFKC-normalised so the same typed password gives the same key on every OS/keyboard. Never stored or logged. */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

interface Header { format: string; version: number; caseId: string; createdAt: string; kdf: string; iterations: number; salt: string; cipher: string; iv: string }
const aad = (h: Header): Uint8Array<ArrayBuffer> => new Uint8Array(enc.encode(JSON.stringify([h.format, h.version, h.caseId, h.createdAt, h.kdf, h.iterations, h.salt, h.cipher, h.iv])));

export function validatePayload(p: unknown): MappingPayload {
  const o = p as Partial<MappingPayload> | null;
  if (!o || typeof o.caseLabel !== "string" || !Array.isArray(o.entries) || o.caseLabel.length > MAX_LABEL || o.entries.length > MAX_ENTRIES) throw new MappingError("INVALID_PAYLOAD");
  const tokens = new Set<string>();
  for (const e of o.entries) {
    if (!e || typeof e.token !== "string" || typeof e.original !== "string" || !e.original || e.original.length > MAX_ORIGINAL ||
        !(ENTITY_KINDS as readonly string[]).includes(e.kind) || !TOKEN_SHAPE_STRICT.test(e.token) || tokens.has(e.token)) throw new MappingError("INVALID_PAYLOAD");
    tokens.add(e.token);
  }
  return { caseLabel: o.caseLabel, entries: o.entries.map(e => ({ token: e.token, kind: e.kind, original: e.original })) };
}

export async function encryptMapping(
  payload: MappingPayload, password: string,
  opts: { caseId?: string; iterations?: number; createdAt?: string } = {}
): Promise<Uint8Array> {
  if (password.length < MIN_PASSWORD) throw new MappingError("WEAK_PASSWORD");
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error("iterations out of range");
  validatePayload(payload);
  const body = enc.encode(JSON.stringify(payload));
  if (body.length > MAX_PLAINTEXT_BYTES) throw new MappingError("TOO_LARGE");
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const header: Header = {
    format: FORMAT, version: VERSION, caseId: opts.caseId ?? newCaseId(), createdAt: opts.createdAt ?? new Date().toISOString(),
    kdf: "PBKDF2-HMAC-SHA-256", iterations, salt: toB64(salt), cipher: "AES-256-GCM", iv: toB64(iv)
  };
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(header) }, key, body));
  return enc.encode(JSON.stringify({ ...header, ciphertext: toB64(ct) }, null, 2));
}

export async function decryptMapping(file: Uint8Array, password: string): Promise<MappingFile> {
  if (file.length > MAX_MAPPING_BYTES) throw new MappingError("TOO_LARGE");
  let h: Header & { ciphertext: string };
  try { h = JSON.parse(dec.decode(file)); } catch { throw new MappingError("INVALID_FILE"); }
  if (!h || typeof h !== "object" || h.format !== FORMAT) throw new MappingError("INVALID_FILE");
  if (h.version !== VERSION) throw new MappingError("UNSUPPORTED_VERSION");
  if (h.kdf !== "PBKDF2-HMAC-SHA-256" || h.cipher !== "AES-256-GCM" || !Number.isInteger(h.iterations) ||
      h.iterations < MIN_ITERATIONS || h.iterations > MAX_ITERATIONS ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(h.caseId) || Number.isNaN(Date.parse(h.createdAt))) throw new MappingError("INVALID_FILE");
  const salt = fromB64(h.salt), iv = fromB64(h.iv), ct = fromB64(h.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ct.length < 16) throw new MappingError("INVALID_FILE");
  if (ct.length > MAX_PLAINTEXT_BYTES + 16) throw new MappingError("TOO_LARGE"); // before the expensive KDF
  const key = await deriveKey(password, salt, h.iterations);
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(h) }, key, ct); }
  catch { throw new MappingError("AUTH_FAILED"); } // wrong password and tampering are indistinguishable by design
  let payload: unknown;
  try { payload = JSON.parse(dec.decode(plain)); } catch { throw new MappingError("INVALID_PAYLOAD"); }
  return { caseId: h.caseId, createdAt: h.createdAt, iterations: h.iterations, payload: validatePayload(payload) };
}

/** File name derived from the random case id only; never from user input or identities. */
export const mappingFileName = (caseId: string) => `case-${caseId.slice(0, 8)}.lamap`;
