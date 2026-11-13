import type { Confidence, Detection } from "../core/types";
import { ruleDetectors, type Detector } from "./rules";
import { addressDetectors } from "./address";
import { nameDetectors } from "./names";

export type { Detector };

/**
 * Detector registry. Built-ins are deterministic local rules (FR/EN).
 * An optional LOCAL NLP model can be plugged in with `registerDetector` (e.g. a bundled ONNX NER model
 * running in a Web Worker). No such model ships with MVP 0.3, and detectors must never make network calls.
 */
const extra: Detector[] = [];
export function registerDetector(d: Detector): void { extra.push(d); }
export function builtinDetectors(): Detector[] { return [...ruleDetectors, ...addressDetectors, ...nameDetectors]; }

const RANK: Record<Confidence, number> = { manual: 4, high: 3, medium: 2, low: 1 };
// eslint-disable-next-line no-control-regex
const SEP = /\u0001/;

/** Non-overlapping detections: longest first, then higher confidence; separators (tabs/breaks) are never inside a span. */
export function detect(text: string, detectors: Detector[] = [...builtinDetectors(), ...extra]): Detection[] {
  const all = detectors.flatMap(d => d.run(text)).filter(d => d.end > d.start && !SEP.test(d.value));
  all.sort((a, b) => (b.end - b.start) - (a.end - a.start) || RANK[b.confidence] - RANK[a.confidence] || a.start - b.start);
  const taken: Detection[] = [];
  for (const d of all) if (!taken.some(t => d.start < t.end && t.start < d.end)) taken.push(d);
  return taken.sort((a, b) => a.start - b.start);
}
