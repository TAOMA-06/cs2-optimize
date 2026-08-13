import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const labPath = join(testDirectory, "..", "cs2-sensitivity-lab.html");
const labHtml = readFileSync(labPath, "utf8");

function scriptSource(id) {
  const match = labHtml.match(new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  assert.ok(match, `cs2-sensitivity-lab.html must contain the ${id} script`);
  return match[1];
}

function loadLabCore() {
  const source = scriptSource("lab-core");

  // The core is intentionally evaluated without window/document. This makes a
  // missing pure-logic boundary fail here instead of hiding behind the browser.
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "cs2-sensitivity-lab.html#lab-core" }).runInContext(sandbox);

  assert.ok(sandbox.CS2SensLabCore, "lab-core must expose CS2SensLabCore");
  return sandbox.CS2SensLabCore;
}

const Core = loadLabCore();
const EPSILON = 1e-9;

function approximately(actual, expected, tolerance = EPSILON, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message || `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function profile(overrides = {}) {
  return {
    dpi: 800,
    currentSens: 1,
    padWidth: 45,
    polling: 1000,
    mYaw: 0.022,
    mPitch: 0.022,
    aimStyle: "hybrid",
    role: "rifle",
    priority: "balance",
    mode: "standard",
    ...overrides
  };
}

function candidateSensitivities(candidates) {
  return Array.from(candidates, (candidate) => Core.formatSensitivity(candidate.sensitivity));
}

function taskMetrics(multiplier) {
  return {
    flick: {
      timePerId: 100 * multiplier,
      missRate: 0.10 * multiplier,
      settleMs: 120 * multiplier,
      overshootCorrection: 0.10 * multiplier,
      pathInefficiency: 1.20 * multiplier
    },
    lateral: {
      timePerId: 110 * multiplier,
      missRate: 0.10 * multiplier,
      settleMs: 130 * multiplier,
      overshootCorrection: 0.12 * multiplier,
      pathInefficiency: 1.30 * multiplier
    },
    track: {
      rmsError: 1.10 * multiplier,
      offTargetRatio: 0.10 * multiplier,
      reacquireMs: 180 * multiplier,
      speedMismatch: 1.20 * multiplier
    }
  };
}

function syntheticBlocks(stage, multipliers, jitter = () => 1) {
  const blocks = [];
  let orderIndex = 0;

  for (let pass = 0; pass < stage.passes; pass += 1) {
    for (const candidateKey of stage.orders[pass]) {
      const multiplier = multipliers[candidateKey] * jitter(pass, candidateKey);
      blocks.push({
        stageId: stage.id,
        pass,
        candidateKey,
        valid: true,
        orderIndex: orderIndex += 1,
        tasks: taskMetrics(multiplier)
      });
    }
  }

  return blocks;
}

function makeScoreStage(seed = 12345) {
  return Core.createBalancedStage("score", Core.buildCoarseCandidates(profile()), seed, 3, false);
}

function makeSinglePassStage(id, seed = 12345) {
  return Core.createBalancedStage(id, Core.buildCoarseCandidates(profile()), seed, 1, false);
}

function textHash(value) {
  return [...String(value)].reduce((hash, character) => ((hash * 33) ^ character.charCodeAt(0)) >>> 0, 5381);
}

function createVirtualRafClock() {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();

  return {
    requestFrame(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    tick(deltaMs = 16.667) {
      now += deltaMs;
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => callback(now));
    },
    pending() {
      return callbacks.size;
    }
  };
}

function createControllerHarness(pointerLockBehavior = "success", storedState = null) {
  const elementEvents = new WeakMap();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const elements = new Map();
  const rafCallbacks = new Map();
  const timers = new Map();
  let nextRaf = 1;
  let nextTimer = 1;
  let timestamp = 0;

  function addListener(registry, type, callback) {
    const callbacks = registry.get(type) || [];
    callbacks.push(callback);
    registry.set(type, callbacks);
  }
  function emit(registry, type, event = {}) {
    for (const callback of registry.get(type) || []) callback({ preventDefault() {}, ...event });
  }
  function classList() {
    const values = new Set();
    return {
      add(...names) { names.forEach((name) => values.add(name)); },
      remove(...names) { names.forEach((name) => values.delete(name)); },
      toggle(name, force) {
        const enabled = force === undefined ? !values.has(name) : Boolean(force);
        if (enabled) values.add(name); else values.delete(name);
        return enabled;
      },
      contains(name) { return values.has(name); }
    };
  }
  function fakeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const listeners = new Map();
    const element = {
      id,
      dataset: {},
      classList: classList(),
      style: { setProperty(name, value) { this[name] = value; } },
      hidden: false,
      disabled: false,
      value: "",
      checked: false,
      textContent: "",
      innerHTML: "",
      clientWidth: id === "arena" ? 960 : 0,
      clientHeight: id === "arena" ? 540 : 0,
      children: [],
      onclick: null,
      addEventListener(type, callback) { addListener(listeners, type, callback); },
      emit(type, event) { emit(listeners, type, event); },
      click() {
        this.emit("click");
        if (typeof this.onclick === "function") this.onclick({ preventDefault() {} });
      },
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); },
      setAttribute(name, value) { this[name] = String(value); },
      select() {}
    };
    elementEvents.set(element, listeners);
    elements.set(id, element);
    return element;
  }

  const radioValues = { aimStyle: "hybrid", role: "rifle", priority: "balance", mode: "standard" };
  const profileValues = { dpi: "800", currentSens: "1", padWidth: "45", polling: "1000", mYaw: "0.022", mPitch: "0.022" };
  Object.entries(profileValues).forEach(([id, value]) => { fakeElement(id).value = value; });
  const views = ["profile", "lab", "result"].map((view) => ({ dataset: { view }, classList: classList() }));
  const dots = ["profile", "lab", "result"].map((step) => ({ dataset: { step }, classList: classList() }));
  const body = fakeElement("body");
  const document = {
    pointerLockElement: null,
    hidden: false,
    body,
    documentElement: { setAttribute() {} },
    getElementById(id) { return fakeElement(id); },
    createElement(tagName) { return fakeElement(`generated-${tagName}-${elements.size}`); },
    querySelector(selector) {
      const match = selector.match(/^input\[name="([^"]+)"\]:checked$/);
      return match ? { value: radioValues[match[1]], checked: true } : null;
    },
    querySelectorAll(selector) {
      if (selector === ".view") return views;
      if (selector === ".step-dot") return dots;
      return [];
    },
    addEventListener(type, callback) { addListener(documentEvents, type, callback); },
    emit(type, event) { emit(documentEvents, type, event); },
    exitPointerLock() { this.pointerLockElement = null; }
  };
  const storage = new Map();
  const copiedTexts = [];
  if (storedState) storage.set("cs2-sens-lab-v3", JSON.stringify(storedState));
  document.execCommand = () => true;
  const sandbox = {
    console,
    document,
    localStorage: { getItem(key) { return storage.has(key) ? storage.get(key) : null; }, setItem(key, value) { storage.set(key, String(value)); } },
    navigator: { clipboard: { writeText(value) { copiedTexts.push(value); return Promise.resolve(); } } },
    location: { hash: "" },
    performance: { now: () => timestamp },
    crypto: { getRandomValues(values) { values[0] = 0x12345678; return values; } },
    scrollTo() {},
    requestAnimationFrame(callback) { const id = nextRaf; nextRaf += 1; rafCallbacks.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafCallbacks.delete(id); },
    setTimeout(callback) { const id = nextTimer; nextTimer += 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { addListener(windowEvents, type, callback); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const arena = fakeElement("arena");
  arena.requests = [];
  arena.requestPointerLock = (options) => {
    arena.requests.push(options);
    if (pointerLockBehavior === "throw") throw new Error("raw pointer lock unsupported");
    return undefined;
  };

  vm.createContext(sandbox);
  new vm.Script(scriptSource("lab-core"), { filename: "cs2-sensitivity-lab.html#lab-core" }).runInContext(sandbox);
  new vm.Script(scriptSource("lab-controller"), { filename: "cs2-sensitivity-lab.html#lab-controller" }).runInContext(sandbox);

  return {
    arena,
    document,
    element: fakeElement,
    submitProfile() { fakeElement("profileForm").emit("submit"); },
    lock() { document.pointerLockElement = arena; document.emit("pointerlockchange"); },
    unlock() { document.pointerLockElement = null; document.emit("pointerlockchange"); },
    emitWindow(type) { emit(windowEvents, type); },
    rafCount() { return rafCallbacks.size; },
    tick(deltaMs) {
      timestamp += deltaMs;
      const callbacks = [...rafCallbacks.values()];
      rafCallbacks.clear();
      callbacks.forEach((callback) => callback(timestamp));
    },
    fireTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    copiedTexts,
    snapshot() { return plain(sandbox.CS2SensLab.snapshot()); }
  };
}

test("the active v3 LabCore is isolated, versioned, and read-only", () => {
  assert.equal(Core.version, "3.0.0");
  assert.equal(Core.constants.algorithmVersion, "3.0.0");
  assert.equal(Core.constants.taskVersion, "angles-3.0.0");
  assert.equal(Core.constants.defaultYaw, 0.022);
  assert.equal(Core.constants.defaultPitch, 0.022);
  assert.equal(Core.constants.dwellMs, 100);
  assert.equal(Core.constants.stallMs, 350);
  assert.ok(Object.isFrozen(Core), "the public test surface should not be mutable at runtime");
  assert.ok(Object.isFrozen(Core.constants), "the constants surface should be read-only");
  assert.deepEqual(plain(Core.constants.tasks), ["flick", "track", "lateral"]);
});

test("pointer deltas use yaw and pitch independently, including inverted Y", () => {
  const calibration = { sensitivity: 1.5, mYaw: 0.022, mPitch: 0.022 };
  const origin = { yaw: 0, pitch: 0 };

  const right = Core.applyPointerDelta(origin, { x: 10, y: 0 }, calibration);
  const left = Core.applyPointerDelta(origin, { x: -10, y: 0 }, calibration);
  const down = Core.applyPointerDelta(origin, { x: 0, y: 10 }, calibration);
  const up = Core.applyPointerDelta(origin, { x: 0, y: -10 }, calibration);

  approximately(right.yawDelta, 0.33);
  approximately(left.yawDelta, -0.33);
  approximately(down.pitchDelta, -0.33);
  approximately(up.pitchDelta, 0.33);
  assert.ok(right.camera.yaw > 0 && left.camera.yaw < 0, "movementX must turn horizontally in matching directions");
  assert.ok(down.camera.pitch < 0 && up.camera.pitch > 0, "positive m_pitch makes a physical down movement aim down");

  const inverted = Core.applyPointerDelta(origin, { x: 0, y: 10 }, { ...calibration, mPitch: -0.022 });
  assert.ok(inverted.camera.pitch > 0, "negative m_pitch must explicitly invert Y");

  const oneTimes = Core.applyPointerDelta(origin, { x: 37, y: -19 }, { sensitivity: 1, mYaw: 0.022, mPitch: 0.022 });
  const twoTimes = Core.applyPointerDelta(origin, { x: 37, y: -19 }, { sensitivity: 2, mYaw: 0.022, mPitch: 0.022 });
  approximately(twoTimes.yawDelta, oneTimes.yawDelta * 2);
  approximately(twoTimes.pitchDelta, oneTimes.pitchDelta * 2);

  const cm = Core.cmForSensitivity(800, 1.25, 0.022);
  approximately(Core.sensitivityForCm(800, cm, 0.022), 1.25);
});

test("pointer directions map to the expected reticle quadrants", () => {
  const viewport = { width: 1000, height: 600 };
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const calibration = { sensitivity: 1, mYaw: 0.022, mPitch: 0.022 };
  const quadrants = [
    { movement: { x: 20, y: 20 }, right: true, below: true },
    { movement: { x: 20, y: -20 }, right: true, below: false },
    { movement: { x: -20, y: 20 }, right: false, below: true },
    { movement: { x: -20, y: -20 }, right: false, below: false }
  ];

  for (const item of quadrants) {
    const camera = Core.applyPointerDelta({ yaw: 0, pitch: 0 }, item.movement, calibration).camera;
    const reticle = Core.projectReticle(camera, { yaw: 0, pitch: 0 }, viewport);
    assert.equal(reticle.x > center.x, item.right, `movement ${JSON.stringify(item.movement)} must have the expected horizontal direction`);
    assert.equal(reticle.y > center.y, item.below, `movement ${JSON.stringify(item.movement)} must have the expected vertical direction`);
  }
});

test("target and reticle projection remain logically separated and align exactly", () => {
  const viewport = { width: 1280, height: 720 };
  const presentationCamera = { yaw: 3, pitch: -2 };
  const target = { yaw: 17, pitch: -8, radius: 1.2 };
  const initialTarget = Core.projectTarget(target, presentationCamera, viewport);
  const targetSnapshot = plain(target);

  let camera = { yaw: 0, pitch: 0 };
  for (const movement of [{ x: 120, y: -50 }, { x: -80, y: 30 }, { x: 35, y: 60 }]) {
    camera = Core.applyPointerDelta(camera, movement, { sensitivity: 1.2, mYaw: 0.022, mPitch: 0.022 }).camera;
  }
  const laterTarget = Core.projectTarget(target, presentationCamera, viewport);
  assert.deepEqual(plain(target), targetSnapshot, "mouse input must not mutate a static target");
  approximately(laterTarget.x, initialTarget.x);
  approximately(laterTarget.y, initialTarget.y);

  const alignedTarget = Core.projectTarget({ yaw: camera.yaw, pitch: camera.pitch, radius: 1.5 }, presentationCamera, viewport);
  const alignedReticle = Core.projectReticle(camera, presentationCamera, viewport);
  approximately(alignedTarget.x, alignedReticle.x, 1e-12, "same logical yaw must be pixel-aligned");
  approximately(alignedTarget.y, alignedReticle.y, 1e-12, "same logical pitch must be pixel-aligned");

  const offscreenTarget = Core.projectTarget({ yaw: 110, pitch: -80, radius: 1.2 }, presentationCamera, viewport);
  const offscreenReticle = Core.projectReticle({ yaw: 110, pitch: -80 }, presentationCamera, viewport);
  approximately(offscreenTarget.x, offscreenReticle.x, 1e-12, "edge clamping must retain alignment outside FOV");
  approximately(offscreenTarget.y, offscreenReticle.y, 1e-12, "edge clamping must retain alignment outside FOV");
});

test("off-FOV projections keep their true horizontal and vertical edge directions", () => {
  const viewport = { width: 1000, height: 600 };
  const origin = { yaw: 0, pitch: 0 };
  const right = Core.projectTarget({ yaw: 100, pitch: 0, radius: 1.2 }, origin, viewport);
  const left = Core.projectTarget({ yaw: -100, pitch: 0, radius: 1.2 }, origin, viewport);
  const up = Core.projectTarget({ yaw: 0, pitch: 100, radius: 1.2 }, origin, viewport);
  const down = Core.projectTarget({ yaw: 0, pitch: -100, radius: 1.2 }, origin, viewport);

  assert.equal(right.onScreen, false);
  assert.equal(left.onScreen, false);
  assert.equal(up.onScreen, false);
  assert.equal(down.onScreen, false);
  assert.ok(right.x > viewport.width / 2 && left.x < viewport.width / 2, "horizontal off-FOV direction must be retained");
  assert.ok(up.y < viewport.height / 2 && down.y > viewport.height / 2, "vertical off-FOV direction must be retained");
});

test("candidate grids use actual ±20% / ±6% values and balanced blind ordering", () => {
  const coarse = Core.buildCoarseCandidates(profile({ currentSens: 1 }));
  assert.deepEqual(candidateSensitivities(coarse), ["0.833", "1.000", "1.200"]);
  assert.ok(coarse.some((candidate) => Core.formatSensitivity(candidate.sensitivity) === "1.000"), "current sensitivity must be a real coarse candidate");

  const fine = Core.buildFineCandidates(profile({ currentSens: 1 }), coarse[1]);
  assert.deepEqual(candidateSensitivities(fine), ["0.943", "1.000", "1.060"]);
  assert.ok(coarse.every((candidate) => candidate.sensitivity >= Core.constants.range.min && candidate.sensitivity <= Core.constants.range.max));
  assert.ok(fine.every((candidate) => candidate.sensitivity >= Core.constants.range.min && candidate.sensitivity <= Core.constants.range.max));

  const atLowerBound = Core.buildCoarseCandidates(profile({ currentSens: 0.1 }));
  assert.equal(new Set(candidateSensitivities(atLowerBound)).size, 3, "a boundary start must still produce three actual candidates");
  assert.ok(atLowerBound.every((candidate) => candidate.sensitivity >= 0.1 && candidate.sensitivity <= 8));

  const stage = Core.createBalancedStage("coarse", coarse, 777, 3, false);
  assert.deepEqual(Array.from(stage.orders, (order) => Array.from(order, (key) => Core.candidateLabel(stage, key)).join("")), ["ABC", "BCA", "CAB"]);
  for (const candidate of stage.candidates) {
    const positions = Array.from(stage.orders, (order) => order.indexOf(candidate.key)).sort();
    assert.deepEqual(positions, [0, 1, 2], "every candidate must occupy every ordinal position once");
  }
  assert.deepEqual(plain(Core.createBalancedStage("coarse", coarse, 777, 3, false)), plain(stage), "the same seed must produce the same blind mapping");
  assert.deepEqual(stage.passSeeds.length, 3);
  assert.equal(new Set(stage.passSeeds).size, 3, "each balanced pass needs a distinct target seed");
  for (let pass = 0; pass < stage.passes; pass += 1) {
    const sequences = stage.orders[pass].map(() => Core.createTaskSequence("flick", stage.passSeeds[pass], 25_000));
    assert.ok(sequences.every((sequence) => JSON.stringify(plain(sequence)) === JSON.stringify(plain(sequences[0]))), "every A/B/C candidate in a pass must receive the identical target sequence");
  }
  assert.notDeepEqual(
    plain(Core.createTaskSequence("flick", stage.passSeeds[0], 25_000)),
    plain(Core.createTaskSequence("flick", stage.passSeeds[1], 25_000)),
    "different passes must receive different seeded task sequences"
  );

  const confirmation = Core.createBalancedStage("coarse", coarse, 777, 3, true);
  assert.deepEqual(Array.from(confirmation.orders, (order) => Array.from(order, (key) => Core.candidateLabel(confirmation, key)).join("")), ["CBA", "ACB", "BAC"]);

  const lowerBoundary = Core.buildBoundaryCandidates(profile(), { candidates: coarse }, coarse[0], 1.2);
  const upperBoundary = Core.buildBoundaryCandidates(profile(), { candidates: coarse }, coarse[2], 1.2);
  assert.ok(lowerBoundary.some((candidate) => candidate.sensitivity < coarse[0].sensitivity));
  assert.ok(upperBoundary.some((candidate) => candidate.sensitivity > coarse[2].sensitivity));
  assert.deepEqual(plain(Core.buildBoundaryCandidates(profile(), { candidates: coarse }, coarse[1], 1.2)), []);
});

test("mode estimates preserve the published timing boundaries", () => {
  assert.ok(Core.estimateDuration("express") < 120_000, "Express must stay under two minutes");
  assert.ok(Core.estimateDuration("quick") >= 4 * 60_000 && Core.estimateDuration("quick") <= 6 * 60_000, "Quick should be a four-to-six-minute screen");
  assert.ok(Core.estimateDuration("standard") >= 13 * 60_000 && Core.estimateDuration("standard") <= 15 * 60_000, "Standard should be a thirteen-to-fifteen-minute comparison");
  assert.ok(Core.estimateDuration("deep") >= 27 * 60_000 && Core.estimateDuration("deep") <= 30 * 60_000, "Deep should include the fine stage in its estimate");
  assert.equal(Core.constants.modes.express.rangeOnly, true);
  assert.equal(Core.constants.modes.quick.rangeOnly, true);
  assert.equal(Core.constants.modes.standard.passes, 3);
  assert.equal(Core.constants.modes.deep.passes, 3);
});

test("seeded task generation is deterministic and stays within all angular constraints for 10,000 seeds", { timeout: 60_000 }, () => {
  let violation = null;

  for (let seed = 0; seed < 10_000; seed += 1) {
    const flick = Core.createTaskSequence("flick", seed, 8_000);
    const flickAgain = seed === 777 ? Core.createTaskSequence("flick", seed, 8_000) : null;
    if (flickAgain) assert.deepEqual(plain(flick), plain(flickAgain), "seeded task sequences must replay exactly");
    for (const target of flick.targets) {
      const distance = Math.hypot(target.yawOffset, target.pitchOffset);
      if (distance < 10 - EPSILON || distance > 30 + EPSILON || target.radius !== 1.2 || target.timeoutMs !== 2200) {
        violation ||= `flick seed ${seed} produced an invalid target`;
      }
      for (const origin of [{ yaw: 0, pitch: -44 }, { yaw: 0, pitch: 0 }, { yaw: 0, pitch: 44 }]) {
        const placed = Core.placeAcquisitionTarget(origin, target, 44);
        const placedDistance = Core.angularDistance(placed, origin);
        if (placedDistance < 10 - EPSILON || placedDistance > 30 + EPSILON || Math.abs(placed.pitch) > 44 + EPSILON || placed.radius !== 1.2) {
          violation ||= `flick seed ${seed} lost its true 10–30° geometry at a pitch bound`;
        }
      }
    }

    const lateral = Core.createTaskSequence("lateral", seed, 8_000);
    for (const target of lateral.targets) {
      if (Math.abs(target.yawOffset) < 28 - EPSILON || Math.abs(target.yawOffset) > 42 + EPSILON || target.pitchOffset !== 0 || target.radius !== 1.5 || target.timeoutMs !== 2500) {
        violation ||= `lateral seed ${seed} produced an invalid target`;
      }
    }

    const track = Core.createTaskSequence("track", seed, 8_000);
    let previousEnd = 0;
    for (const segment of track.segments) {
      const points = [segment.start, segment.end];
      for (const point of points) {
        if (Math.abs(point.yaw) > 21 + EPSILON || Math.abs(point.pitch) > 11 + EPSILON) {
          violation ||= `track seed ${seed} left the declared trajectory bounds`;
        }
      }
      const midpoint = Core.trackPosition(track, (segment.startMs + segment.endMs) / 2);
      if (Math.abs(midpoint.yaw) > 21 + EPSILON || Math.abs(midpoint.pitch) > 11 + EPSILON || segment.speed < 12 - EPSILON || segment.speed > 25 + EPSILON || segment.radius !== 1.5 || segment.startMs < previousEnd - EPSILON || segment.endMs <= segment.startMs) {
        violation ||= `track seed ${seed} produced an invalid segment`;
      }
      previousEnd = segment.endMs;
    }
  }

  assert.equal(violation, null, violation || "all generated targets must obey their contracts");
});

test("tracking is seeded motion rather than something dragged by the reticle", () => {
  const sequence = Core.createTaskSequence("track", 9901, 25_000);
  const atOneSecond = Core.trackPosition(sequence, 1_000);
  const atTwoSeconds = Core.trackPosition(sequence, 2_000);
  assert.notDeepEqual(plain(atOneSecond), plain(atTwoSeconds), "the target should advance along its own seeded path");

  const targetBeforeInput = plain(Core.trackPosition(sequence, 1_500));
  const cameraAfterInput = Core.applyPointerDelta({ yaw: 0, pitch: 0 }, { x: 400, y: -230 }, { sensitivity: 1.4, mYaw: 0.022, mPitch: 0.022 }).camera;
  const targetAfterInput = plain(Core.trackPosition(sequence, 1_500));
  assert.deepEqual(targetAfterInput, targetBeforeInput, "camera movement must not affect tracking coordinates");
  assert.notEqual(cameraAfterInput.yaw, targetAfterInput.yaw, "the test has actually moved the reticle independently");
});

test("dwell uses real elapsed timestamps and cannot be satisfied by a fly-through", () => {
  let dwell = Core.createDwellState();
  dwell = Core.updateDwell(dwell, true, 0);
  dwell = Core.updateDwell(dwell, true, 99);
  assert.equal(dwell.hit, false, "99 ms must not count as a hit");
  dwell = Core.updateDwell(dwell, true, 100);
  assert.equal(dwell.hit, true, "100 ms must count as a hit");

  let flyThrough = Core.createDwellState();
  flyThrough = Core.updateDwell(flyThrough, true, 0);
  flyThrough = Core.updateDwell(flyThrough, false, 45);
  flyThrough = Core.updateDwell(flyThrough, true, 50);
  flyThrough = Core.updateDwell(flyThrough, true, 149);
  assert.equal(flyThrough.hit, false, "leaving the target resets the dwell clock");
  flyThrough = Core.updateDwell(flyThrough, true, 150);
  assert.equal(flyThrough.hit, true);

  const atFrames = (timestamps) => timestamps.reduce((state, now) => Core.updateDwell(state, true, now), Core.createDwellState());
  assert.equal(atFrames([0, 100]).hit, true, "a stalled frame still uses its real timestamp");
  assert.equal(atFrames([0, 16, 33, 50, 67, 84, 100]).hit, true, "the same elapsed time must hit at high frame rate too");
});

test("axis scoring detects vertical and diagonal overshoot plus the return correction", () => {
  let vertical = Core.createAxisState({ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 10 });
  vertical = Core.updateAxisState(vertical, { yaw: 0, pitch: 12 });
  assert.equal(vertical.overshoots, 1, "pure vertical motion must participate in overshoot scoring");
  vertical = Core.updateAxisState(vertical, { yaw: 0, pitch: 9 });
  assert.equal(vertical.corrections, 1, "a return toward the target must be a correction");

  let diagonal = Core.createAxisState({ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 10 });
  diagonal = Core.updateAxisState(diagonal, { yaw: 12, pitch: 12 });
  assert.equal(diagonal.overshoots, 1, "diagonal motion must use its target-axis projection");
  diagonal = Core.updateAxisState(diagonal, { yaw: 9, pitch: 9 });
  assert.equal(diagonal.corrections, 1, "diagonal return motion must also be counted");
});

test("pass-normalized losses use fixed role weights and robust log caps", () => {
  const specTotal = (task) => Core.constants.metricSpecs[task].reduce((sum, [, weight]) => sum + weight, 0);
  approximately(specTotal("flick"), 1);
  approximately(specTotal("lateral"), 1);
  approximately(specTotal("track"), 1);
  approximately(Object.values(Core.constants.roleWeights.entry).reduce((sum, value) => sum + value, 0), 1);
  approximately(Object.values(Core.constants.roleWeights.rifle).reduce((sum, value) => sum + value, 0), 1);
  approximately(Object.values(Core.constants.roleWeights.awp).reduce((sum, value) => sum + value, 0), 1);
  approximately(Core.logRelativeLoss(30, 1), Math.log(3));
  approximately(Core.logRelativeLoss(1 / 30, 1), -Math.log(3));

  const stage = makeScoreStage(99);
  const [best, middle, worst] = stage.candidates;
  const blocks = syntheticBlocks(stage, {
    [best.key]: 0.92,
    [middle.key]: 1,
    [worst.key]: 1.12
  });
  const rows = Core.calculatePassLosses(blocks, stage, "rifle");
  assert.equal(rows.length, 9, "only complete passes enter normalized loss scoring");
  assert.ok(rows.filter((row) => row.candidateKey === best.key).every((row) => row.loss < 0));
  assert.ok(rows.filter((row) => row.candidateKey === worst.key).every((row) => row.loss > 0));

  const evaluation = Core.evaluateStage(blocks, stage, "rifle", { mode: "standard" });
  assert.equal(evaluation.uniqueLeader.key, best.key, "a clear candidate must dominate both rivals in all three passes");
  assert.equal(Core.isBoundaryLeader(stage, evaluation), true, "the lowest tested candidate is a boundary winner");
  assert.ok(evaluation.pairwise.filter((pair) => pair.first === best.key).every((pair) => {
    approximately(pair.threshold, Math.max(Math.log(1.03), 1.4826 * pair.mad, evaluation.drift));
    return pair.threshold >= Math.log(1.03);
  }), "every pair must use max(3%, 1.4826 × MAD, session drift)");
});

test("individual task metrics and role weights materially affect the fixed loss", () => {
  const stage = makeScoreStage(707);
  const [flickCost, lateralCost, neutral] = stage.candidates;
  const fixed = (flickMultiplier, lateralMultiplier) => ({
    flick: { ...taskMetrics(1).flick, timePerId: 100 * flickMultiplier },
    lateral: { ...taskMetrics(1).lateral, timePerId: 110 * lateralMultiplier },
    track: taskMetrics(1).track
  });
  const blocks = [];
  let orderIndex = 0;
  for (let pass = 0; pass < stage.passes; pass += 1) {
    for (const candidateKey of stage.orders[pass]) {
      const tasks = candidateKey === flickCost.key ? fixed(1.25, 0.88)
        : candidateKey === lateralCost.key ? fixed(0.88, 1.25)
          : fixed(1.08, 1.08);
      blocks.push({ stageId: stage.id, pass, candidateKey, valid: true, orderIndex: orderIndex += 1, tasks });
    }
  }
  const entry = Core.evaluateStage(blocks, stage, "entry", { mode: "standard" });
  const awp = Core.evaluateStage(blocks, stage, "awp", { mode: "standard" });
  assert.equal(entry.ranking[0].key, flickCost.key, "entry's 45% lateral weight should favor the lateral-control candidate");
  assert.equal(awp.ranking[0].key, lateralCost.key, "AWP's 50% flick weight should favor the flick-control candidate");

  const metricShift = blocks.map((block) => ({ ...block, tasks: { ...block.tasks, flick: { ...block.tasks.flick, settleMs: block.candidateKey === flickCost.key ? 900 : block.tasks.flick.settleMs } } }));
  const shifted = Core.evaluateStage(metricShift, stage, "entry", { mode: "standard" });
  assert.notEqual(shifted.ranking[0].key, entry.ranking[0].key, "the 20% flick settle metric must affect the ranking instead of merely summing to one");
});

test("dominance is label-invariant, requires all three passes, and avoids close-gap false uniques", () => {
  let clearWins = 0;
  let closeGapUnique = 0;

  for (let sample = 0; sample < 100; sample += 1) {
    const stage = makeScoreStage(9000 + sample);
    const trueLeader = stage.candidates[sample % 3];
    const multipliers = {};
    stage.candidates.forEach((candidate, index) => {
      multipliers[candidate.key] = candidate.key === trueLeader.key ? 0.92 : 1 + index * 0.07;
    });
    const jitter = (pass, candidateKey) => {
      const seed = ((sample + 1) * 37 + (pass + 1) * 11 + textHash(candidateKey) * 3) % 7;
      return 1 + (seed - 3) * 0.001;
    };
    const evaluation = Core.evaluateStage(syntheticBlocks(stage, multipliers, jitter), stage, "rifle", { mode: "standard" });
    if (evaluation.uniqueLeader?.key === trueLeader.key) clearWins += 1;

    const closeMultipliers = {};
    stage.candidates.forEach((candidate, index) => {
      closeMultipliers[candidate.key] = [0.98, 1, 1.02][index];
    });
    const closeEvaluation = Core.evaluateStage(syntheticBlocks(stage, closeMultipliers), stage, "rifle", { mode: "standard" });
    if (closeEvaluation.uniqueLeader) closeGapUnique += 1;
  }

  assert.ok(clearWins >= 95, `an 8% synthetic leader should win at least 95% of runs (got ${clearWins})`);
  assert.ok(closeGapUnique <= 5, `a gap below 3% should rarely create a unique recommendation (got ${closeGapUnique})`);

  const stage = makeScoreStage(123);
  const [first, second, third] = stage.candidates;
  const blocks = syntheticBlocks(stage, { [first.key]: 0.92, [second.key]: 1, [third.key]: 1.1 });
  const relabeled = {
    ...stage,
    labelToKey: { A: stage.labelToKey.B, B: stage.labelToKey.C, C: stage.labelToKey.A },
    keyToLabel: { [stage.labelToKey.B]: "A", [stage.labelToKey.C]: "B", [stage.labelToKey.A]: "C" }
  };
  const labelOrders = [["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"]];
  relabeled.orders = labelOrders.map((order) => order.map((label) => relabeled.labelToKey[label]));
  const relabeledBlocks = syntheticBlocks(relabeled, { [first.key]: 0.92, [second.key]: 1, [third.key]: 1.1 });
  const normalResult = Core.evaluateStage(blocks, stage, "rifle", { mode: "standard" });
  const relabeledResult = Core.evaluateStage(relabeledBlocks, relabeled, "rifle", { mode: "standard" });
  assert.equal(relabeledResult.uniqueLeader.key, normalResult.uniqueLeader.key, "a complete A/B/C label permutation and reordered blind queue must not change the actual winner");

  const missingPass = blocks.filter((block) => block.pass !== 2);
  assert.equal(Core.evaluateStage(missingPass, stage, "rifle", { mode: "standard" }).uniqueLeader, null, "two passes cannot create a unique recommendation");
  assert.equal(Core.evaluateStage(blocks, stage, "rifle", { mode: "standard", anomaly: true }).uniqueLeader, null, "an anomalous session cannot create a unique recommendation");
});

test("Express and Quick keep a range while Standard carries the dominance data", () => {
  const stage = makeScoreStage(4545);
  const [best, middle, worst] = stage.candidates;
  const blocks = syntheticBlocks(stage, { [best.key]: 0.90, [middle.key]: 1, [worst.key]: 1.15 });
  const expressStage = makeSinglePassStage("express", 4545);
  const quickStage = makeSinglePassStage("quick", 9898);
  const expressMultipliers = Object.fromEntries(expressStage.candidates.map((candidate, index) => [candidate.key, [0.90, 1, 1.15][index]]));
  const quickMultipliers = Object.fromEntries(quickStage.candidates.map((candidate, index) => [candidate.key, [0.90, 1, 1.15][index]]));
  const express = Core.evaluateStage(syntheticBlocks(expressStage, expressMultipliers), expressStage, "rifle", { mode: "express", rangeOnly: true });
  const quick = Core.evaluateStage(syntheticBlocks(quickStage, quickMultipliers), quickStage, "rifle", { mode: "quick", rangeOnly: true });
  const standard = Core.evaluateStage(blocks, stage, "rifle", { mode: "standard" });
  assert.equal(express.uniqueLeader, null);
  assert.equal(express.rangeCandidates.length, 3, "Express must retain the complete coarse range");
  assert.equal(quick.uniqueLeader, null);
  assert.equal(quick.rangeCandidates.length, 2, "Quick must retain two actually-tested candidates");
  assert.equal(standard.uniqueLeader.key, best.key);
});

test("Theil-Sen drift is based on candidate-debiased chronological loss", () => {
  const stableRows = [
    { candidateKey: "a", loss: 1, orderIndex: 0 },
    { candidateKey: "b", loss: 1, orderIndex: 1 },
    { candidateKey: "c", loss: 1, orderIndex: 2 },
    { candidateKey: "a", loss: 1, orderIndex: 3 },
    { candidateKey: "b", loss: 1, orderIndex: 4 },
    { candidateKey: "c", loss: 1, orderIndex: 5 }
  ];
  assert.equal(Core.sessionDrift(stableRows), 0);

  const driftingRows = Array.from({ length: 9 }, (_, orderIndex) => ({
    candidateKey: ["a", "b", "c"][orderIndex % 3],
    loss: orderIndex / 10,
    orderIndex
  }));
  assert.ok(Core.sessionDrift(driftingRows) > 0.1, "a time trend remaining after candidate medians must increase drift");
  approximately(Core.theilSenSlope([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 4 }]), 1);
});

test("v2 migration, session summaries, history cap, and cross-day confirmation stay strict", () => {
  const migratedV2 = Core.migratePersistedState({
    v2: { profile: profile({ mPitch: undefined }) }
  });
  assert.equal(migratedV2.migratedFrom, "v2");
  assert.equal(migratedV2.profile.mPitch, 0.022, "migrated v2 profiles receive the v3 m_pitch default");
  assert.equal(migratedV2.session, null, "old sessions are invalidated rather than repurposed");
  assert.equal(migratedV2.result, null, "old results are invalidated rather than repurposed");
  assert.deepEqual(plain(Core.migratePersistedState({ v1: { profile: profile() } })), { profile: null, session: null, result: null, history: [], migratedFrom: null });

  const stage = makeScoreStage(8675309);
  const [best, middle, worst] = stage.candidates;
  const completedBlocks = syntheticBlocks(stage, { [best.key]: 0.91, [middle.key]: 1, [worst.key]: 1.1 }).map((block, index) => ({
    ...block,
    candidateSensitivity: stage.candidates.find((candidate) => candidate.key === block.candidateKey).sensitivity,
    label: Core.candidateLabel(stage, block.candidateKey),
    seed: stage.passSeeds[block.pass],
    validTaskMs: 75_000,
    inputMode: "raw",
    inputSamples: { flick: { events: 8, distance: 40 }, lateral: { events: 8, distance: 40 }, track: { events: 8, distance: 40 } },
    completedAt: `2026-08-12T00:${String(index).padStart(2, "0")}:00.000Z`,
    rawMouseTrajectory: [{ x: 1, y: 2 }]
  }));
  const evaluation = Core.evaluateStage(
    completedBlocks,
    stage,
    "rifle",
    { mode: "standard" }
  );
  const session = {
    id: "today",
    profile: profile(),
    mode: "standard",
    inputMode: "raw",
    validTaskMs: 420_000,
    anomalies: [],
    interruptions: [],
    stages: [stage],
    blocks: completedBlocks
  };
  const result = {
    completedAt: "2026-08-12T00:00:00.000Z",
    main: evaluation.uniqueLeader,
    range: evaluation.rangeCandidates,
    boundaryLimited: false,
    evaluation
  };
  const summary = Core.createSessionSummary(session, result);
  assert.equal(summary.eligible, true, "only a raw, complete Standard/Deep session can enter confirmation");
  assert.equal(summary.winnerDominatesAll, true, "history must retain the actual pairwise-dominance evidence");
  assert.equal(summary.roundMetrics.length, 9, "history summaries retain per-round metrics without raw mouse data");
  assert.equal(summary.stages.length, 1, "history summaries retain reproducible stage metadata");
  assert.deepEqual(summary.stages[0].passSeeds, stage.passSeeds);
  assert.equal("rawMouseTrajectory" in summary.roundMetrics[0], false, "history must never retain per-frame raw trajectories");
  assert.deepEqual(plain(summary.roundMetrics[0].inputSamples.track), { events: 8, distance: 40 });
  assert.notEqual(Core.profileSignature(profile({ currentSens: 1 })), Core.profileSignature(profile({ currentSens: 1.001 })), "cross-day profiles require the same configured center as well as the same grid");
  assert.deepEqual(plain(Core.summarizeRetestVariability(evaluation)), {
    pairwiseMad: Core.median(evaluation.pairwise.map((pair) => pair.mad)),
    sessionDrift: evaluation.drift,
    maxThreshold: Math.max(...evaluation.pairwise.map((pair) => pair.threshold), Math.log(1.03))
  });

  const tooShort = Core.createSessionSummary({ ...session, validTaskMs: 419_999 }, result);
  assert.equal(tooShort.eligible, false);
  const history = Array.from({ length: 101 }, (_, index) => ({ id: index }));
  assert.equal(Core.appendHistory(history, { id: "latest" }).length, 100, "local history is capped at 100 summaries");

  const yesterday = { ...summary, id: "yesterday", completedAt: "2026-08-11T00:00:00.000Z" };
  const confirmation = Core.findCrossSessionConfirmation([yesterday], summary, Date.parse(result.completedAt));
  assert.equal(confirmation.stable, true, "matching dominance evidence at least 24 hours apart is stable");
  assert.equal(confirmation.match.id, "yesterday");

  const tooRecent = { ...yesterday, completedAt: "2026-08-11T00:01:00.000Z" };
  assert.equal(Core.findCrossSessionConfirmation([tooRecent], summary, Date.parse(result.completedAt)).stable, false, "a confirmation less than 24 hours old is not stable");
  assert.equal(Core.findCrossSessionConfirmation([{ ...yesterday, winnerDominatesAll: false }], summary, Date.parse(result.completedAt)).stable, false, "missing dominance evidence cannot be promoted to stable");
});

test("the RAF scheduler admits at most one pending callback and honors cancellation", () => {
  const clock = createVirtualRafClock();
  const scheduler = Core.createRafScheduler(clock);
  const ticks = [];

  scheduler.request((now) => ticks.push(now));
  scheduler.request(() => ticks.push("second request must not be queued"));
  assert.equal(scheduler.pendingCount(), 1);
  assert.equal(clock.pending(), 1, "a duplicate request must not create a second RAF callback");
  clock.tick(20);
  assert.deepEqual(ticks, [20]);
  assert.equal(scheduler.pendingCount(), 0);

  scheduler.request((now) => ticks.push(now));
  scheduler.cancel();
  assert.equal(scheduler.pendingCount(), 0);
  clock.tick(20);
  assert.deepEqual(ticks, [20], "a canceled frame must not run later");

  scheduler.request((now) => ticks.push(now));
  scheduler.destroy();
  clock.tick(20);
  assert.deepEqual(ticks, [20], "destroy must cancel an already-pending frame");
  assert.equal(scheduler.request(() => ticks.push("destroyed")), 0, "a destroyed scheduler must not queue future frames");
});

test("the active controller requests raw input first, rebuilds compat cleanly, and voids fake Pointer Lock interruptions", () => {
  const fallback = createControllerHarness("throw");
  fallback.submitProfile();
  const rawSession = fallback.snapshot();
  assert.equal(rawSession.session.inputMode, "pending");
  fallback.element("startSession").click();
  const compat = fallback.snapshot();
  assert.deepEqual(plain(fallback.arena.requests[0]), { unadjustedMovement: true }, "the first request must prefer unadjusted Pointer Lock");
  assert.equal(compat.session.inputMode, "compat");
  assert.equal(compat.session.mode, "quick", "a raw failure can only rebuild an Express/Quick compatibility session");
  assert.notEqual(compat.session.id, rawSession.session.id, "raw scores must not be mixed into the replacement session");
  assert.equal(compat.session.blocks, 0);
  assert.equal(compat.rafPending, 0);

  const silentRaw = createControllerHarness("success");
  silentRaw.submitProfile();
  silentRaw.element("startSession").click();
  silentRaw.fireTimers();
  assert.equal(silentRaw.snapshot().session.inputMode, "compat", "a raw request that never resolves must time out into a clean compat session");

  const raw = createControllerHarness("success");
  raw.submitProfile();
  raw.element("startSession").click();
  raw.lock();
  let live = raw.snapshot();
  assert.equal(live.session.inputMode, "raw");
  assert.equal(live.active, true);
  assert.equal(live.rafPending, 1, "the deterministic RAF must have exactly one queued controller frame");
  raw.element("startSession").click();
  assert.equal(raw.rafCount(), 1, "repeated Start clicks must not create another loop");
  raw.tick(400);
  live = raw.snapshot();
  assert.equal(live.active, false);
  assert.equal(live.session.status, "paused");
  assert.equal(live.session.anomalies, 1, "a >350 ms fake frame stall must void the block");
  assert.equal(live.rafPending, 0);

  const adaptationOnly = createControllerHarness("success");
  adaptationOnly.submitProfile();
  adaptationOnly.element("startSession").click();
  adaptationOnly.lock();
  adaptationOnly.tick(3_000);
  for (let index = 0; index < 20; index += 1) adaptationOnly.document.emit("mousemove", { movementX: 10, movementY: 0 });
  adaptationOnly.tick(12_000);
  adaptationOnly.tick(17_000);
  assert.equal(adaptationOnly.snapshot().session.status, "paused", "adaptation-only mouse movement must not satisfy live-task input sampling");

  const focus = createControllerHarness("success");
  focus.submitProfile();
  focus.element("startSession").click();
  focus.lock();
  focus.emitWindow("blur");
  assert.equal(focus.snapshot().session.status, "paused", "focus loss must void rather than resume a block");

  const resize = createControllerHarness("success");
  resize.submitProfile();
  resize.element("startSession").click();
  resize.lock();
  resize.emitWindow("resize");
  assert.equal(resize.snapshot().session.status, "paused", "resize/zoom must void rather than freeze and continue a block");

  const lostLock = createControllerHarness("success");
  lostLock.submitProfile();
  lostLock.element("startSession").click();
  lostLock.lock();
  lostLock.unlock();
  assert.equal(lostLock.snapshot().session.status, "paused", "Pointer Lock loss must void the active block");
});

test("the active result controller renders variability/history and copies reproducible output", () => {
  const stage = makeScoreStage(2048);
  const [best, middle, worst] = stage.candidates;
  const blocks = syntheticBlocks(stage, { [best.key]: 0.90, [middle.key]: 1, [worst.key]: 1.12 }).map((block, index) => ({
    ...block,
    candidateSensitivity: stage.candidates.find((candidate) => candidate.key === block.candidateKey).sensitivity,
    validTaskMs: 75_000,
    inputMode: "raw",
    inputSamples: { flick: { events: 9, distance: 42 }, lateral: { events: 9, distance: 42 }, track: { events: 9, distance: 42 } },
    completedAt: `2026-08-12T01:${String(index).padStart(2, "0")}:00.000Z`
  }));
  const evaluation = Core.evaluateStage(blocks, stage, "rifle", { mode: "standard" });
  const savedProfile = profile({ mYaw: 0.022123, mPitch: -0.022456 });
  const savedSession = {
    version: Core.version, id: "result-session", profile: savedProfile, mode: "standard", inputMode: "raw", blocks,
    stages: [stage], validTaskMs: 675_000, anomalies: [], interruptions: [], status: "complete"
  };
  const result = {
    algorithmVersion: Core.version, taskVersion: Core.constants.taskVersion, completedAt: "2026-08-12T02:00:00.000Z",
    mode: "standard", inputMode: "raw", profile: savedProfile, stage: stage.id, finalCandidates: stage.candidates,
    range: [best], main: best, displayPreference: null, boundaryLimited: false, evaluation,
    variability: Core.summarizeRetestVariability(evaluation), evidence: "会话主推荐",
    summary: { eligible: true, roundMetrics: blocks },
    confirmation: { stable: false, nextEligibleAt: "2026-08-13T02:00:00.000Z" },
    historyEvidence: { storedSessions: 2, sameGridSessions: 1, eligible: true, crossSessionStable: false }
  };
  const page = createControllerHarness("success", { version: Core.version, profile: savedProfile, session: savedSession, result, history: [] });
  assert.equal(page.snapshot().view, "result");
  assert.equal(page.element("commandText").textContent, `sensitivity ${Core.formatSensitivity(best.sensitivity)}`);
  assert.equal(page.element("copyCommand").disabled, false);
  assert.match(page.element("reasonList").innerHTML, /复测波动/);
  assert.match(page.element("reasonList").innerHTML, /历史证据/);
  assert.match(page.element("reproductionBlock").textContent, /m_yaw 0\.022123/);
  assert.match(page.element("reproductionBlock").textContent, /m_pitch -0\.022456/);
  page.element("copyCommand").click();
  page.element("copyReport").click();
  assert.ok(page.copiedTexts.includes(`sensitivity ${Core.formatSensitivity(best.sensitivity)}`), "only a qualifying Standard raw result can copy the game command");
  const report = page.copiedTexts.find((value) => value.includes("CS2 SENS / LAB 网页候选筛选结果"));
  assert.match(report, /复测波动/);
  assert.match(report, /历史证据/);
  assert.match(report, /非官方网页模拟，不连接 Aim Lab/);
  assert.match(report, /未经过 CS2 游戏内提升验证/);
});

test("a deterministic fake-clock Standard session can finish all live blocks without frozen countdown state", () => {
  const page = createControllerHarness("success");
  page.submitProfile();
  page.element("startSession").click();
  page.lock();
  let final = page.snapshot();
  for (let frame = 0; frame < 20_000 && final.view !== "result"; frame += 1) {
    page.document.emit("mousemove", { movementX: 12, movementY: 4 });
    page.tick(100);
    final = page.snapshot();
  }
  assert.equal(final.view, "result", "the fake clock should progress through countdown, adaptation, all tasks, and result rendering");
  assert.equal(final.session.status, "complete");
  assert.ok(final.session.blocks >= 9, "a Standard session must finish every balanced coarse block (and may include one boundary extension)");
  assert.equal(final.session.anomalies, 0, "continuous valid fake input must not be invalidated");
  assert.equal(final.rafPending, 0, "a completed session must leave no pending RAF callback");
});

test("controller source is executable, offline, and retains report/copy/history contracts", () => {
  const controller = scriptSource("lab-controller");
  assert.match(labHtml, /<script\b[^>]*\bid=["']lab-controller["'][^>]*>/i, "the v3 DOM controller must be an executable script, not an inert archive");
  assert.match(labHtml, /<script\b(?=[^>]*\bid=["']lab-v2-archive["'])(?=[^>]*\btype=["']text\/plain["'])[^>]*>/i, "legacy v2 remains inert instead of becoming a competing controller");
  assert.doesNotMatch(labHtml, /https?:\/\//i, "the page must run offline without external resources");
  assert.match(controller, /requestPointerLock\(\{\s*unadjustedMovement:\s*true\s*\}\)/, "raw input request must be explicit");
  assert.match(controller, /Core\.createRafScheduler/, "the controller must use the one-RAF core scheduler");
  assert.match(controller, /复测波动/, "results must state measured retest variability");
  assert.match(controller, /历史证据/, "results must state local history evidence");
  assert.match(controller, /copyReport/, "the report-copy action must stay wired");
  assert.match(controller, /copyCommand/, "the command-copy action must stay wired");
  assert.match(controller, /document\.addEventListener\("pointerlockchange"/, "Pointer Lock lifecycle must be wired");
  assert.match(controller, /window\.addEventListener\("blur"/, "focus lifecycle must be wired");
  assert.match(controller, /window\.addEventListener\("resize"/, "resize lifecycle must be wired");
});
