import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRecommendations, SOURCES } from "../opt-lab/web/optimization-catalog.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "index.html",
  "opt-lab/web/index.html",
  "opt-lab/web/styles.css",
  "opt-lab/web/app.js",
  "opt-lab/web/core.mjs",
  "opt-lab/web/optimization-catalog.mjs",
  "cs2-sensitivity/index.html",
  "cs2-sensitivity/legacy-share.html",
  "cs2-sensitivity/manifest.template.json",
  "cs2-lineups/index.html",
  "cs2-lineups/manifest.template.json"
];
const requiredHtmlTokens = [
  "OPT / LAB",
  'id="moduleFrame"',
  'id="retryModuleButton"',
  'id="journeyList"',
  'data-view-panel="optimizer"',
  'data-view-panel="diagnostics"',
  'id="diagnosticHostBadge"',
  'id="recommendationList"',
  'data-view-panel="recovery"',
  'data-open-module="cs2-sensitivity"',
  'data-open-module="cs2-lineups"'
];

for (const file of files) {
  const absolutePath = path.join(workspace, file);
  const source = readFileSync(absolutePath, "utf8");
  if (!source.trim()) {
    throw new Error(`${file} is empty.`);
  }
}

const html = readFileSync(path.join(workspace, "opt-lab/web/index.html"), "utf8");
for (const token of requiredHtmlTokens) {
  if (!html.includes(token)) {
    throw new Error(`Missing required shell marker: ${token}`);
  }
}

if (/https?:\/\//i.test(html)) {
  throw new Error("The offline shell must not embed external URLs.");
}

const rootEntry = readFileSync(path.join(workspace, "index.html"), "utf8");
if (!rootEntry.includes("url=./opt-lab/web/index.html") || !rootEntry.includes("OPT / LAB")) {
  throw new Error("The repository root must launch the OPT / LAB application.");
}

const appSource = readFileSync(path.join(workspace, "opt-lab/web/app.js"), "utf8");
for (const token of ["./modules/cs2-sensitivity/index.html", "./modules/cs2-lineups/index.html"]) {
  if (!appSource.includes(token)) {
    throw new Error(`The shell must load sibling tools through ${token}.`);
  }
}

const sensitivityManifest = JSON.parse(readFileSync(path.join(workspace, "cs2-sensitivity/manifest.template.json"), "utf8"));
if (sensitivityManifest.id !== "cs2-sensitivity" || sensitivityManifest.version !== "3.0.0" || sensitivityManifest.entryPoint !== "index.html") {
  throw new Error("The sensitivity module manifest does not target its canonical product entry point.");
}

const lineupsManifest = JSON.parse(readFileSync(path.join(workspace, "cs2-lineups/manifest.template.json"), "utf8"));
if (lineupsManifest.id !== "cs2-lineups" || lineupsManifest.kind !== "Reference" || lineupsManifest.entryPoint !== "index.html") {
  throw new Error("The lineups module manifest does not target its canonical product entry point.");
}

const appProject = readFileSync(path.join(workspace, "opt-lab/src/OptLab.App/OptLab.App.csproj"), "utf8");
if (appProject.includes("cs2-sensitivity-lab.html") || appProject.includes("cs2-lineups-map.html")) {
  throw new Error("The Windows app must package sibling product folders, not root-level compatibility pages.");
}
if (!appProject.includes("cs2-sensitivity\\index.html") || !appProject.includes("cs2-lineups\\index.html")) {
  throw new Error("The Windows app must map both sibling tools into Assets/Shell/modules.");
}

const nativeNavigation = readFileSync(path.join(workspace, "opt-lab/src/OptLab.App/Services/ExternalNavigationCatalog.cs"), "utf8");
const nativeHost = readFileSync(path.join(workspace, "opt-lab/src/OptLab.App/MainWindow.xaml.cs"), "utf8");
const nativeWindow = readFileSync(path.join(workspace, "opt-lab/src/OptLab.App/MainWindow.xaml"), "utf8");
const hostContextProvider = readFileSync(path.join(workspace, "opt-lab/src/OptLab.App/Services/HostContextProvider.cs"), "utf8");
for (const token of ["host.context", "host.acknowledged", "host.error"]) {
  if (!nativeHost.includes(`\"${token}\"`)) {
    throw new Error(`Native host response is missing: ${token}`);
  }
}
for (const token of ["SystemMutations: false", "BrokerDiagnostics: false", "SignedUpdates: false"]) {
  if (!hostContextProvider.includes(token)) {
    throw new Error(`Desktop capability boundary is missing: ${token}`);
  }
}
for (const token of ["OnRetryClick", "OnCloseClick", "FallbackProgress"]) {
  if (!nativeWindow.includes(token)) {
    throw new Error(`Native fallback control is missing: ${token}`);
  }
}
if (!nativeHost.includes("OnNavigationCompleted")) {
  throw new Error("Native navigation failure recovery is missing.");
}
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

for (const file of ["opt-lab/web/app.js", "opt-lab/web/core.mjs", "opt-lab/web/optimization-catalog.mjs", "scripts/serve-preview.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(workspace, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${file} has invalid JavaScript:\n${result.stderr}`);
  }
}

process.stdout.write("Web shell source checks passed.\n");
