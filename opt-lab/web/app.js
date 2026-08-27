import {
  createCalibrationRecord,
  formatDateTime,
  getActiveTransactions,
  getOptimizationProgress,
  getOverviewState,
  getWorkspaceJourney,
  isOptimizationProfileReviewed,
  loadState,
  normalizeHostContext,
  reviewOptimizationProfile,
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
  diagnostics: { kicker: "DESKTOP HOST / READ-ONLY", title: "本机诊断" },
  recovery: { kicker: "TRANSACTION / RECOVERY", title: "恢复中心" },
  history: { kicker: "LOCAL / ACTIVITY LOG", title: "运行记录" },
  settings: { kicker: "LOCAL / CONTROL PLANE", title: "设置" }
};

const state = loadState();
const elements = {
  appShell: document.getElementById("appShell"),
  machineChip: document.getElementById("machineChip"),
  machineMode: document.getElementById("machineMode"),
  machineDetail: document.getElementById("machineDetail"),
  workspaceHead: document.getElementById("workspaceHead"),
  headKicker: document.getElementById("headKicker"),
  headTitle: document.getElementById("headTitle"),
  activeChangeMetric: document.getElementById("activeChangeMetric"),
  readinessMetric: document.getElementById("readinessMetric"),
  readinessNavCount: document.getElementById("readinessNavCount"),
  recoveryMetric: document.getElementById("recoveryMetric"),
  recoveryNavCount: document.getElementById("recoveryNavCount"),
  quickProgressReadout: document.getElementById("quickProgressReadout"),
  hostModeLabel: document.getElementById("hostModeLabel"),
  hostRuntimeLabel: document.getElementById("hostRuntimeLabel"),
  hostSettingsLabel: document.getElementById("hostSettingsLabel"),
  hostMutationLabel: document.getElementById("hostMutationLabel"),
  journeyList: document.getElementById("journeyList"),
  journeySummary: document.getElementById("journeySummary"),
  osSelect: document.getElementById("osSelect"),
  gpuSelect: document.getElementById("gpuSelect"),
  platformSelect: document.getElementById("platformSelect"),
  profileConfirmation: document.getElementById("profileConfirmation"),
  profileReviewText: document.getElementById("profileReviewText"),
  confirmProfileButton: document.getElementById("confirmProfileButton"),
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
  moduleFrameStatus: document.getElementById("moduleFrameStatus"),
  retryModuleButton: document.getElementById("retryModuleButton"),
  diagnosticModuleState: document.getElementById("diagnosticModuleState"),
  diagnosticHostBadge: document.getElementById("diagnosticHostBadge"),
  diagnosticHostTitle: document.getElementById("diagnosticHostTitle"),
  diagnosticHostCopy: document.getElementById("diagnosticHostCopy"),
  diagnosticOs: document.getElementById("diagnosticOs"),
  diagnosticArchitecture: document.getElementById("diagnosticArchitecture"),
  diagnosticVersion: document.getElementById("diagnosticVersion"),
  diagnosticRuntime: document.getElementById("diagnosticRuntime"),
  capabilitySettings: document.getElementById("capabilitySettings"),
  capabilitySources: document.getElementById("capabilitySources"),
  capabilityArchive: document.getElementById("capabilityArchive"),
  capabilityBroker: document.getElementById("capabilityBroker"),
  capabilityUpdates: document.getElementById("capabilityUpdates"),
  capabilityMutations: document.getElementById("capabilityMutations"),
  updatesToggle: document.getElementById("updatesToggle"),
  motionToggle: document.getElementById("motionToggle"),
  toast: document.getElementById("toast")
};

let toastTimeout;
let moduleFrameInitialized = false;
let observedResultSignature = null;
let moduleResultPoller;
let moduleLoadTimeout;
let hostHandshakeTimeout;
let hostContext = normalizeHostContext({ mode: window.chrome?.webview ? "connecting" : "preview" });
const pendingHostRequests = new Map();

