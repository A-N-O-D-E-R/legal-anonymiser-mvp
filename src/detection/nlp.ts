import type { Detection, EntityKind } from "../core/types";

// Multilingual (incl. FR) NER. Model and ONNX runtime are SELF-HOSTED next to the add-in (public/models, public/vendor/ort,
// filled by scripts/prepare-assets.mjs from the revision + SHA-256 pinned in models.lock.json). Remote model loading is
// disabled, so nothing is fetched from Hugging Face or a CDN at runtime and document text never leaves the page.
const MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";
const KIND: Record<string, [EntityKind, Detection["confidence"]]> = { PER: ["PERSON", "medium"], ORG: ["COMPANY", "medium"], LOC: ["ADDRESS", "low"] };
const CHUNK = 1200;

interface Tok { entity: string; score: number; word: string }
type Ner = (t: string) => Promise<Tok[]>;
let ner: Promise<Ner> | null = null;

function load(onProgress?: (pct: number) => void): Promise<Ner> {
  return ner ??= import("@huggingface/transformers").then(({ pipeline, env }) => {
    const base = new URL("./", document.baseURI).href;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = `${base}models/`;
    // The library defaults to a jsDelivr URL for the WASM runtime; keep its file choice but serve it from our origin.
    const wasm = env.backends?.onnx?.wasm;
    const orig = wasm?.wasmPaths as { mjs: string; wasm: string } | undefined;
    if (wasm && orig) wasm.wasmPaths = { mjs: `${base}vendor/ort/${orig.mjs.split("/").pop()}`, wasm: `${base}vendor/ort/${orig.wasm.split("/").pop()}` };
    return pipeline("token-classification", MODEL, {
      dtype: "q8",
      progress_callback: (p) => { if ("progress" in p && p.progress != null) onProgress?.(Math.round(p.progress)); }
    }) as unknown as Promise<Ner>;
  }).catch(e => { ner = null; throw e; });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Group B-/I- word pieces into entities, then locate them in the text (tokens carry no offsets). */
function spans(text: string, toks: Tok[]): Detection[] {
  const groups: Array<{ type: string; pieces: string[] }> = [];
  for (const t of toks) {
    if (t.score < 0.8) continue;
    const [pre, type] = t.entity.split("-");
    const last = groups[groups.length - 1];
    if (pre === "I" && last?.type === type) last.pieces.push(t.word);
    else groups.push({ type, pieces: [t.word] });
  }
  const out: Detection[] = [];
  for (const g of groups) {
    const k = KIND[g.type]; if (!k) continue;
    const parts: string[] = [];
    for (const p of g.pieces) {
      if (p.startsWith("##") && parts.length) parts[parts.length - 1] += p.slice(2); else parts.push(p);
    }
    if (parts.join("").length < 3) continue;
    const re = new RegExp(parts.map(esc).join("\\s*"), "giu");
    for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: k[0], value: m[0], confidence: k[1], source: "nlp" });
  }
  return out;
}

export async function nlpDetect(text: string, onProgress?: (pct: number) => void): Promise<Detection[]> {
  const run = await load(onProgress);
  const out: Detection[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + CHUNK, text.length);
    if (end < text.length) { const sp = text.lastIndexOf(" ", end); if (sp > i) end = sp; }
    const chunk = text.slice(i, end);
    for (const d of spans(chunk, await run(chunk))) out.push({ ...d, start: d.start + i, end: d.end + i });
    i = end;
  }
  return out;
}
