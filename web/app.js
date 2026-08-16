import {
  createCalibrationRecord,
  formatDateTime,
  getActiveTransactions,
  getOptimizationProgress,
  getOverviewState,
  loadState,
  saveState,
  setOptimizationCheck,
  upsertCalibrationRecord
} from "./core.mjs";
import {
  getRecommendations,
  getSource,
  REJECTED_TWEAKS
} from "./optimization-catalog.mjs";

const VIEW_META = {
  overview: { kicker: "WORKSTATION / OVERVIEW", title: "本机状态" },
  optimizer: { kicker: "MATCH / READINESS PLAN", title: "开赛准备" },
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
  readinessMetric: document.getElementById("readinessMetric"),
  readinessNavCount: document.getElementById("readinessNavCount"),
  recoveryMetric: document.getElementById("recoveryMetric"),
  recoveryNavCount: document.getElementById("recoveryNavCount"),
  quickProgressReadout: document.getElementById("quickProgressReadout"),
  osSelect: document.getElementById("osSelect"),
  gpuSelect: document.getElementById("gpuSelect"),
  platformSelect: document.getElementById("platformSelect"),
  recommendationList: document.getElementById("recommendationList"),
  planProgressLabel: document.getElementById("planProgressLabel"),
  planProgressTitle: document.getElementById("planProgressTitle"),
  planProgressBar: document.getElementById("planProgressBar"),
  rejectedTweaksList: document.getElementById("rejectedTweaksList"),
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
let moduleResultPoller;

hydratePreferences();
wireNavigation();
wireOptimizer();
wireSettings();
wireModuleFrame();
render();
if (state.activeView === "module" && state.activeModuleId === "cs2-sensitivity") {
  openModule("cs2-sensitivity");
} else {
  selectView(state.activeView in VIEW_META ? state.activeView : "overview", { persist: false });
}

function wireOptimizer() {
  const profileInputs = [elements.osSelect, elements.gpuSelect, elements.platformSelect];
  profileInputs.forEach((input) => {
    input.addEventListener("change", () => {
      state.optimizationProfile = {
        ...state.optimizationProfile,
        os: elements.osSelect.value,
        gpuVendor: elements.gpuSelect.value,
        platform: elements.platformSelect.value
      };
      persist();
      render();
      showToast("已按新的设备与平台信息重排方案。");
    });
  });

  document.querySelectorAll("[data-plan-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.optimizationProfile.planMode = button.dataset.planMode;
      persist();
      render();
    });
  });

  elements.recommendationList.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-rule-action]");
    if (actionButton) {
      runRecommendationAction(actionButton.dataset.ruleAction);
      return;
    }

    const completionButton = event.target.closest("[data-rule-complete]");
    if (completionButton) {
      const ruleId = completionButton.dataset.ruleComplete;
      const completed = !Boolean(state.optimizationChecks[ruleId]);
      state.optimizationChecks = setOptimizationCheck(state.optimizationChecks, ruleId, completed);
      persist();
      render();
      showToast(completed ? "已记录为确认完成。" : "已撤销这项本机确认记录。");
      return;
    }

    const sourceButton = event.target.closest("[data-source-id]");
    if (sourceButton) {
      openSource(sourceButton.dataset.sourceId);
    }
  });
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
  window.clearInterval(moduleResultPoller);

  try {
    const moduleDocument = elements.moduleFrame.contentDocument;
    if (!moduleDocument?.body) {
      return;
    }

    const collectIfReady = () => window.setTimeout(collectCalibrationResult, 0);
    moduleDocument.addEventListener("click", collectIfReady, true);
    moduleResultPoller = window.setInterval(collectCalibrationResult, 750);
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
  const quickRules = getRecommendations(state.optimizationProfile, "quick");
  const quickProgress = getOptimizationProgress(state.optimizationChecks, quickRules);
  elements.activeChangeMetric.textContent = formatCount(overview.activeOptimizationCount);
  elements.readinessMetric.textContent = `${quickProgress.percent}%`;
  elements.readinessNavCount.textContent = `${quickProgress.percent}%`;
  elements.readinessNavCount.classList.toggle("is-empty", quickProgress.completed === 0);
  elements.recoveryMetric.textContent = overview.requiresRecovery ? "ACTION" : "CLEAR";
  elements.recoveryNavCount.textContent = formatCount(overview.activeOptimizationCount);
  elements.recoveryNavCount.classList.toggle("is-empty", overview.activeOptimizationCount === 0);

  renderQuickProgress(quickProgress);
  renderOptimizer();
  renderHistory();
  renderRecovery();
}

function renderQuickProgress(progress) {
  elements.quickProgressReadout.replaceChildren();
  const label = document.createElement("span");
  label.textContent = "QUICK PLAN";
  const value = document.createElement("strong");
  const note = document.createElement("small");
  value.textContent = progress.total ? `${progress.completed} / ${progress.total} 已确认` : "尚未生成";
  note.textContent = progress.percent === 100 ? "快速检查已完成；进入方案页可随时重新核对。" : "完成状态仅保存在本机，由你逐项确认。";
  elements.quickProgressReadout.append(label, value, note);
}