hydratePreferences();
wireNavigation();
wireOptimizer();
wireSettings();
wireModuleFrame();
wireHostBridge();
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

  elements.confirmProfileButton.addEventListener("click", () => {
    state.workspace = reviewOptimizationProfile(state.workspace, state.optimizationProfile);
    persist();
    render();
    showToast("已确认当前电脑与游戏平台信息。");
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

  document.querySelectorAll("[data-export-diagnostics]").forEach((button) => {
    button.addEventListener("click", exportDiagnosticSummary);
  });
}

function wireModuleFrame() {
  elements.moduleFrame.addEventListener("load", () => {
    window.clearTimeout(moduleLoadTimeout);
    elements.moduleFrame.classList.add("is-loaded");
    elements.moduleFrameLoading.classList.remove("is-error");
    elements.moduleFrameLoading.classList.add("is-hidden");
    elements.retryModuleButton.hidden = true;
    attachCalibrationObserver();
  });

  elements.moduleFrame.addEventListener("error", () => {
    showModuleFrameFailure("离线校准模块加载失败。原始网页仍可独立打开，请重试或返回方案库。");
  });

  elements.retryModuleButton.addEventListener("click", () => loadModuleFrame({ force: true }));
}

function loadModuleFrame({ force = false } = {}) {
  window.clearTimeout(moduleLoadTimeout);
  elements.moduleFrame.classList.remove("is-loaded");
  elements.moduleFrameLoading.classList.remove("is-hidden", "is-error");
  elements.moduleFrameStatus.textContent = "正在加载离线校准模块…";
  elements.retryModuleButton.hidden = true;
  const retrySuffix = force ? `?reload=${Date.now()}` : "";
  elements.moduleFrame.src = `./modules/cs2-sensitivity/index.html${retrySuffix}`;
  moduleFrameInitialized = true;
  moduleLoadTimeout = window.setTimeout(() => {
    showModuleFrameFailure("模块加载时间超过预期。可以重试；这不会清除灵敏度实验室自己的本机进度。");
  }, 7000);
}

function showModuleFrameFailure(message) {
  window.clearTimeout(moduleLoadTimeout);
  elements.moduleFrame.classList.remove("is-loaded");
  elements.moduleFrameLoading.classList.remove("is-hidden");
  elements.moduleFrameLoading.classList.add("is-error");
  elements.moduleFrameStatus.textContent = message;
  elements.retryModuleButton.hidden = false;
  showToast("校准模块未能正常装载，可在模块页重试。");
}

function wireHostBridge() {
  const webview = window.chrome?.webview;
  if (!webview) {
    return;
  }

  webview.addEventListener("message", (event) => {
    let message = event.data;
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch {
        return;
      }
    }
    if (!message || message.protocolVersion !== 1 || typeof message.type !== "string") {
      return;
    }

    if (message.type === "host.context") {
      window.clearTimeout(hostHandshakeTimeout);
      hostContext = normalizeHostContext(message.payload);
      render();
      return;
    }

    const pending = pendingHostRequests.get(message.requestId);
    if (!pending) return;
    pendingHostRequests.delete(message.requestId);
    window.clearTimeout(pending.timeout);
    if (message.type === "host.acknowledged") {
      showToast(pending.successMessage);
    } else if (message.type === "host.error") {
      showToast(pending.failureMessage);
    }
  });

  hostHandshakeTimeout = window.setTimeout(() => {
    if (hostContext.mode !== "desktop") {
      hostContext = normalizeHostContext({ mode: "unavailable" });
      render();
      showToast("桌面宿主没有响应，已切换为受限模式。");
    }
  }, 1800);
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
    loadModuleFrame();
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
  const journey = getWorkspaceJourney(state, quickRules);
  elements.activeChangeMetric.textContent = formatCount(overview.activeOptimizationCount);
  elements.readinessMetric.textContent = `${quickProgress.percent}%`;
  elements.readinessNavCount.textContent = `${quickProgress.percent}%`;
  elements.readinessNavCount.classList.toggle("is-empty", quickProgress.completed === 0);
  elements.recoveryMetric.textContent = overview.requiresRecovery ? "ACTION" : "CLEAR";
  elements.recoveryNavCount.textContent = formatCount(overview.activeOptimizationCount);
  elements.recoveryNavCount.classList.toggle("is-empty", overview.activeOptimizationCount === 0);

  renderQuickProgress(quickProgress);
  renderHostContext();
  renderJourney(journey);
  renderOptimizer();
  renderHistory();
  renderRecovery();
}

