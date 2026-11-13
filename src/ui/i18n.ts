import { createContext, useContext } from "react";

export type Lang = "en" | "fr";

const en = {
  title: "Legal Anonymiser", subtitle: "Local pseudonymisation & redaction · FR / EN", version: "MVP 0.3",
  localBanner: "Local-only processing", localBannerText: "Analysis, replacement and encryption run in this task pane. Document content is never sent to a server or AI service.",
  experimental: "Heuristic detection can miss or mis-label information. Review every entity. Test only on synthetic documents until independently validated.",
  mode: "Processing mode", modePseudo: "Pseudonymise (reversible)", modeRedact: "Redact (irreversible)", modeRestore: "Restore",
  modePseudoDesc: "Replaces identities with codes (PERSON_001). A separate encrypted .lamap file lets you restore them. Pseudonymised data is still personal data.",
  modeRedactDesc: "Replaces identities with labels ([REDACTED_PERSON]) and removes comments, tracked changes and metadata. No mapping is kept. This cannot be undone.",
  modeRestoreDesc: "Open the pseudonymised document in Word, then select its .lamap file and enter the password. A new restored document is created.",
  step1: "1. Analyse", analyse: "Analyse open document", analysing: "Analysing locally…", notInWord: "Not running inside Word. Select a .docx file to test:", reanalyse: "Re-analyse",
  step2: "2. Review entities", reviewHelp: "Include or exclude each item, change its category, or add items detection missed. Low-confidence items are not pre-selected.",
  colInclude: "Include", colCategory: "Category", colOriginal: "Original value", colReplacement: "Replacement", colCount: "Count", colConfidence: "Confidence",
  conf_high: "High (validated)", conf_medium: "Medium (heuristic)", conf_low: "Low (uncertain)", conf_manual: "Manual",
  showLow: "Show low-confidence items", noEntities: "No entities detected. Add items manually below.",
  addManual: "Add an item", manualText: "Text to replace", manualKind: "Category", add: "Add", remove: "Remove", manualEmpty: "Enter the exact text to replace.", manualNone: "That text does not occur in the document.",
  summary: "{n} detected · {m} selected · {k} occurrences", allOccurrences: "Occurrences are matched case-insensitively and across formatting runs; partial words are never replaced.",
  step3: "3. Process", caseLabel: "Case name (stored only inside the encrypted file)", password: "Mapping-file password", passwordConfirm: "Confirm password",
  passwordHelp: "At least 12 characters. A long random passphrase from a password manager is best. The password is never stored and cannot be recovered: if you lose it, restoration is impossible.",
  strength0: "Weak", strength1: "Fair", strength2: "Good", strength3: "Strong", strengthLabel: "Password strength",
  hint_short: "Too short (minimum 12).", hint_common: "Contains a common word.", hint_repeat: "Repeated characters.", hint_sequence: "Predictable sequence.", hint_classes: "Mix upper/lower case, digits and symbols, or make it longer.",
  mismatch: "Passwords do not match.",
  ackWarnings: "I have read the warnings above and accept that they are not handled by this tool.",
  confirmRedact: "I understand that redaction is irreversible and that no mapping will be kept.",
  runPseudo: "Create pseudonymised document", runRedact: "Create redacted document", processing: "Processing locally…",
  step4: "Results", replacements: "Replacements made", detected: "Entities detected", selected: "Entities processed",
  openDoc: "Open new document in Word", downloadDoc: "Download .docx", downloadMap: "Export encrypted mapping (.lamap)",
  docOpened: "New document opened in Word.", docOpenFailed: "Word could not open the new document automatically. Use “Download .docx”.",
  mapStatus: "Mapping file", mapNotExported: "NOT YET EXPORTED — export it now; without it restoration is impossible.", mapExported: "Exported: {name}. Keep it separate from the password.", mapNone: "None created (redaction keeps no mapping).",
  originalUntouched: "The original document was not modified.",
  restoreTitle: "Restore identities", mapFile: "Mapping file (.lamap)", restoreBtn: "Restore into a new document", restored: "Restored {n} replacements into a new document (case: {c}).",
  warnings: "Warnings and limitations", blocked: "Processing stopped — nothing was produced",
  busy: "Working…", lang: "Language",
  err_generic: "Something went wrong. No output was produced.", err_noDoc: "Could not read the open document.",
  map_INVALID_FILE: "This is not a valid .lamap file or it is corrupted.", map_UNSUPPORTED_VERSION: "Unsupported mapping-file version.",
  map_AUTH_FAILED: "Could not decrypt: wrong password or the file has been altered/corrupted.", map_INVALID_PAYLOAD: "The decrypted mapping is invalid.", map_WEAK_PASSWORD: "Password too short.",
  issue_UNKNOWN_PART: "Unsupported package part cannot be sanitised: {p}", issue_EMBEDDED_OBJECT: "Embedded object/workbook cannot be sanitised: {p}", issue_ALT_CHUNK: "Alternative content (altChunk) cannot be sanitised.",
  issue_EXTERNAL_RELATIONSHIP: "External link/template reference cannot be sanitised: {p}", issue_TOKEN_COLLISION: "The document already contains text shaped like a pseudonym (e.g. PERSON_001). Restoration would be ambiguous, so processing was stopped.",
  issue_UNMAPPED_TOKENS: "The document contains {n} pseudonym(s) that are not in this mapping. Wrong case file? Nothing was restored.", issue_CASE_MISMATCH: "This mapping file belongs to a different case than the document. Nothing was restored.",
  issue_NO_CASE_MARKER: "The document has no case marker (it may have been edited elsewhere). Restoration relied on exact pseudonym matching only.",
  issue_RESIDUAL: "Verification found remaining sensitive content or invalid structure in: {p}. Export blocked.", issue_INTEGRITY: "The resulting package failed integrity checks ({p}). Export blocked.",
  issue_NOT_DOCX: "This is not a readable .docx document.", issue_TOO_LARGE: "The document is too large to process safely.",
  issue_IMAGES: "{n} image(s) are NOT analysed: text inside images and image metadata may still reveal identities. Check them manually.",
  issue_TRACKED_ACCEPTED: "Tracked changes were accepted; deleted text was removed.", issue_TRACKED_KEPT: "Tracked changes were kept; their text (including deletions) was pseudonymised.",
  issue_COMMENTS_REMOVED: "Comments were removed.", issue_CUSTOM_XML_REMOVED: "Custom XML data and content-control data bindings were removed.",
  issue_METADATA_WIPED: "Document properties (author, title, company…), thumbnail, printer settings and people data were removed.", issue_HIDDEN_TEXT: "Hidden text exists; it was processed like visible text.",
  issue_PARTS_REMOVED: "{n} package part(s) were removed.", issue_NAME_CONFLICT: "Two selected items had the same text; the first was used.", issue_NO_ENTITIES: "No items are selected.",
  issue_NO_TOKENS_FOUND: "No pseudonyms from this mapping were found in the open document.", issue_MAPPING_INVALID: "The mapping is invalid.",
  footer: "Not legal advice. Not certified GDPR-compliant. Pseudonymised data remains personal data. Independent review is required before use with confidential client files."
};
export type Dict = typeof en;

