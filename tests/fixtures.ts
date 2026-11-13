import JSZip from "jszip";

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const NSDECL = `xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A run with optional properties XML. */
export const run = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
export const para = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;

export interface DocxParts { body: string; header?: string; footer?: string; footnotes?: string; comments?: string; rels?: string; extra?: Record<string, string | Uint8Array>; core?: string; custom?: boolean; extraOverrides?: string }

/** Builds a minimal but valid .docx package in memory. */
export async function buildDocx(p: DocxParts): Promise<Uint8Array> {
  const z = new JSZip();
  const overrides: string[] = [`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`];
  const rels: string[] = [`<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>`];
  z.file("word/styles.xml", `${HEAD}<w:styles ${NSDECL}><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  if (p.header) { z.file("word/header1.xml", `${HEAD}<w:hdr ${NSDECL}>${p.header}</w:hdr>`); overrides.push(`<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`); rels.push(`<Relationship Id="rId10" Type="${R_NS}/header" Target="header1.xml"/>`); }
  if (p.footer) { z.file("word/footer1.xml", `${HEAD}<w:ftr ${NSDECL}>${p.footer}</w:ftr>`); overrides.push(`<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`); rels.push(`<Relationship Id="rId11" Type="${R_NS}/footer" Target="footer1.xml"/>`); }
  if (p.footnotes) { z.file("word/footnotes.xml", `${HEAD}<w:footnotes ${NSDECL}>${p.footnotes}</w:footnotes>`); overrides.push(`<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`); rels.push(`<Relationship Id="rId12" Type="${R_NS}/footnotes" Target="footnotes.xml"/>`); }
  if (p.comments) { z.file("word/comments.xml", `${HEAD}<w:comments ${NSDECL}>${p.comments}</w:comments>`); overrides.push(`<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`); rels.push(`<Relationship Id="rId13" Type="${R_NS}/comments" Target="comments.xml"/>`); }
  if (p.rels) rels.push(p.rels);
  z.file("word/document.xml", `${HEAD}<w:document ${NSDECL}><w:body>${p.body}<w:sectPr>${p.header ? `<w:headerReference w:type="default" r:id="rId10"/>` : ""}${p.footer ? `<w:footerReference w:type="default" r:id="rId11"/>` : ""}<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  z.file("word/_rels/document.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  z.file("docProps/core.xml", p.core ?? `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Contrat Jean Dupont</dc:title><dc:creator>Maître Alice Moreau</dc:creator><cp:lastModifiedBy>Alice Moreau</cp:lastModifiedBy></cp:coreProperties>`);
  z.file("docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Cabinet Moreau</Company></Properties>`);
  const rootRels = [`<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
    `<Relationship Id="rId3" Type="${R_NS}/extended-properties" Target="docProps/app.xml"/>`];
  if (p.custom) {
    z.file("docProps/custom.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property name="Client" pid="2"><lpwstr xmlns="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">Jean Dupont</lpwstr></property></Properties>`);
    overrides.push(`<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`);
    rootRels.push(`<Relationship Id="rId4" Type="${R_NS}/custom-properties" Target="docProps/custom.xml"/>`);
  }
  z.file("_rels/.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rootRels.join("")}</Relationships>`);
  for (const [n, c] of Object.entries(p.extra ?? {})) z.file(n, c);
  z.file("[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/octet-stream"/>${overrides.join("")}${p.extraOverrides ?? ""}</Types>`);
  return z.generateAsync({ type: "uint8array" });
}

/** Every text-bearing string in a package (decoded XML), for leak checks. */
export async function allText(bytes: Uint8Array): Promise<string> {
  const z = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  for (const n of Object.keys(z.files)) if (!z.files[n].dir) parts.push(n, /\.(xml|rels)$/.test(n) ? await z.files[n].async("string") : "");
  return parts.join("\n");
}
export async function readPart(bytes: Uint8Array, name: string): Promise<string> {
  const z = await JSZip.loadAsync(bytes);
  return z.file(name)!.async("string");
}
export async function partList(bytes: Uint8Array): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(bytes)).files);
}

const bold = "<w:b/>", ital = "<w:i/>", red = `<w:color w:val="FF0000"/>`, font = `<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="28"/>`;

/** French representative document: split runs, formatting, table, hyperlink, header/footer, footnote, comment, tracked changes, textbox. */
export async function frenchDocx(): Promise<Uint8Array> {
  const body = [
    para(run("CONTRAT DE PRESTATION", bold), `<w:pStyle w:val="Normal"/><w:jc w:val="center"/>`),
    // name split across three runs with different formatting
    para(run("Entre ") + run("Jean", bold) + run(" ") + run("Dupont", ital + red) + run(", né le 12 mars 1980, demeurant 12 rue de la Paix, 75002 Paris, et ") + run("Marie-Claire ", font) + run("MARTIN-LEFÈVRE", bold) + run(".")),
    para(run("La société ") + run("ABC Conseil SAS", bold) + run(" (SIREN 552 100 554) représentée par M. Dupont. Contact : jean.dupont@exemple.fr, 06 12 34 56 78. IBAN FR14 2004 1010 0505 0001 3M02 606. RG n° 23/04567.")),
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${para(run("Client : ") + run("Jean Dupont", bold))}</w:tc><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(run("jean dupont (imbriqué)"))}</w:tc></w:tr></w:tbl>${para("")}</w:tc></w:tr></w:tbl>`,
    para(`<w:hyperlink r:id="rId20" w:tooltip="Site de Jean Dupont">${run("Voir le site de Jean Dupont", `<w:rStyle w:val="Hyperlink"/><w:u w:val="single"/>`)}</w:hyperlink>`),
    para(run("Jean") + `<w:r><w:tab/></w:r>` + run("Durand ne doit pas être fusionné avec Dupont.")),
    para(`<w:del w:id="1" w:author="Alice Moreau" w:date="2024-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">Ancien client : Pierre Lambert</w:delText></w:r></w:del><w:ins w:id="2" w:author="Alice Moreau" w:date="2024-01-01T00:00:00Z">${run("Nouveau client : Jean Dupont")}</w:ins>`),
    para(`<w:commentRangeStart w:id="0"/>${run("Clause sensible")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>`),
    para(`<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:docPr id="1" name="Zone" descr="Photo de Jean Dupont"/><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${para(run("Zone de texte : Jean Dupont"))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${para(run("Zone de texte : Jean Dupont"))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>`),
    para(`<w:r><w:rPr><w:vanish/></w:rPr><w:t>Texte caché : Jean Dupont</w:t></w:r>`),
    para(run("Fait à Paris, le 1er janvier 2024. ") + `<w:bookmarkStart w:id="5" w:name="Dupont_clause"/>` + run("Fin") + `<w:bookmarkEnd w:id="5"/>`)
  ].join("");
  return buildDocx({
    body,
    header: para(run("Cabinet — dossier Jean Dupont", bold)),
    footer: para(run("Page — jean.dupont@exemple.fr")),
    footnotes: `<w:footnote w:id="1">${para(run("Voir aussi Marie-Claire MARTIN-LEFÈVRE."))}</w:footnote>`,
    comments: `<w:comment w:id="0" w:author="Alice Moreau" w:initials="AM">${para(run("À vérifier avec Jean Dupont"))}</w:comment>`,
    rels: `<Relationship Id="rId20" Type="${R_NS}/hyperlink" Target="https://exemple.fr/jean-dupont" TargetMode="External"/>`,
    custom: true
  });
}

export async function englishDocx(): Promise<Uint8Array> {
  const body = [
    para(run("SERVICES AGREEMENT", bold)),
    para(run("Between ") + run("John", bold) + run(" Smith", ital) + run(" of 221B Baker Street, London NW1 6XE and Acme Holdings Ltd (company number 01234567). Mr. Smith may be reached on +44 20 7946 0958 or john.smith@example.co.uk. DOB: 3 April 1975.")),
    para(run("Payment to GB29 NWBK 6016 1331 9268 19. Claim No. HC-2023-000123; see [2023] EWHC 1234 (Ch). US contact (415) 555-2671, 500 Market Street, San Francisco, CA 94105.")),
    para(run("Smith") + run(" and ") + run("john smith", bold) + run(" are the same person; Smithson is not."))
  ].join("");
  return buildDocx({ body, header: para(run("Privileged — John Smith")), core: undefined });
}
