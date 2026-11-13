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
  return mergePersons([...byKey.values()]);
}

const PARTICLES = new Set(["de", "du", "des", "van", "von", "der", "den", "di", "da", "del", "le", "la", "el", "al", "ben", "bin", "d", "l"]);
const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "");
/** Accent/case-folded name tokens, particles dropped: "Jean de La Fontaine" → {jean, fontaine}. */
const nameTokens = (e: Entity) => new Set(e.surfaces.flatMap(s => fold(matchKey(s.text)).split(/[\s'’-]+/)).filter(t => t && !PARTICLES.has(t)));

/**
 * Merge PERSON entities that are the same individual: reordered ("MASSON Rémi" / "Rémi Masson"), or partial
 * ("Masson", "Rémi", "Rémi Masson" ⊂ "Rémi Pierre Masson"). A partial joins only if exactly one other person
 * contains all its tokens; ambiguous (two Massons) → left apart for manual merge.
 */
function mergePersons(ents: Entity[]): Entity[] {
  const people = ents.filter(e => e.kind === "PERSON");
  const toks = new Map(people.map(e => [e, nameTokens(e)]));
  const drop = new Set<Entity>();
  const absorb = (h: Entity, e: Entity) => {
    for (const s of e.surfaces) { const x = h.surfaces.find(y => y.text === s.text); if (x) x.count += s.count; else h.surfaces.push(s); }
    h.include ||= e.include;
    h.manual ||= e.manual;
    toks.set(h, nameTokens(h));
    drop.add(e);
  };
  // Identical token sets first (else twins block each other as "ambiguous").
  const twin = new Map<string, Entity>();
  for (const e of people) {
    const k = [...toks.get(e)!].sort().join(" ");
    if (!k) continue;
    const h = twin.get(k);
    if (h) absorb(h, e); else twin.set(k, e);
  }
  for (const e of [...people].filter(e => !drop.has(e)).sort((a, b) => toks.get(b)!.size - toks.get(a)!.size)) {
    const mine = toks.get(e)!;
    if (!mine.size) continue;
    const hosts = people.filter(f => f !== e && !drop.has(f) && [...mine].every(t => toks.get(f)!.has(t)));
    if (hosts.length !== 1) continue;
    absorb(hosts[0], e);
  }
  return ents.filter(e => !drop.has(e));
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
