import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRecommendations, SOURCES } from "../web/optimization-catalog.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "index.html",
  "web/index.html",
  "web/styles.css",
  "web/app.js",
  "web/core.mjs",
  "web/optimization-catalog.mjs",
  "web/modules/cs2-sensitivity/index.html",
  "web/modules/cs2-sensitivity/legacy-share.html",
  "web/modules/cs2-sensitivity/manifest.template.json"
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

const rootEntry = readFileSync(path.join(workspace, "index.html"), "utf8");
if (!rootEntry.includes("url=./web/index.html") || !rootEntry.includes("OPT / LAB")) {
  throw new Error("The repository root must launch the OPT / LAB application.");
}

const appSource = readFileSync(path.join(workspace, "web/app.js"), "utf8");
if (!appSource.includes("./modules/cs2-sensitivity/index.html")) {
  throw new Error("The sensitivity lab must load from the application module directory.");
}

const moduleManifest = JSON.parse(readFileSync(path.join(workspace, "web/modules/cs2-sensitivity/manifest.template.json"), "utf8"));
if (moduleManifest.id !== "cs2-sensitivity" || moduleManifest.version !== "3.0.0" || moduleManifest.entryPoint !== "index.html") {
  throw new Error("The sensitivity module manifest does not target its canonical submodule entry point.");
}

const appProject = readFileSync(path.join(workspace, "src/OptLab.App/OptLab.App.csproj"), "utf8");
if (appProject.includes("cs2-sensitivity-lab.html")) {
  throw new Error("The Windows app must package sensitivity through web/modules, not a root-level product file.");
}

const nativeNavigation = readFileSync(path.join(workspace, "src/OptLab.App/Services/ExternalNavigationCatalog.cs"), "utf8");
const nativeHost = readFileSync(path.join(workspace, "src/OptLab.App/MainWindow.xaml.cs"), "utf8");
const nativeWindow = readFileSync(path.join(workspace, "src/OptLab.App/MainWindow.xaml"), "utf8");
const hostContextProvider = readFileSync(path.join(workspace, "src/OptLab.App/Services/HostContextProvider.cs"), "utf8");
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

for (const file of ["web/app.js", "web/core.mjs", "web/optimization-catalog.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(workspace, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${file} has invalid JavaScript:\n${result.stderr}`);
  }
}

process.stdout.write("Web shell source checks passed.\n");
