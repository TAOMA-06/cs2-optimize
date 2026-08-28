import { readFileSync, existsSync } from "node:fs";
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
const requiredWorkbenchTokens = [
  "OPT / LAB",
  "全部工具",
  'data-view-panel="overview"',
  'data-view-panel="diagnostics"',
  'data-view-panel="recovery"',
  'data-view-panel="settings"',
  'id="diagnosticHostBadge"',
  'id="recoveryList"'
];
const retiredWorkbenchTokens = [
  'id="moduleFrame"',
  'id="retryModuleButton"',
  'id="journeyList"',
  'data-view-panel="optimizer"',
  'data-open-module="cs2-sensitivity"',
  'data-open-module="cs2-lineups"',
  "./modules/cs2-sensitivity/",
  "./modules/cs2-lineups/"
];

for (const file of files) {
  const absolutePath = path.join(workspace, file);
  const source = readFileSync(absolutePath, "utf8");
  if (!source.trim()) {
    throw new Error(`${file} is empty.`);
  }
}

const html = readFileSync(path.join(workspace, "opt-lab/web/index.html"), "utf8");
for (const token of requiredWorkbenchTokens) {
  if (!html.includes(token)) {
    throw new Error(`Missing required workbench marker: ${token}`);
  }
}
for (const token of retiredWorkbenchTokens) {
  if (html.includes(token)) {
    throw new Error(`Workbench still references retired shell marker: ${token}`);
  }
}

if (/https?:\/\//i.test(html)) {
  throw new Error("The offline workbench must not embed external URLs.");
}

const rootEntry = readFileSync(path.join(workspace, "index.html"), "utf8");
if (/http-equiv\s*=\s*["']refresh["']/i.test(rootEntry) || rootEntry.includes("url=./opt-lab/web/index.html")) {
  throw new Error("The repository root must be a three-product chooser, not a redirect into the workbench.");
}
for (const token of ["./opt-lab/web/index.html", "./cs2-sensitivity/index.html", "./cs2-lineups/index.html", "选择工具"]) {
  if (!rootEntry.includes(token)) {
    throw new Error(`The repository root chooser is missing ${token}.`);
  }
}

const appSource = readFileSync(path.join(workspace, "opt-lab/web/app.js"), "utf8");
for (const token of ["./modules/cs2-sensitivity/index.html", "./modules/cs2-lineups/index.html", "moduleFrame", "openModule("]) {
  if (appSource.includes(token)) {
    throw new Error(`The workbench must not load sibling tools through ${token}.`);
  }
}

for (const product of ["cs2-sensitivity/index.html", "cs2-lineups/index.html"]) {
  const productHtml = readFileSync(path.join(workspace, product), "utf8");
  if (!productHtml.includes("全部工具") || !productHtml.includes('id="toolsHome"')) {
    throw new Error(`${product} must offer a quiet link back to the product chooser.`);
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
if (appProject.includes("Assets\\Shell\\modules") || appProject.includes("Assets\\Shell\\")) {
  throw new Error("The Windows app must package products at the asset root, not under Assets/Shell/modules.");
}
for (const token of ["Assets\\index.html", "Assets\\opt-lab\\web\\", "Assets\\cs2-sensitivity\\index.html", "Assets\\cs2-lineups\\index.html"]) {
  if (!appProject.includes(token)) {
    throw new Error(`The Windows app must map packaged files to ${token}.`);
  }
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
if (!nativeHost.includes("https://oplab.local/index.html")) {
  throw new Error("Native host must start at the product chooser.");
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

const previewSource = readFileSync(path.join(workspace, "scripts/serve-preview.mjs"), "utf8");
for (const token of ['pathname === "/"', "opt-lab/web", "cs2-sensitivity", "cs2-lineups", "\\/modules\\/"]) {
  if (!previewSource.includes(token)) {
    throw new Error(`Preview server is missing product routing token: ${token}`);
  }
}

for (const file of ["opt-lab/web/index.html", "cs2-sensitivity/index.html", "cs2-lineups/index.html"]) {
  if (!existsSync(path.join(workspace, file))) {
    throw new Error(`Missing product entry: ${file}`);
  }
}

for (const file of ["opt-lab/web/app.js", "opt-lab/web/core.mjs", "opt-lab/web/optimization-catalog.mjs", "scripts/serve-preview.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(workspace, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${file} has invalid JavaScript:\n${result.stderr}`);
  }
}

process.stdout.write("Web shell source checks passed.\n");
