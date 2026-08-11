import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["web/index.html", "web/styles.css", "web/app.js", "web/core.mjs"];
const requiredHtmlTokens = [
  "OPT / LAB",
  'id="moduleFrame"',
  'data-view-panel="recovery"',
  'data-open-module="cs2-sensitivity"'
];

for (const file of files) {
  const absolutePath = path.join(workspace, file);
  const source = readFileSync(absolutePath, "utf8");
  if (!source.trim()) {
    throw new Error(`${file} is empty.`);
  }
}

const html = readFileSync(path.join(workspace, "web/index.html"), "utf8");
for (const token of requiredHtmlTokens) {
  if (!html.includes(token)) {
    throw new Error(`Missing required shell marker: ${token}`);
  }
}

if (/https?:\/\//i.test(html)) {
  throw new Error("The offline shell must not embed external URLs.");
}

for (const file of ["web/app.js", "web/core.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(workspace, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${file} has invalid JavaScript:\n${result.stderr}`);
  }
}

process.stdout.write("Web shell source checks passed.\n");

