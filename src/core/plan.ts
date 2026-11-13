import { identityKey, matchKey, tokenFor } from "./matcher";
import type { Confidence, Detection, Entity, EntityKind, Issue, Mode, Plan, PlanIdentity } from "./types";

let seq = 0;
const newId = () => `e${++seq}`;

/** Group detections into entities (one per identity key). Low-confidence detections default to excluded. */
export function entitiesFromDetections(dets: Detection[]): Entity[] {
  const byKey = new Map<string, Entity>();
  for (const d of dets) {
    const key = `${d.kind}:${identityKey(d.kind, d.value)}`;
    let e = byKey.get(key);
    if (!e) {
      e = { id: newId(), kind: d.kind, surfaces: [], confidence: d.confidence, source: d.source, include: d.confidence !== "low", manual: d.confidence === "manual" };
      byKey.set(key, e);
    }
    const norm = d.value.normalize("NFC");
    const s = e.surfaces.find(x => x.text === norm);
    if (s) s.count++; else e.surfaces.push({ text: norm, count: 1 });
  }
  return [...byKey.values()];
}

export function manualEntity(text: string, kind: EntityKind, count: number): Entity {
  return { id: newId(), kind, surfaces: [{ text: text.normalize("NFC").trim(), count }], confidence: "manual" as Confidence, source: "manual", include: true, manual: true };
}

export const entityLabel = (e: Entity) => e.surfaces[0]?.text ?? "";
export const entityCount = (e: Entity) => e.surfaces.reduce((n, s) => n + s.count, 0);

/**
 * Build the replacement plan from reviewed entities. Included entities only; if two entities share a
 * match key the first (manual wins) is kept and the conflict reported so nothing is silently dropped.
 */
export function buildPlan(entities: Entity[], mode: Mode): Plan {
  const warnings: Issue[] = [];
  const seen = new Set<string>();
  const identities: PlanIdentity[] = [];
  const ordered = [...entities].sort((a, b) => Number(b.manual) - Number(a.manual));
  for (const e of ordered) {
    if (!e.include) continue;
    const surfaces: string[] = [];
    for (const s of e.surfaces) {
      const k = matchKey(s.text);
      if (!k) continue;
      if (seen.has(k)) { warnings.push({ severity: "warn", code: "NAME_CONFLICT" }); continue; }
      seen.add(k); surfaces.push(s.text);
    }
    if (!surfaces.length) continue;
    identities.push({ id: e.id, kind: e.kind, base: "", surfaces });
  }
  // Number identities in the order the user sees them (stable, independent of manual-first ordering above).
  const order = new Map(entities.map((e, i) => [e.id, i]));
  identities.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const per = new Map<EntityKind, number>();
  for (const id of identities) { const n = (per.get(id.kind) ?? 0) + 1; per.set(id.kind, n); id.base = tokenFor(id.kind, n); }
  return { mode, identities, warnings };
}