function renderHostContext() {
  const connected = hostContext.connected;
  const preview = hostContext.mode === "preview";
  const connecting = hostContext.mode === "connecting";
  elements.machineChip.classList.toggle("is-preview", preview);
  elements.machineChip.classList.toggle("is-unavailable", hostContext.mode === "unavailable");
  elements.machineMode.textContent = connected ? "WINDOWS DESKTOP" : connecting ? "CONNECTING" : preview ? "BROWSER PREVIEW" : "HOST UNAVAILABLE";
  elements.machineDetail.textContent = connected ? `HOST ${hostContext.hostVersion}` : preview ? "LOCAL WEB ONLY" : "LIMITED MODE";

  elements.hostModeLabel.textContent = connected ? "WINDOWS DESKTOP" : connecting ? "正在确认" : preview ? "浏览器预览" : "宿主不可用";
  elements.hostRuntimeLabel.textContent = hostContext.runtime;
  elements.hostSettingsLabel.textContent = hostContext.capabilities.openSettings ? "CONNECTED" : "COPY PATH ONLY";
  elements.hostMutationLabel.textContent = hostContext.capabilities.systemMutations ? "PUBLISHED" : "DISABLED";
  elements.hostModeLabel.className = connected ? "is-ready" : "is-limited";
  elements.hostSettingsLabel.className = hostContext.capabilities.openSettings ? "is-ready" : "is-limited";
  elements.hostMutationLabel.className = hostContext.capabilities.systemMutations ? "is-limited" : "is-ready";

  elements.diagnosticModuleState.classList.toggle("is-limited", !connected);
  elements.diagnosticModuleState.innerHTML = connected ? "<i></i> READY" : "<i></i> LIMITED";
  elements.diagnosticHostBadge.classList.toggle("is-connected", connected);
  elements.diagnosticHostBadge.classList.toggle("is-limited", !connected && !connecting);
  elements.diagnosticHostBadge.textContent = connected ? "DESKTOP CONNECTED" : connecting ? "CONNECTING" : preview ? "PREVIEW MODE" : "HOST UNAVAILABLE";
  elements.diagnosticHostTitle.textContent = connected ? "Windows 桌面宿主已连接" : preview ? "当前为浏览器受限预览" : connecting ? "正在等待桌面宿主" : "桌面宿主没有响应";
  elements.diagnosticHostCopy.textContent = connected
    ? "系统设置和官方资料请求由原生白名单处理；未发布的能力继续保持关闭。"
    : "可以预览工作流、保存本地进度并运行离线模块，但不能据此确认 WinUI、WebView2 或 Windows 设置跳转。";
  elements.diagnosticOs.textContent = hostContext.operatingSystem;
  elements.diagnosticArchitecture.textContent = hostContext.architecture;
  elements.diagnosticVersion.textContent = hostContext.hostVersion;
  elements.diagnosticRuntime.textContent = hostContext.runtime;

  elements.capabilitySettings.textContent = capabilityCopy(hostContext.capabilities.openSettings, "由原生白名单打开对应页面。", "仅复制可见操作路径。");
  elements.capabilitySources.textContent = capabilityCopy(hostContext.capabilities.openSources, "由原生白名单交给默认浏览器。", "仅复制官方资料链接。");
  elements.capabilityArchive.textContent = capabilityCopy(hostContext.capabilities.calibrationArchive, "校准结果同时写入本机归档。", "仅保存在当前浏览器资料中。");
  elements.capabilityBroker.textContent = capabilityCopy(hostContext.capabilities.brokerDiagnostics, "只读 Broker 诊断已接入。", "尚未接入桌面工作台。");
  elements.capabilityUpdates.textContent = capabilityCopy(hostContext.capabilities.signedUpdates, "已配置签名更新通道。", "尚未配置正式更新源。");
  elements.capabilityMutations.textContent = hostContext.capabilities.systemMutations
    ? "存在已发布写入动作；执行前必须显示快照与恢复方案。"
    : "默认拒绝，当前构建没有发布系统写入动作。";
}

