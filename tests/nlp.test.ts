import { describe, expect, it, vi } from "vitest";
import { scanDocx } from "../src/document/pipeline";
import { nlpDetect } from "../src/detection/nlp";
import { buildDocx, para, run } from "./fixtures";

// Fake NER: no model download. Returns word pieces the way transformers.js does (no offsets).
const { pipeline, env } = vi.hoisted(() => ({ pipeline: vi.fn(), env: { localModelPath: "", backends: { onnx: { wasm: { wasmPaths: { mjs: "https://cdn.example/ort.mjs", wasm: "https://cdn.example/ort.wasm" } } } } } as { allowRemoteModels?: boolean; localModelPath: string; backends: { onnx: { wasm: { wasmPaths: unknown } } } } }));
vi.mock("@huggingface/transformers", () => ({ pipeline, env }));
const tok = (entity: string, word: string, score = 0.99) => ({ entity, word, score });
pipeline.mockImplementation(async () => async (text: string) => [
  ...(text.includes("Zoltan Quixley") ? [tok("B-PER", "Zol"), tok("I-PER", "##tan"), tok("I-PER", "Qui"), tok("I-PER", "##xley")] : []),
  ...(text.includes("Zorbex") ? [tok("B-ORG", "Zor"), tok("I-ORG", "##bex")] : []),
  ...(text.includes("Lyon") ? [tok("B-LOC", "Lyon")] : []),
  ...(text.includes("Maybe") ? [tok("B-PER", "Maybe", 0.5)] : [])
]);

const docx = () => buildDocx({ body: para(run("Contrat entre Zoltan Quixley et Zorbex à Lyon. Maybe later.")) });

describe("NLP detection (mocked model)", () => {
  it("is not loaded unless requested", async () => {
    await scanDocx(await docx(), "redact");
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("loads model and WASM runtime from our own origin only", async () => {
    await nlpDetect("x");
    expect(env.allowRemoteModels).toBe(false);
    expect(env.localModelPath).toMatch(/\/models\/$/);
    expect(env.localModelPath.startsWith(document.baseURI.replace(/[^/]*$/, ""))).toBe(true);
    expect(env.backends.onnx.wasm.wasmPaths).toEqual({ mjs: expect.stringContaining("/vendor/ort/ort.mjs"), wasm: expect.stringContaining("/vendor/ort/ort.wasm") });
    expect(JSON.stringify(env)).not.toContain("cdn.example");
  });

  it("merges word pieces, maps labels, drops low scores", async () => {
    const text = "Contrat entre Zoltan Quixley et Zorbex à Lyon. Maybe later.";
    const d = await nlpDetect(text);
    expect(d.map(x => [x.value, x.kind, x.confidence])).toEqual([
      ["Zoltan Quixley", "PERSON", "medium"], ["Zorbex", "COMPANY", "medium"], ["Lyon", "ADDRESS", "low"]
    ]);
    for (const x of d) expect(text.slice(x.start, x.end)).toBe(x.value);
  });

  it("offsets stay correct across chunks", async () => {
    const text = "mot ".repeat(400) + "Zoltan Quixley";
    const d = await nlpDetect(text);
    expect(d).toHaveLength(1);
    expect(text.slice(d[0].start, d[0].end)).toBe("Zoltan Quixley");
  });

  it("scanDocx adds NLP entities only when enabled", async () => {
    const bytes = await docx();
    const off = (await scanDocx(bytes, "redact")).entities.map(e => e.surfaces[0].text);
    const on = (await scanDocx(bytes, "redact", { nlp: true })).entities.map(e => e.surfaces[0].text);
    expect(off).not.toContain("Zorbex");
    expect(on).toEqual(expect.arrayContaining(["Zoltan Quixley", "Zorbex"]));
  });

  it("a failed model load can be retried", async () => {
    vi.resetModules();
    pipeline.mockRejectedValueOnce(new Error("offline"));
    const { nlpDetect: fresh } = await import("../src/detection/nlp");
    await expect(fresh("x")).rejects.toThrow("offline");
    await expect(fresh("Lyon")).resolves.toHaveLength(1);
  });
});
