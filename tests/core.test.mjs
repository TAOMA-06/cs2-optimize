import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_STORAGE_KEY,
  createCalibrationRecord,
  createInitialState,
  getActiveTransactions,
  getOverviewState,
  loadState,
  saveState,
  upsertCalibrationRecord
} from "../web/core.mjs";

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
