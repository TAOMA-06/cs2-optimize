export const APP_STORAGE_KEY = "opt-lab.shell.v1";
export const MAX_HISTORY_ITEMS = 20;

export function createInitialState() {
  return {
    schemaVersion: 1,
    activeView: "overview",
    activeModuleId: null,
    calibrationHistory: [],
    transactions: [],
    preferences: {
      checkForUpdates: true,
      reducedMotion: false
    }
  };
}

export function normalizeState(candidate) {
  const initial = createInitialState();
  if (!candidate || candidate.schemaVersion !== initial.schemaVersion) {
    return initial;
  }

  return {
    ...initial,
    ...candidate,
    calibrationHistory: Array.isArray(candidate.calibrationHistory)
      ? candidate.calibrationHistory.filter(isCalibrationRecord).slice(0, MAX_HISTORY_ITEMS)
      : [],
    transactions: Array.isArray(candidate.transactions)
      ? candidate.transactions.filter(isTransactionRecord)
      : [],
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

