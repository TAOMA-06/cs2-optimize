import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_STORAGE_KEY,
  APP_SCHEMA_VERSION,
  createCalibrationRecord,
  createInitialState,
  getActiveTransactions,
  getOptimizationProgress,
  getOverviewState,
  loadState,
  saveState,
  setOptimizationCheck,
  upsertCalibrationRecord
} from "../web/core.mjs";
import { getRecommendations, normalizeProfile } from "../web/optimization-catalog.mjs";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("state round-trips and preserves local-only preferences", () => {
  const storage = createStorage();
  const state = createInitialState();
  state.preferences.reducedMotion = true;
  saveState(state, storage);

  assert.equal(storage.getItem(APP_STORAGE_KEY) !== null, true);
  assert.equal(loadState(storage).preferences.reducedMotion, true);
  assert.equal(loadState(storage).schemaVersion, APP_SCHEMA_VERSION);
});

test("schema v1 state migrates without losing existing calibration history", () => {
  const storage = createStorage();
  storage.setItem(APP_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    activeView: "history",
    calibrationHistory: [{
      id: "legacy",
      moduleId: "cs2-sensitivity",
      command: "sensitivity 1.200",
      completedAt: "2026-08-11T12:00:00.000Z",
      sensitivity: 1.2
    }],
    transactions: [],
    preferences: { reducedMotion: true }
  }));

  const migrated = loadState(storage);
  assert.equal(migrated.schemaVersion, APP_SCHEMA_VERSION);
  assert.equal(migrated.calibrationHistory.length, 1);
  assert.equal(migrated.activeView, "history");
  assert.equal(migrated.optimizationProfile.platform, "perfect");
});

test("valid CS2 result becomes a normalized calibration record", () => {
  const record = createCalibrationRecord({
    sensitivity: 1.315,
    precisionSensitivity: 1.262,
    speedSensitivity: 1.368,
    effectiveDpi: 1052,
    centimetersPer360: 39.5,
    confidence: "high",
    command: "sensitivity 1.315"
  }, new Date("2026-08-11T12:00:00.000Z"));

  assert.equal(record.sensitivity, 1.315);
  assert.equal(record.confidence, "HIGH");
  assert.equal(record.command, "sensitivity 1.315");
});

test("invalid CS2 result is rejected before it reaches history", () => {
  assert.throws(
    () => createCalibrationRecord({ sensitivity: 9, command: "sensitivity 9.000" }),
    /格式无效/
  );
});

test("history prepends the latest unique record and overview stays truthful", () => {
  const first = createCalibrationRecord({ sensitivity: 1.2, command: "sensitivity 1.200" }, new Date("2026-08-11T12:00:00.000Z"));
  const second = createCalibrationRecord({ sensitivity: 1.3, command: "sensitivity 1.300" }, new Date("2026-08-11T12:10:00.000Z"));
  const state = createInitialState();
  state.calibrationHistory = upsertCalibrationRecord(upsertCalibrationRecord([], first), second);

  const overview = getOverviewState(state);
  assert.equal(overview.calibrationCount, 2);
  assert.equal(overview.latestCalibration.command, "sensitivity 1.300");
  assert.equal(overview.activeOptimizationCount, 0);
});

test("only recoverable transaction states count as active", () => {
  const transactions = [
    { id: "1", moduleId: "test", status: "verified" },
    { id: "2", moduleId: "test", status: "restored" },
    { id: "3", moduleId: "test", status: "restore-required" }
  ];

  assert.deepEqual(getActiveTransactions(transactions).map((item) => item.id), ["1", "3"]);
});

test("quick readiness plan adapts to NVIDIA and Perfect World", () => {
  const profile = normalizeProfile({ os: "windows11", gpuVendor: "nvidia", platform: "perfect", planMode: "quick" });
  const ids = getRecommendations(profile, "quick").map((item) => item.id);

  assert.equal(ids.includes("nvidia-reflex"), true);
  assert.equal(ids.includes("perfectworld-assistant"), true);
  assert.equal(ids.includes("amd-antilag2"), false);
  assert.equal(ids.includes("steam-verify-files"), false);
});

test("readiness progress only counts rules in the active plan", () => {
  const rules = getRecommendations({ os: "windows11", gpuVendor: "amd", platform: "fivee" }, "quick");
  let checks = setOptimizationCheck({}, rules[0].id, true);
  checks = setOptimizationCheck(checks, "unrelated-rule", true);
  const progress = getOptimizationProgress(checks, rules);

  assert.equal(progress.completed, 1);
  assert.equal(progress.total, rules.length);
  assert.equal(progress.percent, Math.round(100 / rules.length));
});
