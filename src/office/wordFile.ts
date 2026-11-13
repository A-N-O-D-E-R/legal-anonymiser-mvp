import { toB64 } from "../security/mappingCrypto";

export const inWord = () => typeof Office !== "undefined" && !!Office.context?.document?.getFileAsync;

/** Reads the open document (compressed OOXML) into memory. The original is never modified. */
export function getCurrentDocumentBytes(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 4 * 1024 * 1024 }, async result => {
      if (result.status !== Office.AsyncResultStatus.Succeeded || !result.value) { reject(result.error ?? new Error("getFileAsync")); return; }
      const file = result.value;
      try {
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < file.sliceCount; i++) {
          chunks.push(await new Promise<Uint8Array>((res, rej) => {
            file.getSliceAsync(i, slice => slice.status === Office.AsyncResultStatus.Succeeded ? res(new Uint8Array(slice.value.data as number[])) : rej(slice.error));
          }));
        }
        const merged = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
        let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }
        resolve(merged);
      } catch (e) { reject(e); } finally { file.closeAsync(); }
    });
  });
}

/** Opens bytes as a NEW Word document (WordApi 1.3). Rejects if the host cannot; callers then offer a download. */
export async function openAsNewWordDocument(bytes: Uint8Array): Promise<void> {
  await Word.run(async ctx => {
    const doc = ctx.application.createDocument(toB64(bytes));
    ctx.load(doc);
    await ctx.sync();
    doc.open();
    await ctx.sync();
  });
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const LAMAP_MIME = "application/octet-stream";
