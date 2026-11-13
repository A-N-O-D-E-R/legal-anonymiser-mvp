// One-time: creates the release signing key and pins its PUBLIC half in scripts/install.sh and scripts/install.ps1.
// Usage: node scripts/keygen.mjs <private-key-output.pem>
// Then store the private PEM as the GitHub Actions secret RELEASE_SIGNING_KEY and delete the local copy (or keep it offline).
// Rotating the key = run again, commit the installers, and tell users to re-download the installer.
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/keygen.mjs <private-key-output.pem>"); process.exit(1); }
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
const pem = publicKey.export({ type: "spki", format: "pem" }).trim();
const jwk = publicKey.export({ format: "jwk" });
const b64 = (u) => Buffer.from(u, "base64url").toString("base64");
const xml = `<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>`;

const pin = (file, value) => {
  const s = readFileSync(file, "utf8");
  const next = s.replace(/(PUBKEY=|\$pub = )'[^']*'/, (_, v) => `${v}'${value}'`);
  if (next === s) throw new Error(`no key slot in ${file}`);
  writeFileSync(file, next);
};
pin("scripts/install.sh", `\n${pem}\n`); // own lines, so CI can sed the PEM out
pin("scripts/install.ps1", xml);
console.log(`private key -> ${out}\npublic key pinned in scripts/install.sh and scripts/install.ps1`);
