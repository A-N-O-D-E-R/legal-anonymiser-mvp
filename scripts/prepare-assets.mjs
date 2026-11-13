// Self-hosts everything the optional NLP detector needs, so the add-in makes no third-party request at runtime:
//  - ONNX runtime WASM (copied from node_modules, which package-lock.json pins by integrity hash)
//  - the NER model, downloaded from a PINNED Hugging Face revision and verified against SHA-256 in models.lock.json
// Output goes to public/ (git-ignored) and is then copied into dist/ by Vite. Runs before dev/build.
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const lock = JSON.parse(readFileSync("models.lock.json", "utf8"));

const ort = "public/vendor/ort";
mkdirSync(ort, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"])
  copyFileSync(join("node_modules/onnxruntime-web/dist", f), join(ort, f));

const sha256 = async (p) => { const h = createHash("sha256"); await pipeline(createReadStream(p), h); return h.digest("hex"); };

for (const [file, want] of Object.entries(lock.files)) {
  const dest = join("public/models", lock.id, file);
  if (existsSync(dest) && await sha256(dest) === want) continue;
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${lock.id}/resolve/${lock.revision}/${file}`;
  console.log("fetch", url);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const got = await sha256(tmp);
  if (got !== want) { rmSync(tmp); throw new Error(`${file}: sha256 mismatch (got ${got}, pinned ${want})`); }
  renameSync(tmp, dest);
}
console.log("assets ready");
