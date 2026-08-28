import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_STORAGE_KEY,
  APP_SCHEMA_VERSION,
  createCalibrationRecord,
  createInitialState,
  getActiveTransactions,
  getOptimizationProgress,
  getWorkspaceJourney,
  getOverviewState,
  isOptimizationProfileReviewed,
  loadState,
  normalizeHostContext,
  normalizeView,
  reviewOptimizationProfile,
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
  assert.equal(migrated.activeView, "overview");
  assert.equal(migrated.optimizationProfile.platform, "perfect");
  assert.equal(migrated.workspace.reviewedProfileKey, null);
});

test("schema v2 state migrates into the composite workspace model", () => {
  const storage = createStorage();
  storage.setItem(APP_STORAGE_KEY, JSON.stringify({
    schemaVersion: 2,
    activeView: "optimizer",
    calibrationHistory: [],
    transactions: [],
    optimizationProfile: { os: "windows10", gpuVendor: "amd", platform: "fivee", planMode: "full" },
    optimizationChecks: { "refresh-rate": true }
  }));

  const migrated = loadState(storage);
  assert.equal(migrated.schemaVersion, APP_SCHEMA_VERSION);
  assert.equal(migrated.activeView, "overview");
  assert.equal(migrated.optimizationProfile.gpuVendor, "amd");
  assert.equal(migrated.workspace.reviewedProfileKey, null);
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

test("profile review is tied to the exact environment selection", () => {
  const state = createInitialState();
  state.workspace = reviewOptimizationProfile(state.workspace, state.optimizationProfile);

  assert.equal(isOptimizationProfileReviewed(state.workspace, state.optimizationProfile), true);
  assert.equal(isOptimizationProfileReviewed(state.workspace, { ...state.optimizationProfile, gpuVendor: "nvidia" }), false);
});

test("retired optimizer and module views collapse to the workbench overview", () => {
  assert.equal(normalizeView("overview"), "overview");
  assert.equal(normalizeView("diagnostics"), "diagnostics");
  assert.equal(normalizeView("recovery"), "recovery");
  assert.equal(normalizeView("settings"), "settings");
  assert.equal(normalizeView("optimizer"), "overview");
  assert.equal(normalizeView("modules"), "overview");
  assert.equal(normalizeView("module"), "overview");
  assert.equal(normalizeView("history"), "overview");
});

test("catalog progress APIs still describe research checklists without a workbench page", () => {
  const state = createInitialState();
  const rules = getRecommendations(state.optimizationProfile, "quick");
  let journey = getWorkspaceJourney(state, rules);
  assert.equal(journey.find((step) => step.id === "profile").status, "current");
  assert.equal(journey.find((step) => step.id === "readiness").status, "pending");

  state.workspace = reviewOptimizationProfile(state.workspace, state.optimizationProfile);
  state.optimizationChecks = Object.fromEntries(rules.map((rule) => [rule.id, true]));
  journey = getWorkspaceJourney(state, rules);
  assert.equal(journey.find((step) => step.id === "readiness").status, "complete");
  assert.equal(journey.find((step) => step.id === "sensitivity").status, "current");
  assert.equal(journey.find((step) => step.id === "recovery").status, "complete");
});

test("host context fails closed outside an authenticated desktop handshake", () => {
  const preview = normalizeHostContext({ mode: "preview", capabilities: { systemMutations: true } });
  assert.equal(preview.connected, false);
  assert.equal(preview.capabilities.systemMutations, false);

  const desktop = normalizeHostContext({
    mode: "desktop",
    connected: true,
    hostVersion: "1.0.0",
    capabilities: { nativeShell: true, openSettings: true, systemMutations: false }
  });
  assert.equal(desktop.connected, true);
  assert.equal(desktop.capabilities.openSettings, true);
  assert.equal(desktop.capabilities.systemMutations, false);
});