const fr: Dict = {
  title: "Legal Anonymiser", subtitle: "Pseudonymisation et caviardage en local · FR / EN", version: "MVP 0.3",
  localBanner: "Traitement exclusivement local", localBannerText: "L'analyse, le remplacement et le chiffrement s'exécutent dans ce volet. Le contenu du document n'est jamais envoyé à un serveur ni à un service d'IA.",
  experimental: "La détection heuristique peut oublier ou mal classer des informations. Vérifiez chaque entité. N'utilisez que des documents fictifs tant qu'une validation indépendante n'a pas eu lieu.",
  mode: "Mode de traitement", modePseudo: "Pseudonymiser (réversible)", modeRedact: "Caviarder (irréversible)", modeRestore: "Restaurer",
  modePseudoDesc: "Remplace les identités par des codes (PERSON_001). Un fichier .lamap chiffré distinct permet de les restaurer. Une donnée pseudonymisée reste une donnée personnelle.",
  modeRedactDesc: "Remplace les identités par des mentions ([REDACTED_PERSON]) et supprime commentaires, suivi des modifications et métadonnées. Aucune table de correspondance n'est conservée. Opération irréversible.",
  modeRestoreDesc: "Ouvrez le document pseudonymisé dans Word, puis sélectionnez son fichier .lamap et saisissez le mot de passe. Un nouveau document restauré est créé.",
  step1: "1. Analyser", analyse: "Analyser le document ouvert", analysing: "Analyse locale…", notInWord: "Hors de Word. Sélectionnez un fichier .docx pour tester :", reanalyse: "Relancer l'analyse",
  step2: "2. Vérifier les entités", reviewHelp: "Incluez ou excluez chaque élément, changez sa catégorie ou ajoutez ce que la détection a manqué. Les éléments peu fiables ne sont pas présélectionnés.",
  colInclude: "Inclure", colCategory: "Catégorie", colOriginal: "Valeur d'origine", colReplacement: "Remplacement", colCount: "Nb", colConfidence: "Fiabilité",
  conf_high: "Élevée (validée)", conf_medium: "Moyenne (heuristique)", conf_low: "Faible (incertaine)", conf_manual: "Manuel",
  showLow: "Afficher les éléments peu fiables", noEntities: "Aucune entité détectée. Ajoutez des éléments manuellement ci-dessous.",
  addManual: "Ajouter un élément", manualText: "Texte à remplacer", manualKind: "Catégorie", add: "Ajouter", remove: "Retirer", manualEmpty: "Saisissez le texte exact à remplacer.", manualNone: "Ce texte n'apparaît pas dans le document.",
  summary: "{n} détectées · {m} sélectionnées · {k} occurrences", allOccurrences: "Les occurrences sont repérées sans tenir compte de la casse et au travers des changements de mise en forme ; les mots partiels ne sont jamais remplacés.",
  step3: "3. Traiter", caseLabel: "Nom du dossier (stocké uniquement dans le fichier chiffré)", password: "Mot de passe du fichier de correspondance", passwordConfirm: "Confirmer le mot de passe",
  passwordHelp: "12 caractères minimum. Une longue phrase de passe aléatoire issue d'un gestionnaire de mots de passe est idéale. Le mot de passe n'est jamais stocké ni récupérable : en cas de perte, la restauration est impossible.",
  strength0: "Faible", strength1: "Moyen", strength2: "Bon", strength3: "Fort", strengthLabel: "Robustesse du mot de passe",
  hint_short: "Trop court (minimum 12).", hint_common: "Contient un mot courant.", hint_repeat: "Caractères répétés.", hint_sequence: "Séquence prévisible.", hint_classes: "Mélangez majuscules/minuscules, chiffres et symboles, ou allongez-le.",
  mismatch: "Les mots de passe ne correspondent pas.",
  ackWarnings: "J'ai lu les avertissements ci-dessus et j'accepte qu'ils ne soient pas traités par cet outil.",
  confirmRedact: "Je comprends que le caviardage est irréversible et qu'aucune table de correspondance ne sera conservée.",
  runPseudo: "Créer le document pseudonymisé", runRedact: "Créer le document caviardé", processing: "Traitement local…",
  step4: "Résultats", replacements: "Remplacements effectués", detected: "Entités détectées", selected: "Entités traitées",
  openDoc: "Ouvrir le nouveau document dans Word", downloadDoc: "Télécharger le .docx", downloadMap: "Exporter la correspondance chiffrée (.lamap)",
  docOpened: "Nouveau document ouvert dans Word.", docOpenFailed: "Word n'a pas pu ouvrir automatiquement le nouveau document. Utilisez « Télécharger le .docx ».",
  mapStatus: "Fichier de correspondance", mapNotExported: "PAS ENCORE EXPORTÉ — exportez-le maintenant ; sans lui, la restauration est impossible.", mapExported: "Exporté : {name}. Conservez-le séparément du mot de passe.", mapNone: "Aucun créé (le caviardage ne conserve aucune correspondance).",
  originalUntouched: "Le document d'origine n'a pas été modifié.",
  restoreTitle: "Restaurer les identités", mapFile: "Fichier de correspondance (.lamap)", restoreBtn: "Restaurer dans un nouveau document", restored: "{n} remplacements restaurés dans un nouveau document (dossier : {c}).",
  warnings: "Avertissements et limites", blocked: "Traitement interrompu — aucun document produit",
  busy: "En cours…", lang: "Langue",
  err_generic: "Une erreur est survenue. Aucun document n'a été produit.", err_noDoc: "Impossible de lire le document ouvert.",
  map_INVALID_FILE: "Ce n'est pas un fichier .lamap valide, ou il est corrompu.", map_UNSUPPORTED_VERSION: "Version de fichier de correspondance non prise en charge.",
  map_AUTH_FAILED: "Déchiffrement impossible : mot de passe incorrect, ou fichier altéré/corrompu.", map_INVALID_PAYLOAD: "La correspondance déchiffrée est invalide.", map_WEAK_PASSWORD: "Mot de passe trop court.",
  issue_UNKNOWN_PART: "Partie du paquet non prise en charge, impossible à assainir : {p}", issue_EMBEDDED_OBJECT: "Objet/classeur incorporé impossible à assainir : {p}", issue_ALT_CHUNK: "Contenu alternatif (altChunk) impossible à assainir.",
  issue_EXTERNAL_RELATIONSHIP: "Lien externe / référence de modèle impossible à assainir : {p}", issue_TOKEN_COLLISION: "Le document contient déjà du texte ayant la forme d'un pseudonyme (ex. PERSON_001). La restauration serait ambiguë : traitement interrompu.",
  issue_UNMAPPED_TOKENS: "Le document contient {n} pseudonyme(s) absents de cette correspondance. Mauvais fichier de dossier ? Rien n'a été restauré.", issue_CASE_MISMATCH: "Ce fichier de correspondance appartient à un autre dossier que le document. Rien n'a été restauré.",
  issue_NO_CASE_MARKER: "Le document n'a pas de marqueur de dossier (il a pu être modifié ailleurs). La restauration repose uniquement sur la correspondance exacte des pseudonymes.",
  issue_RESIDUAL: "La vérification a trouvé du contenu sensible restant ou une structure invalide dans : {p}. Export bloqué.", issue_INTEGRITY: "Le paquet obtenu a échoué aux contrôles d'intégrité ({p}). Export bloqué.",
  issue_NOT_DOCX: "Ce document .docx n'est pas lisible.", issue_TOO_LARGE: "Le document est trop volumineux pour être traité en sécurité.",
  issue_IMAGES: "{n} image(s) NE SONT PAS analysées : le texte contenu dans les images et leurs métadonnées peuvent révéler des identités. Vérifiez-les manuellement.",
  issue_TRACKED_ACCEPTED: "Les modifications suivies ont été acceptées ; le texte supprimé a été retiré.", issue_TRACKED_KEPT: "Les modifications suivies ont été conservées ; leur texte (suppressions comprises) a été pseudonymisé.",
  issue_COMMENTS_REMOVED: "Les commentaires ont été supprimés.", issue_CUSTOM_XML_REMOVED: "Les données XML personnalisées et les liaisons de données des contrôles de contenu ont été supprimées.",
  issue_METADATA_WIPED: "Propriétés du document (auteur, titre, société…), miniature, paramètres d'imprimante et données de personnes supprimés.", issue_HIDDEN_TEXT: "Du texte masqué existe ; il a été traité comme le texte visible.",
  issue_PARTS_REMOVED: "{n} partie(s) du paquet supprimée(s).", issue_NAME_CONFLICT: "Deux éléments sélectionnés avaient le même texte ; le premier a été utilisé.", issue_NO_ENTITIES: "Aucun élément n'est sélectionné.",
  issue_NO_TOKENS_FOUND: "Aucun pseudonyme de cette correspondance n'a été trouvé dans le document ouvert.", issue_MAPPING_INVALID: "La correspondance est invalide.",
  footer: "Ne constitue pas un conseil juridique. Aucune certification RGPD. Une donnée pseudonymisée reste une donnée personnelle. Une revue indépendante est requise avant tout usage sur des dossiers clients confidentiels."
};

export const dicts: Record<Lang, Dict> = { en, fr };
export type Tr = (key: keyof Dict, vars?: Record<string, string | number>) => string;
export const makeT = (lang: Lang): Tr => (key, vars) => {
  let s: string = dicts[lang][key] ?? dicts.en[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};
export const LangContext = createContext<Tr>(makeT("en"));
export const useT = () => useContext(LangContext);

export function initialLang(): Lang {
  try { const l = (Office?.context?.displayLanguage ?? navigator.language ?? "en").toLowerCase(); return l.startsWith("fr") ? "fr" : "en"; } catch { return "en"; }
}
