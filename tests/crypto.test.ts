import { describe, expect, it } from "vitest";
import { MAX_ENTRIES, MAX_LABEL, MAX_MAPPING_BYTES, MappingError, decryptMapping, encryptMapping, mappingFileName } from "../src/security/mappingCrypto";
import { assessPassword } from "../src/security/password";

const payload = { caseLabel: "Dupont c/ ABC", entries: [{ token: "PERSON_001", kind: "PERSON" as const, original: "Jean Dupont" }, { token: "EMAIL_001", kind: "EMAIL" as const, original: "jean@example.com" }] };
const PW = "correct horse battery staple 42!";
const ITER = 100_000; // fast for tests; production default is 600k
const enc = (o = {}) => encryptMapping(payload, PW, { iterations: ITER, ...o });
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: MappingError) => e.code);

describe("mapping encryption", () => {
  it("decrypts with the correct password", async () => {
    const f = await decryptMapping(await enc(), PW);
    expect(f.payload).toEqual(payload);
  });
  it("fails with an incorrect password", async () => {
    expect(await code(decryptMapping(await enc(), PW + "x"))).toBe("AUTH_FAILED");
  });
  it("rejects tampered ciphertext", async () => {
    const o = JSON.parse(text(await enc())); const c = o.ciphertext as string;
    o.ciphertext = c.slice(0, 10) + (c[10] === "A" ? "B" : "A") + c.slice(11);
    expect(await code(decryptMapping(new TextEncoder().encode(JSON.stringify(o)), PW))).toBe("AUTH_FAILED");
  });
  it.each([["caseId", "00000000-0000-4000-8000-000000000000"], ["createdAt", "2001-01-01T00:00:00.000Z"], ["iterations", 200_000]])("authenticates header field %s", async (k, v) => {
    const o = JSON.parse(text(await enc())); o[k] = v;
    expect(await code(decryptMapping(new TextEncoder().encode(JSON.stringify(o)), PW))).toBe("AUTH_FAILED");
  });
  it("uses a fresh salt and IV for every encryption", async () => {
    const a = JSON.parse(text(await enc())), b = JSON.parse(text(await enc()));
    expect(a.salt).not.toBe(b.salt); expect(a.iv).not.toBe(b.iv); expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it("validates format and version", async () => {
    const o = JSON.parse(text(await enc()));
    expect(await code(decryptMapping(new TextEncoder().encode(JSON.stringify({ ...o, version: 1 })), PW))).toBe("UNSUPPORTED_VERSION");
    expect(await code(decryptMapping(new TextEncoder().encode(JSON.stringify({ ...o, format: "x" })), PW))).toBe("INVALID_FILE");
    expect(await code(decryptMapping(new TextEncoder().encode("not json"), PW))).toBe("INVALID_FILE");
    expect(await code(decryptMapping(new TextEncoder().encode(JSON.stringify({ ...o, iterations: 1 })), PW))).toBe("INVALID_FILE");
  });
  it("leaks no identity or password in the file or file name", async () => {
    const t = text(await enc({ caseId: "123e4567-e89b-42d3-a456-426614174000" }));
    for (const s of ["Dupont", "jean@example.com", PW, "ABC"]) expect(t).not.toContain(s);
    expect(mappingFileName("123e4567-e89b-42d3-a456-426614174000")).toBe("case-123e4567.lamap");
  });
  it("refuses weak passwords and invalid payloads", async () => {
    expect(await code(encryptMapping(payload, "short", { iterations: ITER }))).toBe("WEAK_PASSWORD");
    expect(await code(encryptMapping({ ...payload, entries: [{ token: "bad token", kind: "PERSON", original: "x" }] }, PW, { iterations: ITER }))).toBe("INVALID_PAYLOAD");
  });
  it("enforces size and resource limits", async () => {
    const entry = (i: number) => ({ token: `PERSON_${String(i).padStart(3, "0")}`, kind: "PERSON" as const, original: "x" });
    expect(await code(encryptMapping({ ...payload, entries: Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => entry(i + 1)) }, PW, { iterations: ITER }))).toBe("INVALID_PAYLOAD");
    expect(await code(encryptMapping({ ...payload, caseLabel: "x".repeat(MAX_LABEL + 1) }, PW, { iterations: ITER }))).toBe("INVALID_PAYLOAD");
    expect(await code(encryptMapping({ ...payload, entries: [{ ...payload.entries[0], original: "x".repeat(2001) }] }, PW, { iterations: ITER }))).toBe("INVALID_PAYLOAD");
    expect(await code(decryptMapping(new Uint8Array(MAX_MAPPING_BYTES + 1), PW))).toBe("TOO_LARGE");
    const o = JSON.parse(text(await enc()));
    const big = (ciphertext: string, iterations = ITER) => decryptMapping(new TextEncoder().encode(JSON.stringify({ ...o, iterations, ciphertext })), PW);
    expect(await code(big("A".repeat(12 * 1024 * 1024)))).toBe("TOO_LARGE");
    expect(await code(big(o.ciphertext, 2_000_001))).toBe("INVALID_FILE");
  });
  it("scores passwords", () => {
    expect(assessPassword("password1234").ok).toBe(false);
    expect(assessPassword("short").hints).toContain("short");
    expect(assessPassword("Tr0ub4dor&3-purple-giraffe-lamp").score).toBeGreaterThanOrEqual(2);
  });
});
