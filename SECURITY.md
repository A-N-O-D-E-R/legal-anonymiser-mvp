# Security architecture — Legal Anonymiser MVP 0.3

Status: **prototype, no independent security or legal review.** Do not describe it as GDPR-compliant, certified, or suitable for confidential client files without that evidence.

## Local-only processing
- All parsing, detection, replacement, sanitisation, encryption and decryption run in the task-pane JavaScript. There is no backend, no remote AI/NLP call, no analytics or telemetry; no code path sends document text anywhere.
- The only network resource is Microsoft's `office.js` (loaded from `appsforoffice.microsoft.com`, required by Office) and, in development, the Vite dev server.
- Not enforced in code (recommended hardening, untested in Word): serve production builds with a strict CSP (`connect-src 'self'`).
- Detector plug-ins registered through `registerDetector` run in-process and must not make network calls (not technically enforced).

## Mapping file (`.lamap`, format v2)
JSON envelope: `format`, `version` (2), `caseId` (random UUID), `createdAt`, `kdf` (`PBKDF2-HMAC-SHA-256`), `iterations`, `salt` (16 B), `cipher` (`AES-256-GCM`), `iv` (12 B), `ciphertext`.
- Key: PBKDF2-HMAC-SHA-256 over the NFKC-normalised password; default 600 000 iterations (configurable 100 000 – 10 000 000; out-of-range values are rejected on read to prevent downgrade/DoS). Argon2id/scrypt are stronger against GPUs but unavailable in Web Crypto; consider them for a future version.
- Randomness: `crypto.getRandomValues` for salt and IV on every encryption (fresh each time; tested).
- Authenticated encryption: the whole plaintext header is the GCM *additional authenticated data*; changing `caseId`, `createdAt`, iterations, salt or IV makes decryption fail (tested). Wrong password and tampering are deliberately indistinguishable.
- Plaintext contents: random case id, timestamp, algorithm parameters only. The user's case name, all identities and pseudonyms are inside the ciphertext. The file name (`case-<8 hex of caseId>.lamap`) is derived from the random id only.
- The password is never stored, logged or written to the document. Minimum 12 characters, strength guidance (heuristic, not a guarantee). Lost password = unrecoverable mapping.
- Payload is schema-validated after decryption (token shape, unique tokens, known categories, size bounds).
- A restoring document carries only a random case marker (`docProps/custom.xml`, `LegalAnonymiserCaseId`) so a mapping from another case is rejected. Documents without the marker are restored only if every pseudonym-shaped token in them is in the mapping.

## Restoration safeguards
Exact, case-sensitive, boundary-aware token matching limited to tokens present in the decrypted mapping; unknown pseudonym-shaped tokens → refuse (prevents silent mis-restoration); zero tokens → refuse; leftover tokens after restoration → refuse. The input document is never modified; the output is a new package.

## Redaction guarantees (what is and is not claimed)
Redaction creates no mapping and no marker. Removed or neutralised: comments (+ anchors, extended/ids parts), tracked deletions/insertions (accepted), revision formatting records, authors/initials, core/app/custom properties, thumbnail, custom XML, content-control bindings, people part, printer settings, web extensions, doc variables, mail-merge and attached-template references, XML comments. Selected identities are replaced in body, headers/footers, footnotes/endnotes, text boxes (incl. fallbacks), field codes, hyperlink targets, bookmark/alt-text/tooltip/WordArt attributes, chart caches and diagram text (field codes, WordArt, charts and diagrams: implemented but not covered by automated tests).
Then the produced ZIP is **re-opened** and every XML part, attribute value, relationship target, content type and part name is scanned for any selected identity (case/accent/space-tolerant, underscore-relaxed); any hit blocks export. Structural integrity (XML parse, relationship targets, `r:id` references, content types) is also verified.
**This is not proof of irreversibility.** It is tested only on synthetic documents. Not covered: text inside images or image metadata, identities not selected by the user, indirect identification from context, ZIP-level artefacts outside XML (e.g. unreferenced binary parts are blocked as unknown; images are warned). Obtain independent forensic review before claiming irreversibility.

## Unsupported content policy
Fail closed: unknown parts, embedded OLE/workbooks/ActiveX/VBA, alt-chunks and non-hyperlink external relationships block processing. Images produce a warning requiring acknowledgement.

## Data handling
- Decrypted mappings, passwords and document bytes live in JavaScript memory only for the duration of an operation; the UI clears the password fields after use. **JavaScript offers no secure memory erasure; none is claimed.** The browser/WebView may swap or retain memory, and `Blob` download URLs persist for up to 60 s.
- No temporary files are written by the app. Downloads (`.docx`, `.lamap`) are written by the host browser/Word to the user's download location; treat them as confidential and store the `.lamap` and its password separately.
- No logging: the code base contains no `console.*` calls; error messages and issue objects contain only codes, counts and part names, never document text or identities (tested by construction, not by an automated scan).
- Zip-bomb guard: ≤150 MB input, ≤5000 parts, ≤1 GiB declared uncompressed size.

## Dependencies
Runtime: `jszip` 3.10.2, `react` / `react-dom` 18.3.1 — `npm audit --omit=dev`: **0 vulnerabilities** at delivery. Web Crypto is used for all cryptography (no third-party crypto). Dev tooling: after upgrading vitest/vite/plugin-react to current releases the critical/high advisories were cleared; **7 moderate advisories remain in the `typescript-eslint`/`minimatch` lint chain** (dev-only, not shipped in `dist/`). Re-run `npm audit` and `npm outdated` regularly; pin and review before any release.

## Threat model (summary)
In scope: accidental disclosure via missed OOXML parts, tampered/wrong mapping files, weak passwords, cross-case mis-restoration. Out of scope / not mitigated: malicious host/browser, compromised workstation or extensions, shoulder-surfing, side channels, offline brute force of weak passwords against a stolen `.lamap`, legal sufficiency of anonymisation.
