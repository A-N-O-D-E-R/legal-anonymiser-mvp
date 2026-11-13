import { useMemo, useRef, useState } from "react";
import { buildPlan, entityCount, manualEntity } from "../core/plan";
import { ENTITY_KINDS, ProcessingBlocked, type Entity, type EntityKind, type Issue, type Mode } from "../core/types";
import { countOccurrences, processDocx, restoreDocx, scanDocx } from "../document/pipeline";
import { DOCX_MIME, LAMAP_MIME, downloadBytes, getCurrentDocumentBytes, inWord, openAsNewWordDocument } from "../office/wordFile";
import { MAX_LABEL, MAX_MAPPING_BYTES, MIN_PASSWORD, MappingError, decryptMapping, encryptMapping, mappingFileName, newCaseId } from "../security/mappingCrypto";
import { assessPassword } from "../security/password";
import { LangContext, initialLang, makeT, type Lang } from "./i18n";
import { EntityTable, IssueList, PasswordFields } from "./parts";

type UiMode = Mode | "restore";
interface Result {
  doc: Uint8Array; docName: string; map: Uint8Array | null; mapName: string; mapExported: boolean; opened: boolean | null;
  replacements: number; detected: number; selected: number; issues: Issue[]; restoredCase?: string;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [mode, setMode] = useState<UiMode>("pseudonymise");
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [scanIssues, setScanIssues] = useState<Issue[]>([]);
  const [blocked, setBlocked] = useState<Issue[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nlp, setNlp] = useState(false); const [dl, setDl] = useState<number | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [manual, setManual] = useState({ text: "", kind: "PERSON" as EntityKind });
  const [manualErr, setManualErr] = useState("");
  const [caseLabel, setCaseLabel] = useState("");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [ack, setAck] = useState(false); const [confirmRedact, setConfirmRedact] = useState(false);
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const texts = useRef<string[]>([]);
  const devDoc = useRef<Uint8Array | null>(null);

  const plan = useMemo(() => buildPlan(entities ?? [], mode === "restore" ? "pseudonymise" : mode), [entities, mode]);
  const reset = () => { setEntities(null); setScanIssues([]); setBlocked([]); setError(""); setResult(null); setAck(false); setConfirmRedact(false); texts.current = []; };
  const readDoc = async () => inWord() ? getCurrentDocumentBytes() : (devDoc.current ?? (() => { throw new Error("no doc"); })());
  const fail = (e: unknown) => {
    setResult(null);
    if (e instanceof ProcessingBlocked) { setBlocked(e.issues); setError(""); }
    else if (e instanceof MappingError) { setBlocked([]); setError(t(`map_${e.code}` as never)); }
    else { setBlocked([]); setError(t("err_generic")); }
  };

  async function analyse() {
    if (mode === "restore") return;
    setBusy(true); reset();
    try {
      const r = await scanDocx(await readDoc(), mode, { nlp, onProgress: setDl });
      texts.current = r.texts; setEntities(r.entities); setScanIssues(r.issues);
    } catch (e) { fail(e); } finally { setBusy(false); setDl(null); }
  }

  function addManual() {
    const text = manual.text.trim();
    if (!text) { setManualErr(t("manualEmpty")); return; }
    const n = countOccurrences(texts.current, text);
    if (!n) { setManualErr(t("manualNone")); return; }
    setManualErr(""); setEntities([...(entities ?? []), manualEntity(text, manual.kind, n)]); setManual({ ...manual, text: "" });
  }

  const needsAck = scanIssues.some(i => i.code === "IMAGES");
  const pwOk = mode !== "pseudonymise" || (pw === pw2 && assessPassword(pw).ok);
  const canRun = !!entities && plan.identities.length > 0 && pwOk && (!needsAck || ack) && (mode !== "redact" || confirmRedact) && !busy;

