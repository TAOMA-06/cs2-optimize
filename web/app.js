import {
  createCalibrationRecord,
  formatDateTime,
  getActiveTransactions,
  getOverviewState,
  loadState,
  saveState,
  upsertCalibrationRecord
} from "./core.mjs";

const VIEW_META = {
  overview: { kicker: "WORKSTATION / OVERVIEW", title: "本机状态" },
  modules: { kicker: "MODULE LIBRARY / OFFICIAL", title: "优化方案" },
  module: { kicker: "CALIBRATION / LOCAL MODULE", title: "CS2 灵敏度实验室" },
  recovery: { kicker: "TRANSACTION / RECOVERY", title: "恢复中心" },
  history: { kicker: "LOCAL / ACTIVITY LOG", title: "运行记录" },
  settings: { kicker: "LOCAL / CONTROL PLANE", title: "设置" }
};

const state = loadState();
const elements = {
  appShell: document.getElementById("appShell"),
  workspaceHead: document.getElementById("workspaceHead"),
  headKicker: document.getElementById("headKicker"),
  headTitle: document.getElementById("headTitle"),
  activeChangeMetric: document.getElementById("activeChangeMetric"),
  calibrationMetric: document.getElementById("calibrationMetric"),
  recoveryMetric: document.getElementById("recoveryMetric"),
  recoveryNavCount: document.getElementById("recoveryNavCount"),
  latestCalibrationReadout: document.getElementById("latestCalibrationReadout"),
  historyList: document.getElementById("historyList"),
  recoveryList: document.getElementById("recoveryList"),
  recoveryStatus: document.getElementById("recoveryStatus"),
  moduleFrame: document.getElementById("moduleFrame"),
  moduleFrameLoading: document.getElementById("moduleFrameLoading"),
  updatesToggle: document.getElementById("updatesToggle"),
  motionToggle: document.getElementById("motionToggle"),
  toast: document.getElementById("toast")
};

let toastTimeout;
let moduleFrameInitialized = false;
let observedResultSignature = null;
let moduleObserver;

hydratePreferences();
wireNavigation();
wireSettings();
wireModuleFrame();
render();
if (state.activeView === "module" && state.activeModuleId === "cs2-sensitivity") {
  openModule("cs2-sensitivity");
} else {
  selectView(state.activeView in VIEW_META ? state.activeView : "overview", { persist: false });
}
announceHostReady();

function wireNavigation() {
  document.addEventListener("click", (event) => {
    const moduleButton = event.target.closest("[data-open-module]");
    if (moduleButton) {
      event.preventDefault();
      openModule(moduleButton.dataset.openModule);
      return;
    }

    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      event.preventDefault();
      selectView(viewButton.dataset.view);
      return;
    }

    const navigationLink = event.target.closest("[data-navigate]");
    if (navigationLink) {
      event.preventDefault();
      selectView(navigationLink.dataset.navigate);
    }
  });

  document.getElementById("clearHistory").addEventListener("click", () => {
    if (!state.calibrationHistory.length) {
      showToast("本机没有可清除的校准记录。");
      return;
    }

    if (window.confirm("清除本机保存的全部 CS2 校准记录？此操作不会影响 CS2 或 Windows 设置。")) {
      state.calibrationHistory = [];
      persist();
      render();
      showToast("已清除本机校准记录。");
    }
  });
}

function wireSettings() {
  elements.updatesToggle.addEventListener("change", () => {
    state.preferences.checkForUpdates = elements.updatesToggle.checked;
    persist();
    postToHost("settings.updated", { checkForUpdates: state.preferences.checkForUpdates });
    showToast(elements.updatesToggle.checked ? "已允许检查官方签名模块更新。" : "已关闭模块更新检查。");
  });

  elements.motionToggle.addEventListener("change", () => {
    state.preferences.reducedMotion = elements.motionToggle.checked;
    applyMotionPreference();
    persist();
  });

  document.getElementById("checkUpdates").addEventListener("click", () => {
    postToHost("updates.check", { manual: true });
    showToast("预览模式未配置更新源；Windows 发布版会校验更新签名后再显示结果。");
  });

  document.getElementById("exportDiagnostics").addEventListener("click", exportDiagnosticSummary);
}

function wireModuleFrame() {
  elements.moduleFrame.addEventListener("load", () => {
    elements.moduleFrame.classList.add("is-loaded");
    elements.moduleFrameLoading.classList.add("is-hidden");
    attachCalibrationObserver();
  });

  elements.moduleFrame.addEventListener("error", () => {
    showToast("校准模块加载失败。请确认原始 HTML 仍位于项目根目录。");
  });
}

