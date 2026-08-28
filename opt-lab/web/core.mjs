export const APP_STORAGE_KEY = "opt-lab.shell.v1";
export const MAX_HISTORY_ITEMS = 20;
export const APP_SCHEMA_VERSION = 3;
export const WORKBENCH_VIEWS = ["overview", "diagnostics", "recovery", "settings"];

export function normalizeView(view) {
  return WORKBENCH_VIEWS.includes(view) ? view : "overview";
}

export function createInitialState() {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    activeView: "overview",
    activeModuleId: null,
    calibrationHistory: [],
    transactions: [],
    optimizationProfile: {
      os: "windows11",
      gpuVendor: "unknown",
      platform: "perfect",
      planMode: "quick"
    },
    optimizationChecks: {},
    workspace: {
      reviewedProfileKey: null
    },
    preferences: {
      checkForUpdates: true,
      reducedMotion: false
    }
  };
}

export function normalizeState(candidate) {
  const initial = createInitialState();
  if (!candidate || ![1, 2, APP_SCHEMA_VERSION].includes(candidate.schemaVersion)) {
    return initial;
  }

  return {
    ...initial,
    ...candidate,
    schemaVersion: APP_SCHEMA_VERSION,
    activeView: normalizeView(candidate.activeView),
    calibrationHistory: Array.isArray(candidate.calibrationHistory)
      ? candidate.calibrationHistory.filter(isCalibrationRecord).slice(0, MAX_HISTORY_ITEMS)
      : [],
    transactions: Array.isArray(candidate.transactions)
      ? candidate.transactions.filter(isTransactionRecord)
      : [],
    optimizationProfile: normalizeOptimizationProfile(candidate.optimizationProfile),
    optimizationChecks: normalizeOptimizationChecks(candidate.optimizationChecks),
    workspace: normalizeWorkspace(candidate.workspace),
    preferences: {
      ...initial.preferences,
      ...(candidate.preferences ?? {})
    }
  };
}