  async function run() {
    if (mode === "restore" || !entities) return;
    setBusy(true); setBlocked([]); setError(""); setResult(null);
    try {
      const caseId = newCaseId();
      const out = await processDocx(await readDoc(), plan, { caseId });
      let map: Uint8Array | null = null;
      if (mode === "pseudonymise") {
        map = await encryptMapping({ caseLabel: caseLabel.trim(), entries: out.entries }, pw, { caseId });
        setPw(""); setPw2("");
      }
      const res: Result = {
        doc: out.bytes, docName: mode === "redact" ? "redacted.docx" : "pseudonymised.docx", map, mapName: mappingFileName(caseId), mapExported: false, opened: null,
        replacements: out.replacements, detected: entities.length, selected: plan.identities.length, issues: out.issues
      };
      setResult(res);
      openAsNewWordDocument(out.bytes).then(() => setResult(r => r && { ...r, opened: true }), () => setResult(r => r && { ...r, opened: false }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function restore() {
    if (!mapFile) return;
    setBusy(true); setBlocked([]); setError(""); setResult(null);
    try {
      if (mapFile.size > MAX_MAPPING_BYTES) throw new MappingError("TOO_LARGE"); // before reading it into memory
      const m = await decryptMapping(new Uint8Array(await mapFile.arrayBuffer()), pw);
      const out = await restoreDocx(await readDoc(), { caseId: m.caseId, entries: m.payload.entries });
      setPw("");
      setResult({ doc: out.bytes, docName: "restored.docx", map: null, mapName: "", mapExported: false, opened: null, replacements: out.replacements, detected: 0, selected: m.payload.entries.length, issues: out.issues, restoredCase: m.payload.caseLabel });
      openAsNewWordDocument(out.bytes).then(() => setResult(r => r && { ...r, opened: true }), () => setResult(r => r && { ...r, opened: false }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const total = plan.identities.reduce((n, i) => n + entityCount(entities!.find(e => e.id === i.id)!), 0);
  const modes: Array<[UiMode, string]> = [["pseudonymise", t("modePseudo")], ["redact", t("modeRedact")], ["restore", t("modeRestore")]];

  return <LangContext.Provider value={t}>
    <main lang={lang}>
      <header>
        <div className="mark" aria-hidden="true">LA</div>
        <div><h1>{t("title")}</h1><p>{t("subtitle")} · {t("version")}</p></div>
        <label className="langsel">{t("lang")} <select value={lang} onChange={e => setLang(e.target.value as Lang)}><option value="en">English</option><option value="fr">Français</option></select></label>
      </header>
      <section className="privacy"><strong>🔒 {t("localBanner")}</strong><span>{t("localBannerText")}</span></section>
      <p className="warnbox" role="note">{t("experimental")}</p>

      <fieldset className="modes"><legend>{t("mode")}</legend>
        {modes.map(([m, label]) => <label key={m} className={mode === m ? "on" : ""}><input type="radio" name="mode" checked={mode === m} onChange={() => { setMode(m); reset(); setPw(""); setPw2(""); }} />{label}</label>)}
        <p className={`hint modedesc ${mode}`}>{t(mode === "pseudonymise" ? "modePseudoDesc" : mode === "redact" ? "modeRedactDesc" : "modeRestoreDesc")}</p>
      </fieldset>

      {mode !== "restore" && <section aria-labelledby="s1">
        <h2 id="s1">{t("step1")}</h2>
        {!inWord() && <><p className="hint">{t("notInWord")}</p><input type="file" accept=".docx" aria-label=".docx" onChange={async e => { const f = e.target.files?.[0]; if (f) devDoc.current = new Uint8Array(await f.arrayBuffer()); }} /></>}
        <label><input type="checkbox" checked={nlp} onChange={e => setNlp(e.target.checked)} /> {t("nlp")}</label>
        {nlp && <p className="hint">{t("nlpHint")}</p>}
        {dl !== null && <p className="hint" role="status">{t("nlpLoading", { n: dl })}</p>}
        <button disabled={busy} onClick={analyse}>{busy && !entities ? t("analysing") : entities ? t("reanalyse") : t("analyse")}</button>
      </section>}

      {mode !== "restore" && entities && <>
        <section aria-labelledby="s2">
          <h2 id="s2">{t("step2")}</h2>
          <p className="hint">{t("reviewHelp")}</p>
          <p className="summary" aria-live="polite">{t("summary", { n: entities.length, m: plan.identities.length, k: total })}</p>
          <label className="inline"><input type="checkbox" checked={showLow} onChange={e => setShowLow(e.target.checked)} /> {t("showLow")}</label>
          <EntityTable entities={entities} plan={plan} mode={mode} setEntities={setEntities} showLow={showLow} />
          <p className="hint">{t("allOccurrences")}</p>
          <fieldset className="manual"><legend>{t("addManual")}</legend>
            <label htmlFor="mt">{t("manualText")}</label>
            <input id="mt" value={manual.text} onChange={e => setManual({ ...manual, text: e.target.value })} onKeyDown={e => e.key === "Enter" && addManual()} />
            <label htmlFor="mk">{t("manualKind")}</label>
            <select id="mk" value={manual.kind} onChange={e => setManual({ ...manual, kind: e.target.value as EntityKind })}>{ENTITY_KINDS.map(k => <option key={k}>{k}</option>)}</select>
            <button className="secondary" onClick={addManual}>{t("add")}</button>
            {manualErr && <p className="err" role="alert">{manualErr}</p>}
          </fieldset>
        </section>

        <IssueList issues={scanIssues} heading={t("warnings")} tone="warn" />
        <section aria-labelledby="s3">
          <h2 id="s3">{t("step3")}</h2>
          {mode === "pseudonymise" && <>
            <label htmlFor="cl">{t("caseLabel")}</label>
            <input id="cl" maxLength={MAX_LABEL} value={caseLabel} onChange={e => setCaseLabel(e.target.value)} autoComplete="off" />
            <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} confirm />
          </>}
          {needsAck && <label className="inline"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> {t("ackWarnings")}</label>}
          {mode === "redact" && <label className="inline danger"><input type="checkbox" checked={confirmRedact} onChange={e => setConfirmRedact(e.target.checked)} /> {t("confirmRedact")}</label>}
          <button disabled={!canRun} onClick={run}>{busy ? t("processing") : mode === "redact" ? t("runRedact") : t("runPseudo")}</button>
          {mode === "pseudonymise" && pw.length > 0 && pw.length < MIN_PASSWORD && <p className="hint">{t("hint_short")}</p>}
        </section>
      </>}

      {mode === "restore" && <section aria-labelledby="sr">
        <h2 id="sr">{t("restoreTitle")}</h2>
        {!inWord() && <input type="file" accept=".docx" aria-label=".docx" onChange={async e => { const f = e.target.files?.[0]; if (f) devDoc.current = new Uint8Array(await f.arrayBuffer()); }} />}
        <label htmlFor="mf">{t("mapFile")}</label>
        <input id="mf" type="file" accept=".lamap" onChange={e => setMapFile(e.target.files?.[0] ?? null)} />
        <PasswordFields pw={pw} pw2="" setPw={setPw} setPw2={() => undefined} confirm={false} />
        <button disabled={busy || !mapFile || !pw} onClick={restore}>{busy ? t("processing") : t("restoreBtn")}</button>
      </section>}

      <IssueList issues={blocked} heading={t("blocked")} tone="block" />
      {error && <p className="err box" role="alert">{error}</p>}

      {result && <section className="results" aria-labelledby="s4" aria-live="polite">
        <h2 id="s4">{t("step4")}</h2>
        {result.restoredCase !== undefined && <p>{t("restored", { n: result.replacements, c: result.restoredCase || "—" })}</p>}
        <dl>
          <dt>{t("replacements")}</dt><dd>{result.replacements}</dd>
          {mode !== "restore" && <><dt>{t("detected")}</dt><dd>{result.detected}</dd><dt>{t("selected")}</dt><dd>{result.selected}</dd></>}
        </dl>
        <p>{t("originalUntouched")} {result.opened === true && t("docOpened")} {result.opened === false && <strong>{t("docOpenFailed")}</strong>}</p>
        <div className="actions">
          {inWord() && <button className="secondary" onClick={() => openAsNewWordDocument(result.doc).then(() => setResult({ ...result, opened: true }), () => setResult({ ...result, opened: false }))}>{t("openDoc")}</button>}
          <button className="secondary" onClick={() => downloadBytes(result.doc, result.docName, DOCX_MIME)}>{t("downloadDoc")}</button>
          {result.map && <button onClick={() => { downloadBytes(result.map!, result.mapName, LAMAP_MIME); setResult({ ...result, mapExported: true }); }}>{t("downloadMap")}</button>}
        </div>
        {mode !== "restore" && <p className={`mapstatus ${result.map && !result.mapExported ? "bad" : "ok"}`}><strong>{t("mapStatus")}:</strong> {mode === "redact" ? t("mapNone") : result.mapExported ? t("mapExported", { name: result.mapName }) : t("mapNotExported")}</p>}
        <IssueList issues={result.issues} heading={t("warnings")} tone="warn" />
      </section>}
      <footer>{t("footer")}</footer>
    </main>
  </LangContext.Provider>;
}
