import {
  getActiveTransactions,
  getOverviewState,
  loadState,
  normalizeHostContext,
  normalizeView,
  saveState
} from "./core.mjs";

const VIEW_META = {
  overview: { kicker: "本机状态", title: "总览" },
  diagnostics: { kicker: "只读诊断", title: "本机诊断" },
  recovery: { kicker: "恢复台账", title: "恢复中心" },
  settings: { kicker: "本机偏好", title: "设置" }
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
  recoveryMetric: document.getElementById("recoveryMetric"),
  recoveryNavCount: document.getElementById("recoveryNavCount"),
  overviewMutationMetric: document.getElementById("overviewMutationMetric"),
  hostModeLabel: document.getElementById("hostModeLabel"),
  hostRuntimeLabel: document.getElementById("hostRuntimeLabel"),
  hostSettingsLabel: document.getElementById("hostSettingsLabel"),
  hostMutationLabel: document.getElementById("hostMutationLabel"),
  recoveryList: document.getElementById("recoveryList"),
  recoveryStatus: document.getElementById("recoveryStatus"),
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
let hostHandshakeTimeout;
let hostContext = normalizeHostContext({ mode: window.chrome?.webview ? "connecting" : "preview" });
const pendingHostRequests = new Map();

hydratePreferences();
wireNavigation();
wireSettings();
wireHostBridge();
render();
selectView(normalizeView(state.activeView), { persist: false });
announceHostReady();

function wireNavigation() {
  document.addEventListener("click", (event) => {
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
  const nextView = normalizeView(view);
  state.activeView = nextView;
  const metadata = VIEW_META[nextView];
  elements.headKicker.textContent = metadata.kicker;
  elements.headTitle.textContent = metadata.title;

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === nextView);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === nextView);
  });

  if (shouldPersist) {
    persist();
  }

  window.scrollTo({ top: 0, behavior: state.preferences.reducedMotion ? "auto" : "smooth" });
}

function render() {
  const overview = getOverviewState(state);
  elements.activeChangeMetric.textContent = formatCount(overview.activeOptimizationCount);
  elements.recoveryMetric.textContent = overview.requiresRecovery ? "需处理" : "无";
  elements.recoveryNavCount.textContent = formatCount(overview.activeOptimizationCount);
  elements.recoveryNavCount.classList.toggle("is-empty", overview.activeOptimizationCount === 0);
  elements.overviewMutationMetric.textContent = hostContext.capabilities.systemMutations ? "已发布" : "关闭";

  renderHostContext();
  renderRecovery();
}

function renderHostContext() {
  const connected = hostContext.connected;
  const preview = hostContext.mode === "preview";
  const connecting = hostContext.mode === "connecting";
  elements.machineChip.classList.toggle("is-preview", preview);
  elements.machineChip.classList.toggle("is-unavailable", hostContext.mode === "unavailable");
  elements.machineMode.textContent = connected ? "本机已连接" : connecting ? "正在连接" : preview ? "浏览器预览" : "宿主不可用";
  elements.machineDetail.textContent = connected ? `宿主 ${hostContext.hostVersion}` : preview ? "仅本地网页" : "受限模式";

  elements.hostModeLabel.textContent = connected ? "本机已连接" : connecting ? "正在确认" : preview ? "浏览器预览" : "宿主不可用";
  elements.hostRuntimeLabel.textContent = preview || hostContext.runtime === "Web preview" ? "浏览器预览" : hostContext.runtime;
  elements.hostSettingsLabel.textContent = hostContext.capabilities.openSettings ? "已连接" : "仅复制路径";
  elements.hostMutationLabel.textContent = hostContext.capabilities.systemMutations ? "已发布" : "关闭";
  elements.hostModeLabel.className = connected ? "is-ready" : "is-limited";
  elements.hostSettingsLabel.className = hostContext.capabilities.openSettings ? "is-ready" : "is-limited";
  elements.hostMutationLabel.className = hostContext.capabilities.systemMutations ? "is-limited" : "is-ready";

  elements.diagnosticHostBadge.classList.toggle("is-connected", connected);
  elements.diagnosticHostBadge.classList.toggle("is-limited", !connected && !connecting);
  elements.diagnosticHostBadge.textContent = connected ? "桌面已连接" : connecting ? "正在连接" : preview ? "预览模式" : "宿主不可用";
  elements.diagnosticHostTitle.textContent = connected ? "Windows 桌面宿主已连接" : preview ? "当前为浏览器受限预览" : connecting ? "正在等待桌面宿主" : "桌面宿主没有响应";
  elements.diagnosticHostCopy.textContent = connected
    ? "系统设置和官方资料请求由原生白名单处理；未发布的能力继续保持关闭。"
    : "可以查看本机诊断与恢复状态，但不能据此确认 WinUI、WebView2 或 Windows 设置跳转。";
  elements.diagnosticOs.textContent = hostContext.operatingSystem;
  elements.diagnosticArchitecture.textContent = hostContext.architecture;
  elements.diagnosticVersion.textContent = hostContext.hostVersion;
  elements.diagnosticRuntime.textContent = preview || hostContext.runtime === "Web preview" ? "浏览器预览" : hostContext.runtime;

  elements.capabilitySettings.textContent = capabilityCopy(hostContext.capabilities.openSettings, "由原生白名单打开对应页面。", "仅复制可见操作路径。");
  elements.capabilitySources.textContent = capabilityCopy(hostContext.capabilities.openSources, "由原生白名单交给默认浏览器。", "仅复制官方资料链接。");
  elements.capabilityArchive.textContent = capabilityCopy(hostContext.capabilities.calibrationArchive, "校准结果同时写入本机归档。", "仅保存在当前浏览器资料中。");
  elements.capabilityBroker.textContent = capabilityCopy(hostContext.capabilities.brokerDiagnostics, "只读 Broker 诊断已接入。", "尚未接入桌面工作台。");
  elements.capabilityUpdates.textContent = capabilityCopy(hostContext.capabilities.signedUpdates, "已配置签名更新通道。", "尚未配置正式更新源。");
  elements.capabilityMutations.textContent = hostContext.capabilities.systemMutations
    ? "存在已发布写入动作；执行前必须显示快照与恢复方案。"
    : "默认拒绝，当前构建没有发布系统写入动作。";
}

function capabilityCopy(enabled, readyText, limitedText) {
  return enabled ? readyText : limitedText;
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
    `Active transactions: ${overview.activeOptimizationCount}`,
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

function announceHostReady() {
  postToHost("shell.ready", {
    protocolVersion: 1,
    mode: window.chrome?.webview ? "webview2" : "preview",
    views: Object.keys(VIEW_META)
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
      moduleId: "shell",
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