export function loadState(storage = globalThis.localStorage) {
  try {
    return normalizeState(JSON.parse(storage.getItem(APP_STORAGE_KEY) ?? "null"));
  } catch {
    return createInitialState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(APP_STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function isCalibrationRecord(value) {
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.moduleId === "string" &&
      typeof value.command === "string" &&
      typeof value.completedAt === "string" &&
      Number.isFinite(Number(value.sensitivity))
  );
}

export function isTransactionRecord(value) {
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.status === "string" &&
      typeof value.moduleId === "string"
  );
}

export function createCalibrationRecord(payload, now = new Date()) {
  const command = String(payload.command ?? "").trim();
  const sensitivity = Number(payload.sensitivity);
  if (!Number.isFinite(sensitivity) || sensitivity < 0.1 || sensitivity > 8 || !/^sensitivity\s+\d+(\.\d{1,3})?$/.test(command)) {
    throw new Error("校准结果格式无效，未写入本机历史。");
  }

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `cal-${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    moduleId: "cs2-sensitivity",
    completedAt: now.toISOString(),
    sensitivity: Number(sensitivity.toFixed(3)),
    precisionSensitivity: numberOrNull(payload.precisionSensitivity),
    speedSensitivity: numberOrNull(payload.speedSensitivity),
    effectiveDpi: integerOrNull(payload.effectiveDpi),
    centimetersPer360: numberOrNull(payload.centimetersPer360),
    confidence: String(payload.confidence ?? "MED").toUpperCase(),
    command
  };
}

export function upsertCalibrationRecord(history, record) {
  const withoutEquivalent = history.filter((item) => item.command !== record.command || item.completedAt !== record.completedAt);
  return [record, ...withoutEquivalent].slice(0, MAX_HISTORY_ITEMS);
}

export function getActiveTransactions(transactions) {
  return transactions.filter((transaction) => ["snapshotted", "applying", "verified", "restore-required"].includes(transaction.status));
}

export function getOverviewState(state) {
  const activeTransactions = getActiveTransactions(state.transactions);
  return {
    activeOptimizationCount: activeTransactions.length,
    calibrationCount: state.calibrationHistory.length,
    latestCalibration: state.calibrationHistory[0] ?? null,
    requiresRecovery: activeTransactions.some((transaction) => transaction.status === "restore-required")
  };
}

export function normalizeOptimizationProfile(candidate) {
  return {
    os: ["windows11", "windows10"].includes(candidate?.os) ? candidate.os : "windows11",
    gpuVendor: ["nvidia", "amd", "other", "unknown"].includes(candidate?.gpuVendor) ? candidate.gpuVendor : "unknown",
    platform: ["perfect", "fivee", "steam"].includes(candidate?.platform) ? candidate.platform : "perfect",
    planMode: ["quick", "full"].includes(candidate?.planMode) ? candidate.planMode : "quick"
  };
}

export function normalizeOptimizationChecks(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([id, completed]) => /^[a-z0-9-]+$/.test(id) && completed === true)
      .slice(0, 100)
  );
}

export function normalizeWorkspace(candidate) {
  return {
    reviewedProfileKey: typeof candidate?.reviewedProfileKey === "string" && candidate.reviewedProfileKey.length <= 80
      ? candidate.reviewedProfileKey
      : null
  };
}

export function getOptimizationProfileKey(candidate) {
  const profile = normalizeOptimizationProfile(candidate);
  return [profile.os, profile.gpuVendor, profile.platform].join(":");
}

export function isOptimizationProfileReviewed(workspace, profile) {
  return normalizeWorkspace(workspace).reviewedProfileKey === getOptimizationProfileKey(profile);
}

export function reviewOptimizationProfile(workspace, profile) {
  return {
    ...normalizeWorkspace(workspace),
    reviewedProfileKey: getOptimizationProfileKey(profile)
  };
}

export function setOptimizationCheck(checks, ruleId, completed) {
  if (!/^[a-z0-9-]+$/.test(ruleId)) {
    throw new Error("优化检查项 ID 无效。");
  }

  const next = normalizeOptimizationChecks(checks);
  if (completed) {
    next[ruleId] = true;
  } else {
    delete next[ruleId];
  }
  return next;
}

export function getOptimizationProgress(checks, recommendations) {
  const safeChecks = normalizeOptimizationChecks(checks);
  const ids = recommendations.map((rule) => rule.id);
  const completed = ids.filter((id) => safeChecks[id]).length;
  const total = ids.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    nextRuleId: ids.find((id) => !safeChecks[id]) ?? null
  };
}

export function getWorkspaceJourney(state, quickRecommendations) {
  const profileReviewed = isOptimizationProfileReviewed(state.workspace, state.optimizationProfile);
  const readiness = getOptimizationProgress(state.optimizationChecks, quickRecommendations);
  const overview = getOverviewState(state);
  const readinessComplete = readiness.total > 0 && readiness.completed === readiness.total;
  const hasCalibration = overview.calibrationCount > 0;

  return [
    {
      id: "profile",
      title: "确认电脑与平台",
      summary: profileReviewed ? "当前环境已经由你确认。" : "核对 Windows、显卡和主要游戏平台。",
      status: profileReviewed ? "complete" : "current",
      action: "optimizer",
      actionLabel: profileReviewed ? "重新核对" : "去确认"
    },
    {
      id: "readiness",
      title: "完成三分钟检查",
      summary: `${readiness.completed} / ${readiness.total} 项已确认`,
      status: readinessComplete ? "complete" : profileReviewed ? "current" : "pending",
      action: "optimizer",
      actionLabel: readinessComplete ? "复查" : "继续检查"
    },
    {
      id: "sensitivity",
      title: "保留灵敏度基线",
      summary: hasCalibration ? overview.latestCalibration.command : "可选；完成后会保存可复制命令。",
      status: hasCalibration ? "complete" : readinessComplete ? "current" : "optional",
      action: hasCalibration ? "history" : "module",
      actionLabel: hasCalibration ? "查看记录" : "打开实验室"
    },
    {
      id: "recovery",
      title: "确认恢复状态",
      summary: overview.requiresRecovery ? "存在必须处理的恢复事务。" : "当前没有待恢复的系统变更。",
      status: overview.requiresRecovery ? "attention" : "complete",
      action: "recovery",
      actionLabel: overview.requiresRecovery ? "立即处理" : "查看账本"
    }
  ];
}

export function normalizeHostContext(candidate) {
  const mode = ["preview", "connecting", "desktop", "unavailable"].includes(candidate?.mode)
    ? candidate.mode
    : "preview";
  const capabilities = candidate?.capabilities && typeof candidate.capabilities === "object"
    ? candidate.capabilities
    : {};
  const connected = mode === "desktop" && candidate?.connected === true;

  return {
    mode,
    connected,
    hostVersion: safeHostText(candidate?.hostVersion, "—"),
    platform: safeHostText(candidate?.platform, mode === "preview" ? "Browser preview" : "Windows"),
    operatingSystem: safeHostText(candidate?.operatingSystem, "未由桌面宿主提供"),
    architecture: safeHostText(candidate?.architecture, "—"),
    runtime: safeHostText(candidate?.runtime, mode === "preview" ? "Web preview" : "—"),
    dataBoundary: candidate?.dataBoundary === "local-only" ? "local-only" : "local-only",
    capabilities: {
      nativeShell: connected && capabilities.nativeShell === true,
      openSettings: connected && capabilities.openSettings === true,
      openSources: connected && capabilities.openSources === true,
      calibrationArchive: connected && capabilities.calibrationArchive === true,
      brokerDiagnostics: connected && capabilities.brokerDiagnostics === true,
      signedUpdates: connected && capabilities.signedUpdates === true,
      systemMutations: connected && capabilities.systemMutations === true
    }
  };
}

export function formatDateTime(isoDate, locale = "zh-CN") {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function safeHostText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized && normalized.length <= 160 ? normalized : fallback;
}