function selectView(view, { persist: shouldPersist = true } = {}) {
  if (!VIEW_META[view]) {
    return;
  }

  state.activeView = view;
  const metadata = VIEW_META[view];
  elements.headKicker.textContent = metadata.kicker;
  elements.headTitle.textContent = metadata.title;
  elements.workspaceHead.classList.toggle("is-hidden", view === "module");

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });

  if (shouldPersist) {
    persist();
  }

  if (view !== "module") {
    window.scrollTo({ top: 0, behavior: state.preferences.reducedMotion ? "auto" : "smooth" });
  }
}

function openModule(moduleId) {
  if (moduleId !== "cs2-sensitivity") {
    showToast("该模块尚未发布可执行规则。");
    return;
  }

  state.activeModuleId = moduleId;
  if (!moduleFrameInitialized) {
    elements.moduleFrame.src = "../cs2-sensitivity-lab.html";
    moduleFrameInitialized = true;
  }
  selectView("module");
  postToHost("module.opened", { moduleId });
}

function attachCalibrationObserver() {
  if (moduleObserver) {
    moduleObserver.disconnect();
  }

  try {
    const moduleDocument = elements.moduleFrame.contentDocument;
    if (!moduleDocument?.body) {
      return;
    }

    const collectIfReady = () => window.setTimeout(collectCalibrationResult, 0);
    moduleObserver = new MutationObserver(collectIfReady);
    moduleObserver.observe(moduleDocument.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    moduleDocument.addEventListener("click", collectIfReady, true);
    collectIfReady();
  } catch {
    showToast("桌面宿主无法读取校准结果；原始网页仍可独立使用。");
  }
}

function collectCalibrationResult() {
  try {
    const moduleDocument = elements.moduleFrame.contentDocument;
    const resultView = moduleDocument?.getElementById("view-result");
    if (!resultView?.classList.contains("is-active")) {
      return;
    }

    const result = readCalibrationResult(moduleDocument);
    const signature = [result.command, result.precisionSensitivity, result.speedSensitivity, result.effectiveDpi].join("|");
    if (signature === observedResultSignature) {
      return;
    }

    observedResultSignature = signature;
    const record = createCalibrationRecord(result);
    state.calibrationHistory = upsertCalibrationRecord(state.calibrationHistory, record);
    persist();
    render();
    postToHost("module.result", record);
    showToast(`已将 ${record.command} 保存到本机记录。`);
  } catch {
    // The child tool can repaint intermediate values while it is generating. Ignore incomplete states.
  }
}

function readCalibrationResult(moduleDocument) {
  const text = (id) => moduleDocument.getElementById(id)?.textContent?.trim() ?? "";
  const numeric = (id) => Number.parseFloat(text(id).replace(/[^0-9.\-]/g, ""));

  return {
    sensitivity: numeric("resultSens"),
    precisionSensitivity: numeric("precisionSens"),
    speedSensitivity: numeric("speedSens"),
    effectiveDpi: numeric("resultEdpi"),
    centimetersPer360: numeric("resultCm"),
    confidence: text("resultConfidence"),
    command: text("commandText")
  };
}

function render() {
  const overview = getOverviewState(state);
  elements.activeChangeMetric.textContent = formatCount(overview.activeOptimizationCount);
  elements.calibrationMetric.textContent = formatCount(overview.calibrationCount);
  elements.recoveryMetric.textContent = overview.requiresRecovery ? "ACTION" : "CLEAR";
  elements.recoveryNavCount.textContent = formatCount(overview.activeOptimizationCount);
  elements.recoveryNavCount.classList.toggle("is-empty", overview.activeOptimizationCount === 0);

  renderLatestCalibration(overview.latestCalibration);
  renderHistory();
  renderRecovery();
}

function renderLatestCalibration(record) {
  elements.latestCalibrationReadout.replaceChildren();
  const label = document.createElement("span");
  label.textContent = "LAST RESULT";
  const value = document.createElement("strong");
  const note = document.createElement("small");

  if (record) {
    value.textContent = record.command;
    note.textContent = `${record.effectiveDpi ?? "—"} eDPI · ${record.centimetersPer360 ?? "—"} cm/360 · ${formatDateTime(record.completedAt)}`;
  } else {
    value.textContent = "尚无校准记录";
    note.textContent = "使用你的实际鼠标与 DPI 开始第一次测试。";
  }

  elements.latestCalibrationReadout.append(label, value, note);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  if (!state.calibrationHistory.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    const title = document.createElement("strong");
    title.textContent = "这里会保留你主动完成的本机校准。";
    const copy = document.createElement("p");
    copy.textContent = "不会记录鼠标轨迹，也不会读取游戏配置文件。";
    empty.append(title, copy);
    elements.historyList.append(empty);
    return;
  }

  state.calibrationHistory.forEach((record) => {
    const entry = document.createElement("article");
    entry.className = "history-entry";

    const module = document.createElement("span");
    module.className = "history-module";
    module.textContent = "CS2 / LAB";

    const command = document.createElement("div");
    const commandValue = document.createElement("strong");
    commandValue.textContent = record.command;
    const completedAt = document.createElement("small");
    completedAt.textContent = formatDateTime(record.completedAt);
    command.append(commandValue, completedAt);

    entry.append(module, command);
    entry.append(createHistoryMetric("eDPI", record.effectiveDpi ?? "—"));
    entry.append(createHistoryMetric("CM / 360", record.centimetersPer360 ? `${record.centimetersPer360}` : "—"));
    entry.append(createHistoryMetric("CONFIDENCE", record.confidence));

    const copyButton = document.createElement("button");
    copyButton.className = "history-copy";
    copyButton.type = "button";
    copyButton.textContent = "复制命令";
    copyButton.addEventListener("click", () => copyText(record.command, "已复制 CS2 控制台命令。"));
    entry.append(copyButton);
    elements.historyList.append(entry);
  });
}

function createHistoryMetric(label, value) {
  const metric = document.createElement("div");
  metric.className = "history-metric";
  const metricLabel = document.createElement("span");
  metricLabel.textContent = label;
  const metricValue = document.createElement("b");
  metricValue.textContent = value;
  metric.append(metricLabel, metricValue);
  return metric;
}

function renderRecovery() {
  const active = getActiveTransactions(state.transactions);
  elements.recoveryList.replaceChildren();
  if (!active.length) {
    elements.recoveryStatus.classList.remove("has-active-transaction");
    return;
  }

  elements.recoveryStatus.classList.add("has-active-transaction");
  active.forEach((transaction) => {
    const item = document.createElement("article");
    item.className = "snapshot-row";
    const stateText = document.createElement("div");
    stateText.className = "snapshot-state";
    stateText.textContent = transaction.status.toUpperCase();
    const title = document.createElement("div");
    title.className = "snapshot-title";
    const strong = document.createElement("strong");
    strong.textContent = transaction.moduleId;
    const copy = document.createElement("span");
    copy.textContent = "已由 Windows Broker 记录，必须在 Windows 端恢复。";
    title.append(strong, copy);
    item.append(stateText, title);
    elements.recoveryList.append(item);
  });
}

function hydratePreferences() {
  elements.updatesToggle.checked = Boolean(state.preferences.checkForUpdates);
  elements.motionToggle.checked = Boolean(state.preferences.reducedMotion);
  applyMotionPreference();
}

function applyMotionPreference() {
  elements.appShell.classList.toggle("reduced-motion", Boolean(state.preferences.reducedMotion));
}

function exportDiagnosticSummary() {
  const overview = getOverviewState(state);
  const text = [
    "OPT / LAB local diagnostic summary",
    `Generated: ${new Date().toISOString()}`,
    `Calibration history: ${overview.calibrationCount}`,
    `Active transactions: ${overview.activeOptimizationCount}`,
    "No mouse path, game configuration, account, or network data is included."
  ].join("\n");

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "opt-lab-diagnostic-summary.txt";
  link.click();
  URL.revokeObjectURL(url);
  showToast("已导出本机诊断说明。它不包含游戏或鼠标原始数据。");
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(successMessage);
}

function announceHostReady() {
  postToHost("shell.ready", {
    protocolVersion: 1,
    mode: window.chrome?.webview ? "webview2" : "preview",
    moduleCount: 1
  });
}

function postToHost(type, payload) {
  try {
    window.chrome?.webview?.postMessage({
      protocolVersion: 1,
      requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      type,
      moduleId: state.activeModuleId ?? "shell",
      payload
    });
  } catch {
    // Browser preview intentionally has no native host.
  }
}

function persist() {
  saveState(state);
}

function formatCount(value) {
  return String(value).padStart(2, "0");
}

function showToast(message) {
  window.clearTimeout(toastTimeout);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimeout = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3300);
}
