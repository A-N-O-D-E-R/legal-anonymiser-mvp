# Legal Anonymiser for Word — MVP 0.3

Local-only **pseudonymisation** (reversible) and **redaction** (irreversible) of Word documents, French and English.
React + TypeScript Office.js task-pane add-in; JSZip + DOM for OOXML; Web Crypto for encryption. No backend, no telemetry, no cloud AI.

> **Status: prototype. Not validated for confidential client files.** It is not certified, not "GDPR-compliant", and pseudonymised data remains personal data.
> Detection is heuristic and can miss or mis-label information. Every output must be reviewed by a person. See [Known limitations](#known-limitations) and [SECURITY.md](SECURITY.md).

## Modes

| | Pseudonymise (reversible) | Redact (irreversible) |
|---|---|---|
| Replacement | `PERSON_001`, `COMPANY_001`, `ADDRESS_001`, `EMAIL_001`… | `[REDACTED_PERSON]`, `[REDACTED_COMPANY]`… |
| Mapping | Separate AES-256-GCM encrypted `.lamap` per case | **None created, none kept** |
| Restoration | Yes, with file + password | **Not possible** |
| Tracked changes | Kept; text incl. deletions pseudonymised | Accepted; deleted text removed |
| Comments | Kept; text pseudonymised | Removed |
| Metadata / custom XML / people / thumbnail | Removed | Removed |

The original document is never modified; output is always a new document (opened in Word and downloadable).

## Workflow

1. **Analyse** the open document (all parts: body, headers/footers, footnotes/endnotes, comments, text boxes, tracked deletions, field codes, hyperlink targets, alt-text…).
2. **Review entities**: category, original, proposed replacement, count, confidence; include/exclude, re-categorise, add or remove items manually. Low-confidence items are not pre-selected.
3. **Process**. Pseudonymise: case name (kept only inside the encrypted file), password + confirmation, strength guidance → export the `.lamap`. Redact: explicit irreversible-processing confirmation.
4. **Results**: replacements, entities, warnings, mapping-export status, open/download actions.
5. **Restore**: open the pseudonymised document, choose the `.lamap`, enter the password → new restored document. Wrong password, tampered file, wrong case, or unknown pseudonyms → clear error, nothing produced.

UI languages: English and French (auto-selected from Office display language; switchable).

## Install & run (developer)

Requirements: Node.js ≥ 20 (tested on 22), npm, Word (Windows / Mac / web) with Office Add-ins enabled.

```bash
npm install
npx office-addin-dev-certs install     # trusts a localhost HTTPS certificate (Office requires HTTPS)
npm run dev                            # https://localhost:3000
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run check` (all four), `npm run icons` (regenerate placeholder icons), `npm run package` (ZIP of the project).

Outside Word (plain browser) the task pane offers a `.docx` file picker so the pipeline can be exercised in development; "open in Word" is then unavailable (download only).

## Sideloading `manifest.xml`

The manifest is a **development** manifest pointing to `https://localhost:3000` (icons in `public/`, placeholders). Requires WordApi 1.3.

- **Word on Windows** — share the project folder (or copy `manifest.xml`) to a network share/trusted catalog: *File ▸ Options ▸ Trust Center ▸ Trust Center Settings ▸ Trusted Add-in Catalogs*, add the share URL, tick *Show in Menu*, restart Word, then *Insert ▸ My Add-ins ▸ Shared Folder*.
- **Word on Mac** — copy `manifest.xml` to `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/` (create `wef` if needed), restart Word, *Insert ▸ Add-ins ▸ My Add-ins ▸ Developer Add-ins*.
- **Word on the web** — open a document, *Insert ▸ Add-ins ▸ More Add-ins ▸ Upload My Add-in*, choose `manifest.xml`.
- Or: `npx office-addin-debugging start manifest.xml` (Microsoft tooling).

Microsoft's current instructions are authoritative: <https://learn.microsoft.com/office/dev/add-ins/testing/test-debug-office-add-ins>. For production the manifest URLs must point to a real HTTPS host serving `npm run build` output (`dist/`), and the manifest `Version` (1.0.0.0, required ≥ 1.0 by the validator) is independent of the product version (0.3).

## Architecture

```
src/core/        types, matcher (case/accent/apostrophe/hyphen-tolerant, boundary-aware), plan builder
src/detection/   deterministic FR/EN detectors (rules, address, names), plug-in registry for an optional LOCAL NLP model
src/document/    ooxml.ts   run-aware text units, tracked-change/comment/author/metadata sanitisers
                 package.ts classify every ZIP part, audit (block/warn), remove parts+rels+content types, integrity check
                 pipeline.ts scan → process (sanitise → replace → regenerate → re-open & verify) → restore
src/security/    mappingCrypto.ts (.lamap v2), password.ts (strength guidance)
src/office/      Office.js integration (read file, open new document)
src/ui/          React UI + FR/EN dictionary
tests/           vitest; documents are built in memory (tests/fixtures.ts)
```

Replacement engine: each paragraph (`w:p`/`a:p`, nested text-box paragraphs separately) is flattened over its `w:t` nodes; matches are located on the flat text and written back so each run keeps its own properties; the replacement lands in the run where the match starts and later runs are only trimmed. Tabs/breaks are separators so matches never span them. Tracked-deleted text (`w:delText`) is matched as a separate unit.

Safety gates (processing stops with an explicit message instead of producing a document): unsupported/unknown package parts, embedded objects/workbooks/ActiveX/VBA, alt-chunks, non-hyperlink external relationships, pseudonym-shaped text already in the source, no entities selected, **any selected identity still present anywhere in the re-opened output**, broken relationships/content types/XML.

## Implemented vs experimental

**Implemented and covered by automated tests (synthetic documents only):**
run-preserving replacement (split runs, bold/italic/colour/font kept, tables incl. nested, headers/footers, footnotes, hyperlinks, bookmarks, text boxes incl. `mc:Fallback`, section properties); consistent pseudonyms, case variants with exact restoration (`_V2` variants); partial-word protection; accents/hyphens/apostrophes/NFD; AES-256-GCM `.lamap` v2 with authenticated header, PBKDF2-HMAC-SHA-256 (600 000 iterations default, configurable 100 000–10 000 000), fresh salt+IV; restoration with case-marker and unknown-token checks; redaction with tracked-change acceptance, comment/people/custom-XML/thumbnail/printer/web-extension removal, metadata wipe, author neutralisation; leak verification of the output package (parts, names, text, attributes, relationships); integrity check; FR/EN detection rules (email, FR/UK/US phones, IBAN mod-97, SIREN/SIRET Luhn, VAT, UK company no., EIN/SSN/NIR, birth dates, case references, FR/UK/US addresses, persons, companies); UI smoke test; FR/EN UI.

**Implemented but NOT covered by an automated test:** replacement inside field codes (`w:instrText`/`w:fldSimple`), WordArt text, chart caches (`c:v`), SmartArt/diagram text, `a:p` DrawingML paragraphs, content-control labels, glossary documents, endnotes. They use the same engine and are still subject to the output verification gate.

**Experimental / heuristic:** person and company detection (title/first-name-list/legal-form rules, small bundled first-name lists), address patterns, birth-date context rule, case-reference patterns, password-strength estimate, plug-in point for a local NLP model (**no model is shipped**).

**Not implemented:** OCR / analysis of images; sanitising embedded objects, charts with embedded workbooks, ActiveX, alt-chunks (these are *blocked*, not cleaned); `.doc`/`.rtf`/PDF; local NER model; merging aliases (e.g. "Jean Dupont" ↔ "M. Dupont" are separate identities unless you add both); secure deletion; mapping backup/recovery; password recovery.

## Known limitations

- **Never validated in real Word** (Windows/Mac/web) or in real browsers in this delivery — only in Node/jsdom with synthetic OOXML. Open every output in Word and inspect it (including *Review ▸ Show Markup*) before relying on it. Whether a redacted file is "genuinely irreversible" has been checked only by the automated package scan on synthetic files, not by independent forensic review.
- Images (text in images, EXIF/metadata inside media), EMF/WMF/SVG are **not analysed** — a mandatory warning is shown and acknowledgement is required.
- Detection can miss names (e.g. surname-only mentions, unusual names, text in all-caps without a known first name), and can over-match. Surnames alone are not auto-linked to full names.
- Multi-line addresses split by a line break/tab are not matched as one item. Text interrupted by a tab/line break is never matched across it.
- A tracked deletion that splits an identity across deleted/inserted text may not match; the output verification then blocks, and you must add the fragment manually.
- Redaction **accepts all tracked changes** (this alters the document's revision history by design) and **removes comments**.
- Pseudonymisation keeps document structure, dates, amounts and context, which can still identify people. Pseudonymised data remains personal data.
- Existing custom document properties and custom XML are removed in both modes. Content-control data bindings are dropped (cached text stays).
- File download from a task pane can be restricted on some Word desktop builds; if the mapping download does not start, open the task pane in Word on the web or use the dev server in a browser. Never proceed without confirming the `.lamap` was saved.
- `.lamap` v1 files from MVP 0.2 are not readable (format changed to v2 with authenticated header).
- `docProps` wipe removes author/company/title/etc. for all outputs.
- Dev-tool dependency advisories remain (see SECURITY.md).

## Test and build results (this delivery)

Run on Linux (WSL2), Node 22.23.1, npm 10.9.8:

| Step | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` (`tsc -b`, strict + noUnusedLocals) | 0 errors |
| Lint | `npm run lint` (eslint 9, typescript-eslint, react-hooks) | 0 issues |
| Tests | `npm test` (vitest 5, jsdom) | 6 files, **57 tests passed**, 0 failed |
| Production build | `npm run build` | success — `dist/assets/index-*.js` ≈ 303 kB (98 kB gzip) |
| Manifest | `office-addin-manifest validate manifest.xml` | "The manifest is valid" (online validator; supports Word on Windows/Mac/web) |

What the tests do **not** show: behaviour in real Word, Office.js file APIs (`getFileAsync`, `createDocument`), real browsers' `XMLSerializer`, accessibility with assistive technology, or large real-world documents.
