import { useId } from "react";
import { ENTITY_KINDS, TOKEN_PREFIX, redactionLabel, type Entity, type EntityKind, type Issue, type Mode, type Plan } from "../core/types";
import { entityCount, entityLabel } from "../core/plan";
import { assessPassword } from "../security/password";
import { useT } from "./i18n";

export function IssueList({ issues, heading, tone }: { issues: Issue[]; heading: string; tone: "block" | "warn" }) {
  const t = useT();
  if (!issues.length) return null;
  return <section className={`issues ${tone}`} role={tone === "block" ? "alert" : undefined} aria-label={heading}>
    <h3>{heading}</h3>
    <ul>{issues.map((i, k) => <li key={k}>{t(`issue_${i.code}` as never, { p: i.part ?? "", n: i.count ?? "" })}</li>)}</ul>
  </section>;
}

export function PasswordFields({ pw, pw2, setPw, setPw2, confirm }: { pw: string; pw2: string; setPw(v: string): void; setPw2(v: string): void; confirm: boolean }) {
  const t = useT(); const id = useId();
  const a = assessPassword(pw);
  return <div>
    <label htmlFor={id + "p"}>{t("password")}</label>
    <input id={id + "p"} type="password" autoComplete={confirm ? "new-password" : "current-password"} value={pw} onChange={e => setPw(e.target.value)} aria-describedby={id + "h"} />
    {confirm && <>
      <div className="meter" aria-live="polite"><span className={`bar s${a.score}`} style={{ width: `${(a.score + 1) * 25}%` }} /><span>{t("strengthLabel")}: {pw ? t(`strength${a.score}` as never) : "–"}</span></div>
      {pw && a.hints.length > 0 && <ul className="hints">{a.hints.map(h => <li key={h}>{t(`hint_${h}` as never)}</li>)}</ul>}
      <label htmlFor={id + "c"}>{t("passwordConfirm")}</label>
      <input id={id + "c"} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
      {pw2 && pw !== pw2 && <p className="err" role="alert">{t("mismatch")}</p>}
      <p id={id + "h"} className="hint">{t("passwordHelp")}</p>
    </>}
  </div>;
}

export function EntityTable({ entities, plan, mode, setEntities, showLow }: { entities: Entity[]; plan: Plan; mode: Mode; setEntities(e: Entity[]): void; showLow: boolean }) {
  const t = useT();
  const base = new Map(plan.identities.map(i => [i.id, i.base]));
  const patch = (id: string, p: Partial<Entity>) => setEntities(entities.map(e => e.id === id ? { ...e, ...p } : e));
  const rows = entities.filter(e => showLow || e.confidence !== "low" || e.include);
  if (!rows.length) return <p className="hint">{t("noEntities")}</p>;
  return <div className="tablewrap"><table>
    <thead><tr><th scope="col">{t("colInclude")}</th><th scope="col">{t("colCategory")}</th><th scope="col">{t("colOriginal")}</th><th scope="col">{t("colReplacement")}</th><th scope="col">{t("colCount")}</th><th scope="col">{t("colConfidence")}</th></tr></thead>
    <tbody>{rows.map(e => {
      const label = entityLabel(e);
      return <tr key={e.id} className={e.include ? "" : "off"}>
        <td><input type="checkbox" checked={e.include} onChange={ev => patch(e.id, { include: ev.target.checked })} aria-label={`${t("colInclude")}: ${label}`} /></td>
        <td><select value={e.kind} onChange={ev => patch(e.id, { kind: ev.target.value as EntityKind })} aria-label={`${t("colCategory")}: ${label}`}>{ENTITY_KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></td>
        <td className="orig">{label}{e.surfaces.length > 1 && <small> (+{e.surfaces.length - 1})</small>}</td>
        <td className="repl">{!e.include ? "—" : mode === "redact" ? redactionLabel(e.kind) : (base.get(e.id) ?? `${TOKEN_PREFIX[e.kind]}_…`)}</td>
        <td>{entityCount(e)}</td>
        <td><span className={`badge ${e.confidence}`}>{t(`conf_${e.confidence}` as never)}</span>{e.manual && <button className="link" onClick={() => setEntities(entities.filter(x => x.id !== e.id))}>{t("remove")}</button>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
