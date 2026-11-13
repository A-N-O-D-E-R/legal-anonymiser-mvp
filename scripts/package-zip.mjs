// Creates a ZIP of the complete project (without node_modules, dist output is included if present).
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const out = `../legal-anonymiser-mvp-${version}.zip`;
rmSync(out, { force: true });
execFileSync("zip", ["-r", out, ".", "-x", "node_modules/*", ".git/*", "*.zip", ".DS_Store"], { stdio: "inherit" });
console.log("created", out);