function renderJourney(journey) {
  elements.journeyList.replaceChildren();
  const next = journey.find((step) => step.status === "attention") ?? journey.find((step) => step.status === "current");
  elements.journeySummary.textContent = next ? `下一步：${next.title}` : "本次开赛流程已形成完整本机记录。";

  journey.forEach((step, index) => {
    const card = document.createElement("article");
    card.className = `journey-step is-${step.status}`;
    const meta = document.createElement("div");
    meta.className = "journey-step-meta";
    const sequence = document.createElement("span");
    sequence.textContent = String(index + 1).padStart(2, "0");
    const status = document.createElement("b");
    status.textContent = journeyStatusLabel(step.status);
    meta.append(sequence, status);
    const title = document.createElement("h3");
    title.textContent = step.title;
    const summary = document.createElement("p");
    summary.textContent = step.summary;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "text-button";
    action.textContent = `${step.actionLabel} →`;
    if (step.action === "module") action.dataset.openModule = "cs2-sensitivity";
    else action.dataset.view = step.action;
    card.append(meta, title, summary, action);
    elements.journeyList.append(card);
  });
}

function journeyStatusLabel(status) {
  return ({ complete: "完成", current: "下一步", pending: "待处理", optional: "可选", attention: "需恢复" })[status] ?? status;
}

function capabilityCopy(available, availableCopy, unavailableCopy) {
  return available ? availableCopy : unavailableCopy;
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
  const profileReviewed = isOptimizationProfileReviewed(state.workspace, profile);
  elements.profileConfirmation.classList.toggle("is-reviewed", profileReviewed);
  elements.profileReviewText.textContent = profileReviewed ? "当前设备与平台信息已经确认" : "设备信息变更后，需要由你重新确认";
  elements.confirmProfileButton.textContent = profileReviewed ? "重新确认" : "确认这套环境";
  elements.confirmProfileButton.className = `button ${profileReviewed ? "button-secondary" : "button-primary"}`;
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

  if (rule.action.type === "settings" && hostContext.capabilities.openSettings) {
    postToHost("system.open-settings", { pageId: rule.action.pageId }, {
      successMessage: "Windows 已接受设置页请求；请按卡片逐项确认。",
      failureMessage: "Windows 未能打开设置页，请使用卡片中显示的操作路径。"
    });
    showToast("正在请求 Windows 打开对应设置页…");
    return;
  }

  copyText(rule.action.fallback, rule.action.type === "settings"
    ? "当前是浏览器预览，已复制 Windows 设置路径。"
    : "操作路径已复制。");
}

function openSource(sourceId) {
  const source = getSource(sourceId);
  if (!source) return;
  if (hostContext.capabilities.openSources) {
    postToHost("source.open", { sourceId }, {
      successMessage: "Windows 已将官方资料交给默认浏览器。",
      failureMessage: "Windows 未能打开官方资料，可复制卡片中的资料链接。"
    });
    showToast("正在请求默认浏览器打开官方资料…");
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
    `Host mode: ${hostContext.mode}`,
    `Host connected: ${hostContext.connected}`,
    `Host version: ${hostContext.hostVersion}`,
    `Host OS: ${hostContext.operatingSystem}`,
    `Host architecture: ${hostContext.architecture}`,
    `Windows settings bridge: ${hostContext.capabilities.openSettings}`,
    `Broker diagnostics: ${hostContext.capabilities.brokerDiagnostics}`,
    `System mutations published: ${hostContext.capabilities.systemMutations}`,
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
    moduleCount: 3
  });
}

function postToHost(type, payload, feedback = null) {
  const webview = window.chrome?.webview;
  if (!webview) return null;
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  if (feedback) {
    const timeout = window.setTimeout(() => {
      if (!pendingHostRequests.has(requestId)) return;
      pendingHostRequests.delete(requestId);
      showToast(feedback.failureMessage);
    }, 6000);
    pendingHostRequests.set(requestId, { ...feedback, timeout });
  }
  try {
    webview.postMessage({
      protocolVersion: 1,
      requestId,
      type,
      moduleId: state.activeModuleId ?? "shell",
      payload
    });
    return requestId;
  } catch {
    const pending = pendingHostRequests.get(requestId);
    if (pending) {
      window.clearTimeout(pending.timeout);
      pendingHostRequests.delete(requestId);
      showToast(feedback.failureMessage);
    }
    return null;
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
