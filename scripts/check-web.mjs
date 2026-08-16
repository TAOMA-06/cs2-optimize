import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRecommendations, SOURCES } from "../web/optimization-catalog.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["web/index.html", "web/styles.css", "web/app.js", "web/core.mjs", "web/optimization-catalog.mjs"];
const requiredHtmlTokens = [
  "OPT / LAB",
  'id="moduleFrame"',
  'data-view-panel="optimizer"',
  'id="recommendationList"',
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

const nativeNavigation = readFileSync(path.join(workspace, "src/OptLab.App/Services/ExternalNavigationCatalog.cs"), "utf8");
for (const sourceId of Object.keys(SOURCES)) {
  if (!nativeNavigation.includes(`["${sourceId}"]`)) {
    throw new Error(`Research source is not present in the native allowlist: ${sourceId}`);
  }
}

const settingsPageIds = new Set();
for (const os of ["windows11", "windows10"]) {
  for (const gpuVendor of ["nvidia", "amd", "other", "unknown"]) {
    for (const platform of ["perfect", "fivee", "steam"]) {
      for (const rule of getRecommendations({ os, gpuVendor, platform }, "full")) {
        if (rule.action.type === "settings") settingsPageIds.add(rule.action.pageId);
      }
    }
  }
}
for (const pageId of settingsPageIds) {
  if (!nativeNavigation.includes(`["${pageId}"]`)) {
    throw new Error(`Windows settings page is not present in the native allowlist: ${pageId}`);
  }
}

for (const file of ["web/app.js", "web/core.mjs", "web/optimization-catalog.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(workspace, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${file} has invalid JavaScript:\n${result.stderr}`);
  }
}

process.stdout.write("Web shell source checks passed.\n");