function renderOptimizer() {
  const profile = state.optimizationProfile;
  elements.osSelect.value = profile.os;
  elements.gpuSelect.value = profile.gpuVendor;
  elements.platformSelect.value = profile.platform;
  document.querySelectorAll("[data-plan-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.planMode === profile.planMode);
  });

  const recommendations = getRecommendations(profile, profile.planMode);
  const progress = getOptimizationProgress(state.optimizationChecks, recommendations);
  elements.planProgressLabel.textContent = `${progress.completed} / ${progress.total} 已确认`;
  elements.planProgressTitle.textContent = progress.percent === 100
    ? "当前方案已逐项确认"
    : profile.planMode === "quick" ? "约三分钟完成核心检查" : "完整检查包含条件项与故障修复";
  elements.planProgressBar.style.width = `${progress.percent}%`;

  elements.recommendationList.replaceChildren();
  recommendations.forEach((rule, index) => {
    elements.recommendationList.append(createRecommendationCard(rule, index, Boolean(state.optimizationChecks[rule.id])));
  });

  elements.rejectedTweaksList.replaceChildren();
  REJECTED_TWEAKS.forEach((copy) => {
    const item = document.createElement("li");
    item.textContent = copy;
    elements.rejectedTweaksList.append(item);
  });
}

function createRecommendationCard(rule, index, completed) {
  const card = document.createElement("article");
  card.className = `recommendation-card level-${rule.level}${completed ? " is-complete" : ""}`;
  card.dataset.ruleId = rule.id;

  const sequence = document.createElement("span");
  sequence.className = "recommendation-sequence";
  sequence.textContent = String(index + 1).padStart(2, "0");

  const content = document.createElement("div");
  content.className = "recommendation-content";
  const meta = document.createElement("div");
  meta.className = "recommendation-meta";
  const group = document.createElement("span");
  group.textContent = groupLabel(rule.group);
  const level = document.createElement("b");
  level.textContent = levelLabel(rule.level);
  meta.append(group, level);

  const title = document.createElement("h3");
  title.textContent = rule.title;
  const summary = document.createElement("p");
  summary.className = "recommendation-summary";
  summary.textContent = rule.summary;

  const steps = document.createElement("ol");
  steps.className = "recommendation-steps";
  rule.steps.forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    steps.append(item);
  });

  const detail = document.createElement("details");
  detail.className = "recommendation-detail";
  const detailSummary = document.createElement("summary");
  detailSummary.textContent = "为什么做，以及如何验证";
  const why = document.createElement("p");
  why.textContent = rule.why;
  const verify = document.createElement("p");
  const verifyLabel = document.createElement("strong");
  verifyLabel.textContent = "验证：";
  verify.append(verifyLabel, rule.verify);
  const path = document.createElement("p");
  path.className = "recommendation-path";
  const pathLabel = document.createElement("strong");
  pathLabel.textContent = "操作路径：";
  path.append(pathLabel, rule.action.fallback);
  const sources = document.createElement("div");
  sources.className = "source-list";
  rule.sources.forEach((sourceId) => {
    const source = getSource(sourceId);
    if (!source) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sourceId = sourceId;
    button.textContent = `${source.publisher} ↗`;
    button.title = source.title;
    sources.append(button);
  });
  detail.append(detailSummary, why, verify, path, sources);

  const actions = document.createElement("div");
  actions.className = "recommendation-actions";
  const action = document.createElement("button");
  action.className = "button button-secondary";
  action.type = "button";
  action.dataset.ruleAction = rule.id;
  action.textContent = rule.action.label;
  action.disabled = rule.action.type === "none";
  const complete = document.createElement("button");
  complete.className = `button ${completed ? "button-confirmed" : "button-primary"}`;
  complete.type = "button";
  complete.dataset.ruleComplete = rule.id;
  complete.textContent = completed ? "已确认 ✓" : "我已检查";
  actions.append(action, complete);

  content.append(meta, title, summary, steps, detail, actions);
  card.append(sequence, content);
  return card;
}

function runRecommendationAction(ruleId) {
  const rule = getRecommendations(state.optimizationProfile, "full").find((item) => item.id === ruleId);
  if (!rule || rule.action.type === "none") return;

  if (rule.action.type === "settings" && window.chrome?.webview) {
    postToHost("system.open-settings", { pageId: rule.action.pageId });
    showToast("已请求 Windows 打开对应设置页；请按卡片逐项确认。");
    return;
  }

  copyText(rule.action.fallback, rule.action.type === "settings"
    ? "当前是浏览器预览，已复制 Windows 设置路径。"
    : "操作路径已复制。");
}

function openSource(sourceId) {
  const source = getSource(sourceId);
  if (!source) return;
  if (window.chrome?.webview) {
    postToHost("source.open", { sourceId });
    showToast("已在默认浏览器打开官方资料。");
    return;
  }
  copyText(source.url, "官方资料链接已复制。");
}

function groupLabel(group) {
  return ({ windows: "WINDOWS", session: "SESSION", gpu: "GPU", cs2: "CS2", platform: "PLATFORM", repair: "REPAIR" })[group] ?? group.toUpperCase();
}

function levelLabel(level) {
  return ({ essential: "核心", recommended: "建议", troubleshoot: "故障时" })[level] ?? level;
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
  const recommendations = getRecommendations(state.optimizationProfile, state.optimizationProfile.planMode);
  const readiness = getOptimizationProgress(state.optimizationChecks, recommendations);
  const text = [
    "OPT / LAB local diagnostic summary",
    `Generated: ${new Date().toISOString()}`,
    `Calibration history: ${overview.calibrationCount}`,
    `Active transactions: ${overview.activeOptimizationCount}`,
    `Readiness profile: ${state.optimizationProfile.os} / ${state.optimizationProfile.gpuVendor} / ${state.optimizationProfile.platform}`,
    `Readiness confirmations: ${readiness.completed}/${readiness.total}`,
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
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
  }
  showToast(copied ? successMessage : "复制失败，请按卡片中显示的操作路径完成。" );
  return copied;
}

function announceHostReady() {
  postToHost("shell.ready", {
    protocolVersion: 1,
    mode: window.chrome?.webview ? "webview2" : "preview",
    moduleCount: 2
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
