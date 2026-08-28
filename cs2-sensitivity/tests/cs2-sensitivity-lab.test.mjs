import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(workspace, "index.html");
const html = readFileSync(htmlPath, "utf8");

function scriptElements(source = html) {
  return [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => ({
    attributes: match[1],
    source: match[2]
  }));
}

function scriptById(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<script\\b[^>]*\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  assert.ok(match, `missing inline script #${id}`);
  return match[1];
}

function loadCore() {
  const source = scriptById("lab-core");
  const context = vm.createContext({ console });
  new vm.Script(source, { filename: `${htmlPath}#lab-core` }).runInContext(context);
  assert.ok(context.CS2SensLabCore, "lab-core did not export CS2SensLabCore");
  return context.CS2SensLabCore;
}

const Core = loadCore();

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function approximately(actual, expected, tolerance = 1e-9, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message || "values differ"}: expected ${expected}, received ${actual}`
  );
}

function baseProfile(overrides = {}) {
  return {
    dpi: 800,
    currentSens: 1.25,
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

function taskMetrics(factor = 1) {
  return {
    flick: {
      timePerId: 0.72 * factor,
      missRate: 0.08 * factor,
      settleMs: 118 * factor,
      overshootCorrection: 0.18 * factor,
      pathInefficiency: 0.14 * factor
    },
    lateral: {
      timePerId: 0.84 * factor,
      missRate: 0.10 * factor,
      settleMs: 132 * factor,
      overshootCorrection: 0.22 * factor,
      pathInefficiency: 0.17 * factor
    },
    track: {
      rmsError: 1.3 * factor,
      offTargetRatio: 0.28 * factor,
      reacquireMs: 190 * factor,
      speedMismatch: 0.16 * factor
    }
  };
}

function stageBlocks(stage, factorsByPass) {
  const blocks = [];
  for (let pass = 0; pass < stage.passes; pass += 1) {
    stage.candidates.forEach((candidate, candidateIndex) => {
      const factors = factorsByPass[pass];
      const factor = Array.isArray(factors)
        ? factors[candidateIndex]
        : factors[candidate.key];
      blocks.push({
        stageId: stage.id,
        pass,
        candidateKey: candidate.key,
        orderIndex: pass * stage.candidates.length + stage.orders[pass].indexOf(candidate.key),
        valid: true,
        tasks: taskMetrics(factor)
      });
    });
  }
  return blocks;
}

function completeStageBlocks(stage, factorsByPass, inputMode = "raw", startIndex = 0) {
  return stageBlocks(stage, factorsByPass).map((block, index) => {
    const candidate = stage.candidates.find((entry) => entry.key === block.candidateKey);
    return {
      ...block,
      position: stage.orders[block.pass].indexOf(block.candidateKey),
      sensitivity: candidate.sensitivity,
      label: stage.keyToLabel[block.candidateKey],
      seed: stage.passSeeds[block.pass],
      orderIndex: startIndex + index,
      inputMode,
      inputEvents: 240,
      rawDistance: 2400,
      validTaskMs: 75000,
      completedAt: `2026-08-12T00:${String(startIndex + index).padStart(2, "0")}:00.000Z`
    };
  });
}

function completedSessionPayload(core, options = {}) {
  const mode = options.mode ?? "standard";
  const inputMode = options.inputMode ?? "raw";
  const profile = baseProfile({ mode });
  const candidates = core.buildCoarseCandidates(profile, options.prefix ?? "persisted");
  const stage = core.createBalancedStage("coarse", candidates, options.seed ?? 0xA11CE, core.constants.modes[mode].passes, false);
  stage.kind = "coarse";
  stage.searchCenterSensitivity = Number(core.formatSensitivity(core.startingCenter(profile)));
  const factors = options.factors ?? Array.from(
    { length: stage.passes },
    () => [1.15, 0.8, 1.15]
  );
  const blocks = completeStageBlocks(stage, factors, inputMode);
  const session = {
    id: options.id ?? `persisted-${mode}-${inputMode}`,
    version: core.version,
    taskVersion: core.constants.taskVersion,
    profile,
    mode,
    inputMode,
    rawRequested: inputMode === "raw",
    compatibilityRestricted: inputMode === "compat",
    seed: stage.seed,
    confirmation: false,
    stages: [stage],
    stageIndex: 0,
    blocks,
    boundaryExpansionUsed: false,
    boundaryLimited: false,
    status: "paused",
    validTaskMs: blocks.reduce((sum, block) => sum + block.validTaskMs, 0),
    interruptions: [],
    anomalies: (options.anomalies ?? []).slice(),
    createdAt: "2026-08-12T00:00:00.000Z",
    result: null
  };
  return { version: core.version, profile, session, result: null, history: [] };
}

function createVirtualRaf() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    now() {
      return now;
    },
    requestFrame(callback) {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      pending.delete(id);
    },
    frame(ms = 1000 / 60) {
      now += ms;
      const batch = [...pending.values()];
      pending.clear();
      batch.forEach((callback) => callback(now));
    },
    elapse(ms) {
      now += ms;
    },
    pendingCount() {
      return pending.size;
    }
  };
}

function advanceClock(clock, durationMs, maximumFrameMs = 250) {
  let remaining = durationMs;
  while (remaining > 0) {
    const step = Math.min(maximumFrameMs, remaining);
    clock.frame(step);
    remaining -= step;
  }
}

function gaussian(rng) {
  const first = Math.max(Number.EPSILON, rng());
  const second = rng();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    this.listeners.set(type, callbacks.filter((entry) => entry !== callback));
  }

  dispatchEvent(event) {
    const normalized = typeof event === "string" ? { type: event } : event;
    if (!normalized || !normalized.type) throw new Error("fake event requires a type");
    if (!normalized.preventDefault) {
      normalized.preventDefault = () => {
        normalized.defaultPrevented = true;
      };
    }
    if (!normalized.target) normalized.target = this;
    for (const callback of [...(this.listeners.get(normalized.type) ?? [])]) {
      callback.call(this, normalized);
    }
    return !normalized.defaultPrevented;
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(id = "") {
    super();
    this.id = id;
    this.classList = new FakeClassList();
    this.dataset = {};
    const styleValues = new Map();
    this.style = {
      setProperty(name, value) {
        styleValues.set(name, String(value));
      },
      getPropertyValue(name) {
        return styleValues.get(name) ?? "";
      }
    };
    this.attributes = new Map();
    this.children = [];
    this._value = "";
    Object.defineProperty(this, "value", {
      configurable: true,
      enumerable: true,
      get() { return this._value; },
      set(value) { this._value = String(value); }
    });
    this.name = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.onclick = null;
    this.clientWidth = 0;
    this.clientHeight = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    return child;
  }

  click() {
    if (this.disabled) return;
    const event = {
      type: "click",
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    if (typeof this.onclick === "function") this.onclick.call(this, event);
    this.dispatchEvent(event);
  }

  select() {}
  remove() {}
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.pointerLockElement = null;
    this.hidden = false;
    this.documentElement = new FakeElement("documentElement");
    this.body = new FakeElement("body");
    this.elements = new Map();
    this.views = [];
    this.stepDots = [];
    this.execCommandResult = true;

    const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
    ids.forEach((id) => this.elements.set(id, new FakeElement(id)));

    const inputValues = {
      dpi: "800",
      currentSens: "",
      padWidth: "45",
      polling: "1000",
      mYaw: "0.022",
      mPitch: "0.022"
    };
    Object.entries(inputValues).forEach(([id, value]) => {
      this.getElementById(id).value = value;
    });

    const radios = [
      ["aim-wrist", "aimStyle", "wrist", false],
      ["aim-hybrid", "aimStyle", "hybrid", true],
      ["aim-arm", "aimStyle", "arm", false],
      ["role-entry", "role", "entry", false],
      ["role-rifle", "role", "rifle", true],
      ["role-awp", "role", "awp", false],
      ["priority-speed", "priority", "speed", false],
      ["priority-balance", "priority", "balance", true],
      ["priority-control", "priority", "control", false],
      ["mode-express", "mode", "express", true],
      ["mode-quick", "mode", "quick", false],
      ["mode-standard", "mode", "standard", false],
      ["mode-deep", "mode", "deep", false]
    ];
    radios.forEach(([id, name, value, checked]) => {
      const element = this.getElementById(id);
      element.name = name;
      element.value = value;
      element.checked = checked;
    });

    [["view-profile", "profile"], ["view-lab", "lab"], ["view-result", "result"]].forEach(([id, view]) => {
      const element = this.getElementById(id);
      element.dataset.view = view;
      this.views.push(element);
    });
    ["profile", "lab", "result"].forEach((step) => {
      const element = new FakeElement(`step-${step}`);
      element.dataset.step = step;
      this.stepDots.push(element);
    });

    const arena = this.getElementById("arena");
    arena.clientWidth = 1280;
    arena.clientHeight = 720;
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  querySelector(selector) {
    const checked = selector.match(/^input\[name="([^"]+)"\]:checked$/);
    if (checked) {
      return [...this.elements.values()].find((element) => element.name === checked[1] && element.checked) ?? null;
    }
    const value = selector.match(/^input\[name="([^"]+)"\]\[value="([^"]+)"\]$/);
    if (value) {
      return [...this.elements.values()].find((element) => element.name === value[1] && element.value === value[2]) ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === ".view") return this.views;
    if (selector === ".step-dot") return this.stepDots;
    return [];
  }

  createElement() {
    return new FakeElement();
  }

  execCommand() {
    return this.execCommandResult;
  }
}

class FakeStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(String(key)) ?? null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }
}

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAppHarness(options = {}) {
  const document = new FakeDocument();
  const storage = new FakeStorage();
  const clock = createVirtualRaf();
  const epochMs = Date.parse("2026-08-20T00:00:00.000Z");
  class HarnessDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(epochMs + clock.now());
    }
    static now() {
      return epochMs + clock.now();
    }
  }
  const window = new FakeEventTarget();
  const visualViewport = new FakeEventTarget();
  const errors = [];
  const pointerCalls = [];
  const rawRequests = [];
  const compatRequests = [];
  const clipboardWrites = [];
  let timerId = 1;
  let pointerExitRequested = false;
  const timers = new Map();

  Object.assign(window, {
    document,
    devicePixelRatio: 1,
    visualViewport,
    crypto: {
      getRandomValues(values) {
        values[0] = 0x1234ABCD;
        return values;
      }
    },
    requestAnimationFrame: (callback) => clock.requestFrame(callback),
    cancelAnimationFrame: (id) => clock.cancelFrame(id),
    setTimeout(callback, delay = 0) {
      const id = timerId;
      timerId += 1;
      timers.set(id, { callback, dueAt: clock.now() + Number(delay || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    scrollTo() {}
  });

  const arena = document.getElementById("arena");
  arena.requestPointerLock = (requestOptions) => {
    const call = { options: requestOptions ? plain(requestOptions) : undefined };
    pointerCalls.push(call);
    if (requestOptions?.unadjustedMovement) {
      const deferred = deferredPromise();
      call.deferred = deferred;
      rawRequests.push(deferred);
      return deferred.promise;
    }
    if (options.compatPromise) {
      const deferred = deferredPromise();
      call.deferred = deferred;
      compatRequests.push(deferred);
      return deferred.promise;
    }
    return undefined;
  };
  function completePointerExit() {
    pointerExitRequested = false;
    document.pointerLockElement = null;
    document.dispatchEvent({ type: "pointerlockchange" });
  }
  document.exitPointerLock = () => {
    pointerExitRequested = true;
    if (!options.deferPointerExit) completePointerExit();
  };
  document.execCommandResult = options.execCommandResult ?? true;

  const navigator = {
    clipboard: {
      writeText(value) {
        clipboardWrites.push(String(value));
        return options.clipboardReject ? Promise.reject(new Error("clipboard denied")) : Promise.resolve();
      }
    }
  };
  const location = { hash: "" };
  const sandbox = {
    window,
    document,
    navigator,
    localStorage: storage,
    location,
    Date: HarnessDate,
    performance: { now: () => clock.now() },
    console: {
      log() {},
      info() {},
      warn() {},
      error(...values) {
        errors.push(values);
      }
    }
  };
  const context = vm.createContext(sandbox);
  new vm.Script(scriptById("lab-core"), { filename: `${htmlPath}#lab-core` }).runInContext(context);
  window.CS2SensLabCore = context.CS2SensLabCore;

  if (options.preload) {
    const payload = options.preload(context.CS2SensLabCore);
    storage.setItem(context.CS2SensLabCore.constants.storageKey, JSON.stringify(payload));
  }

  new vm.Script(scriptById("lab-app"), { filename: `${htmlPath}#lab-app` }).runInContext(context);

  return {
    window,
    document,
    elements: document.elements,
    storage,
    clock,
    errors,
    pointerCalls,
    rawRequests,
    compatRequests,
    clipboardWrites,
    app: window.CS2SensLab,
    diagnostics() {
      return plain(window.CS2SensLab.getDiagnostics());
    },
    selectMode(mode) {
      ["express", "quick", "standard", "deep"].forEach((value) => {
        document.getElementById(`mode-${value}`).checked = value === mode;
      });
    },
    submitProfile(mode = "standard") {
      this.selectMode(mode);
      document.getElementById("profileForm").dispatchEvent({ type: "submit" });
    },
    start() {
      document.getElementById("startSession").click();
    },
    acquirePointer() {
      document.pointerLockElement = arena;
      document.dispatchEvent({ type: "pointerlockchange" });
    },
    losePointer() {
      document.pointerLockElement = null;
      document.dispatchEvent({ type: "pointerlockchange" });
    },
    completePointerExit,
    pointerExitRequested() {
      return pointerExitRequested;
    },
    advanceTimers(ms) {
      clock.elapse(ms);
      let ranTimer;
      do {
        ranTimer = false;
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= clock.now())
          .sort((first, second) => first[1].dueAt - second[1].dueAt || first[0] - second[0]);
        for (const [id, timer] of due) {
          if (!timers.delete(id)) continue;
          timer.callback();
          ranTimer = true;
        }
      } while (ranTimer);
    },
    async flushPromises() {
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

async function startRawApp(mode = "standard") {
  const harness = createAppHarness();
  harness.submitProfile(mode);
  harness.start();
  harness.rawRequests[0].resolve();
  await harness.flushPromises();
  harness.acquirePointer();
  return harness;
}

async function reachFirstTask(mode = "express") {
  const harness = await startRawApp(mode);
  advanceClock(harness.clock, 3000);
  advanceClock(harness.clock, Core.constants.modes[mode].adaptMs);
  assert.equal(harness.diagnostics().activePhase, "task");
  assert.equal(harness.diagnostics().activeTask, "flick");
  return harness;
}

function moveToActiveTarget(harness) {
  const diagnostics = harness.diagnostics();
  assert.ok(diagnostics.activeTarget, "an active target is required");
  const sensitivity = diagnostics.activeCandidateSensitivity;
  const yawDelta = Core.wrapAngle(diagnostics.activeTarget.yaw - diagnostics.activeCamera.yaw);
  const pitchDelta = diagnostics.activeTarget.pitch - diagnostics.activeCamera.pitch;
  harness.document.dispatchEvent({
    type: "mousemove",
    movementX: yawDelta / (sensitivity * 0.022),
    movementY: -pitchDelta / (sensitivity * 0.022)
  });
}

function addInputSamples(harness, count = 20) {
  for (let index = 0; index < count; index += 1) {
    harness.document.dispatchEvent({
      type: "mousemove",
      movementX: index % 2 === 0 ? 5 : -5,
      movementY: index % 3 === 0 ? 3 : -3
    });
  }
}

function advanceActivePhase(harness) {
  const end = harness.diagnostics().activePhaseEndsAt;
  assert.ok(Number.isFinite(end), "an active phase deadline is required");
  advanceClock(harness.clock, Math.max(0, end - harness.clock.now()));
}

function completeStaticTask(harness, hitCount) {
  for (let index = 0; index < hitCount; index += 1) {
    moveToActiveTarget(harness);
    harness.clock.frame(Core.constants.dwellMs);
    if (index < hitCount - 1) harness.clock.frame(120);
  }
  advanceActivePhase(harness);
}

function completeLiveExpressBlock(harness, options = {}) {
  const staticHits = options.staticHits ?? 2;
  assert.equal(harness.diagnostics().activePhase, "countdown");
  advanceActivePhase(harness);
  assert.equal(harness.diagnostics().activePhase, "adapt");
  addInputSamples(harness, 24);
  advanceActivePhase(harness);

  assert.equal(harness.diagnostics().activeTask, "flick");
  completeStaticTask(harness, staticHits);
  assert.equal(harness.diagnostics().activePhase, "intermission");
  advanceActivePhase(harness);

  assert.equal(harness.diagnostics().activeTask, "track");
  addInputSamples(harness, 12);
  advanceActivePhase(harness);
  assert.equal(harness.diagnostics().activePhase, "intermission");
  advanceActivePhase(harness);

  assert.equal(harness.diagnostics().activeTask, "lateral");
  completeStaticTask(harness, staticHits);
}

async function resumePersistedSessionToResult(harness, inputMode) {
  harness.start();
  if (inputMode === "raw") {
    assert.equal(harness.rawRequests.length, 1);
    harness.rawRequests[0].resolve();
    await harness.flushPromises();
  }
  harness.acquirePointer();
  return harness.diagnostics();
}

test("lab-core is extracted from the real HTML and exposes a frozen, DOM-free API", () => {
  const coreTags = scriptElements().filter(({ attributes }) => /\bid=["']lab-core["']/i.test(attributes));
  assert.equal(coreTags.length, 1);
  assert.equal(Object.isFrozen(Core), true);
  assert.equal(Object.isFrozen(Core.constants), true);
  assert.equal(Object.isFrozen(Core.constants.modes), true);
  assert.equal(Core.version, "3.0.0");
  assert.equal(Core.constants.taskVersion, "angles-3.1.0");
  assert.equal(Core.constants.storageKey, "cs2-sens-lab-v3");
  assert.doesNotMatch(scriptById("lab-core"), /\b(?:document|localStorage|requestAnimationFrame)\b/);
});

test("all executable inline scripts have valid JavaScript syntax", () => {
  for (const [index, script] of scriptElements().entries()) {
    const type = script.attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (type && !["text/javascript", "application/javascript", "module"].includes(type)) continue;
    if (type === "module") continue;
    assert.doesNotThrow(
      () => new vm.Script(script.source, { filename: `${htmlPath}#script-${index + 1}` }),
      `inline script ${index + 1} is invalid`
    );
  }
});

test("lab-app initializes against the real core without console errors", () => {
  const harness = createAppHarness();
  const diagnostics = harness.diagnostics();

  assert.equal(harness.app.version, "3.0.0");
  assert.equal(diagnostics.view, "profile");
  assert.equal(diagnostics.active, false);
  assert.equal(diagnostics.pendingRaf, 0);
  assert.deepEqual(harness.errors, []);
  assert.equal(harness.app.runSelfTests(), "CS2 SENS / LAB v3 smoke tests passed.");
});

test("an invalid completed fast result falls back to the profile instead of a disabled resume screen", () => {
  const harness = createAppHarness({
    preload: (core) => {
      const payload = completedSessionPayload(core, { mode: "express", inputMode: "raw", id: "invalid-fast-result" });
      payload.session.status = "complete";
      const candidates = payload.session.stages[0].candidates;
      payload.result = {
        algorithmVersion: core.version,
        taskVersion: core.constants.taskVersion,
        sessionId: payload.session.id,
        profile: payload.profile,
        mode: "express",
        range: candidates,
        testedCandidates: candidates,
        evaluation: { pairwise: [] },
        evidence: "极速粗筛"
      };
      payload.session.result = payload.result;
      return payload;
    }
  });
  const diagnostics = harness.diagnostics();
  assert.equal(diagnostics.view, "profile");
  assert.equal(diagnostics.sessionStatus, null);
  assert.equal(diagnostics.resultMode, null);
  assert.equal(diagnostics.active, false);
});

test("the default profile builds one balanced Express pass with three blind candidates", () => {
  const harness = createAppHarness();
  harness.document.getElementById("currentSens").value = "1.25";
  harness.document.getElementById("profileForm").dispatchEvent({ type: "submit" });

  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  const stage = stored.session.stages[0];
  assert.equal(diagnostics.view, "lab");
  assert.equal(diagnostics.mode, "express");
  assert.equal(stage.passes, 1);
  assert.equal(stage.candidates.length, 3);
  assert.deepEqual(stage.candidates.map((candidate) => candidate.sensitivity), [1.042, 1.25, 1.5]);
  assert.deepEqual(stage.orders[0].map((key) => stage.keyToLabel[key]).sort(), ["A", "B", "C"]);
  assert.equal(harness.elements.get("completionText").textContent, "0 / 3");
  assert.equal(stored.result, null);
});

test("a tied Express result keeps the real search center and repeats the same centered grid", async () => {
  const harness = createAppHarness({
    preload: (core) => completedSessionPayload(core, {
      mode: "express",
      inputMode: "raw",
      id: "tied-express",
      factors: [[1, 1, 1]]
    })
  });
  await resumePersistedSessionToResult(harness, "raw");
  const diagnostics = harness.diagnostics();
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.fastDirection, "unclear");
  assert.equal(diagnostics.fastNextCenter, 1.25);
  assert.equal(harness.elements.get("repeatFast").textContent, "同中心再跑约 100 秒");
  assert.equal(harness.elements.get("copyCommand").disabled, true);
  assert.equal(diagnostics.resultRange.length, 3);

  harness.elements.get("repeatFast").click();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(stored.profile.currentSens, 1.25);
  assert.deepEqual(stored.session.stages[0].candidates.map((candidate) => candidate.sensitivity), [1.042, 1.25, 1.5]);
  assert.equal(stored.session.stages[0].searchCenterSensitivity, 1.25);
});

test("a live Express flow completes three valid candidates in 97.8 seconds and renders an actionable no-command result", async () => {
  const harness = await startRawApp("express");
  for (let index = 0; index < 3; index += 1) {
    completeLiveExpressBlock(harness, { staticHits: 2 });
    if (index < 2) assert.equal(harness.diagnostics().completedBlocks, index + 1);
  }

  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.clock.now(), 97_800);
  assert.ok(harness.clock.now() < Core.constants.modes.express.budgetMs);
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.resultMode, "express");
  assert.equal(diagnostics.completedBlocks, 3);
  assert.equal(stored.session.validTaskMs, 72_000);
  assert.equal(diagnostics.testedCandidateCount, 3);
  assert.equal(diagnostics.resultRange.length, 3);
  assert.equal(diagnostics.hasMain, false);
  assert.equal(diagnostics.insufficient, false);
  assert.equal(diagnostics.evidence, "极速粗筛");
  const stageSensitivities = stored.session.stages[0].candidates.map((candidate) => candidate.sensitivity).sort((a, b) => a - b);
  assert.deepEqual(diagnostics.resultRange.slice().sort((a, b) => a - b), stageSensitivities);
  assert.deepEqual(stored.result.testedCandidates.map((candidate) => candidate.sensitivity).sort((a, b) => a - b), stageSensitivities);
  assert.deepEqual(stored.result.finalGrid.slice().sort((a, b) => a - b), stageSensitivities);
  assert.equal(harness.elements.get("progressTrack").getAttribute("aria-valuenow"), "100");
  assert.equal(harness.elements.get("copyCommand").disabled, true);
  assert.equal(harness.elements.get("commandText").textContent, "极速方向筛选不提供单一命令");
  assert.equal(harness.elements.get("fastGuide").hidden, false);
  assert.match(harness.elements.get("resultUnit").textContent, /下一轮搜索中心 .*不是最终推荐/);
  assert.match(harness.elements.get("taskSummary").innerHTML, /未估计复测 MAD/);
  assert.doesNotMatch(harness.elements.get("taskSummary").innerHTML, /MAD 中位 .*0\.00%/);
  assert.match(harness.elements.get("gameReviewList").innerHTML, /没有可粘贴的 sensitivity 命令/);
  assert.equal(stored.history.at(-1).eligible, false);
  assert.equal(harness.elements.get("confirmSession").hidden, true);

  const report = harness.app.reportText();
  assert.match(report, /粗筛方向：/);
  assert.match(report, /下一轮搜索中心：/);
  assert.match(report, /单轮边界：未估计复测 MAD/);
  assert.doesNotMatch(report, /复测波动（配对 MAD/);

  const previousSessionId = stored.session.id;
  const previousHistoryCount = diagnostics.historyCount;
  const expectedCenter = diagnostics.fastNextCenter;
  harness.elements.get("repeatFast").click();
  const restarted = harness.diagnostics();
  const restartedState = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(restarted.view, "lab");
  assert.equal(restarted.mode, "express");
  assert.equal(restarted.completedBlocks, 0);
  assert.equal(restarted.historyCount, previousHistoryCount);
  assert.notEqual(restartedState.session.id, previousSessionId);
  assert.equal(restartedState.profile.currentSens, Number(Core.formatSensitivity(expectedCenter)));
  assert.deepEqual(
    restartedState.session.stages[0].candidates.map((candidate) => candidate.sensitivity),
    plain(Core.buildCoarseCandidates(restartedState.profile, "expected-repeat").map((candidate) => candidate.sensitivity))
  );
  assert.equal(restartedState.session.expressStartedAt, null);
  assert.equal(restartedState.session.expressDeadlineAt, null);
  assert.equal(restartedState.result, null);
  assert.equal(harness.elements.get("completionText").textContent, "0 / 3");

  harness.start();
  harness.rawRequests[1].resolve();
  await harness.flushPromises();
  harness.acquirePointer();
  const startedRepeat = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.diagnostics().active, true);
  assert.equal(harness.diagnostics().inputMode, "raw");
  assert.ok(startedRepeat.session.stages[0].candidates.some((candidate) => candidate.sensitivity === harness.diagnostics().activeCandidateSensitivity));
  assert.equal(startedRepeat.session.expressDeadlineAt - startedRepeat.session.expressStartedAt, 120_000);
});

test("Express keeps zero-hit candidates as worst evidence instead of retrying forever", async () => {
  const harness = await startRawApp("express");
  for (let index = 0; index < 3; index += 1) completeLiveExpressBlock(harness, { staticHits: 0 });
  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.clock.now(), 97_800);
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.completedBlocks, 3);
  assert.equal(diagnostics.anomalyCount, 0);
  assert.equal(diagnostics.hasMain, false);
  assert.equal(harness.elements.get("copyCommand").disabled, true);
  for (const block of stored.session.blocks) {
    for (const task of ["flick", "lateral"]) {
      assert.equal(block.tasks[task].hits, 0);
      assert.ok(block.tasks[task].misses > 0);
      assert.equal(block.tasks[task].missRate, 1);
      assert.equal(block.tasks[task].timePerId, Core.constants.modes.express.taskMs);
      assert.equal(block.tasks[task].settleMs, Core.constants.modes.express.taskMs);
      assert.equal(block.tasks[task].pathInefficiency, 3);
    }
  }
});

test("the Express result can carry its evidence-based next center into a clean Quick session", async () => {
  const harness = await startRawApp("express");
  for (let index = 0; index < 3; index += 1) completeLiveExpressBlock(harness, { staticHits: 2 });
  const expectedCenter = harness.diagnostics().fastNextCenter;
  const oldSessionId = JSON.parse(harness.storage.getItem(Core.constants.storageKey)).session.id;

  harness.elements.get("upgradeFast").click();
  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(diagnostics.view, "lab");
  assert.equal(diagnostics.mode, "quick");
  assert.equal(diagnostics.completedBlocks, 0);
  assert.equal(stored.profile.currentSens, Number(Core.formatSensitivity(expectedCenter)));
  assert.equal(stored.session.stages[0].passes, 1);
  assert.equal(stored.session.stages[0].candidates.length, 3);
  assert.deepEqual(
    stored.session.stages[0].candidates.map((candidate) => candidate.sensitivity),
    plain(Core.buildCoarseCandidates(stored.profile, "expected-quick").map((candidate) => candidate.sensitivity))
  );
  assert.equal(stored.session.expressStartedAt, null);
  assert.equal(stored.session.expressDeadlineAt, null);
  assert.notEqual(stored.session.id, oldSessionId);
  assert.equal(stored.result, null);

  harness.start();
  harness.rawRequests[1].resolve();
  await harness.flushPromises();
  harness.acquirePointer();
  const startedQuick = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.diagnostics().active, true);
  assert.equal(harness.diagnostics().inputMode, "raw");
  assert.ok(startedQuick.session.stages[0].candidates.some((candidate) => candidate.sensitivity === harness.diagnostics().activeCandidateSensitivity));
  assert.equal(startedQuick.session.expressStartedAt, null);
  assert.equal(startedQuick.session.expressDeadlineAt, null);
});

test("an input-starved Express block ends honestly before the 120 second budget instead of looping", async () => {
  const harness = await startRawApp("express");
  advanceActivePhase(harness);
  advanceActivePhase(harness);
  advanceActivePhase(harness);
  advanceActivePhase(harness);
  advanceActivePhase(harness);
  advanceActivePhase(harness);
  advanceActivePhase(harness);

  const diagnostics = harness.diagnostics();
  assert.ok(harness.clock.now() < 120_000);
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.insufficient, true);
  assert.equal(diagnostics.fastDirection, "unclear");
  assert.equal(diagnostics.completedBlocks, 0);
  assert.equal(diagnostics.testedCandidateCount, 0);
  assert.equal(diagnostics.resultRange.length, 3);
  assert.equal(harness.elements.get("copyCommand").disabled, true);
  assert.match(harness.elements.get("rangeCopy").textContent, /未完整测试三个候选/);
  assert.match(harness.elements.get("rangeList").innerHTML, /未完成/);
});

test("Express has a real 120 second wall-clock cutoff even while RAF progression is paused", async () => {
  const harness = await startRawApp("express");
  assert.equal(harness.diagnostics().active, true);
  harness.advanceTimers(Core.constants.modes.express.budgetMs - 1);
  assert.equal(harness.clock.now(), 119_999);
  assert.equal(harness.diagnostics().view, "lab");
  assert.equal(harness.diagnostics().active, true);
  assert.equal(harness.diagnostics().insufficient, false);

  harness.advanceTimers(1);

  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.clock.now(), 120_000);
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.active, false);
  assert.equal(diagnostics.pendingRaf, 0);
  assert.equal(diagnostics.insufficient, true);
  assert.equal(diagnostics.fastDirection, "unclear");
  assert.equal(stored.session.status, "complete");
  assert.equal(stored.session.activeBlock, null);
  assert.equal(stored.history.at(-1).eligible, false);
  assert.equal(harness.document.pointerLockElement, null);
  assert.match(harness.elements.get("fastGuideCopy").textContent, /120 秒硬截止/);
});

test("the RAF deadline branch independently seals Express at exactly 120 seconds", async () => {
  const harness = await startRawApp("express");
  harness.clock.elapse(119_999);
  assert.equal(harness.diagnostics().view, "lab");
  assert.equal(harness.diagnostics().active, true);

  harness.clock.frame(1);
  assert.equal(harness.clock.now(), 120_000);
  assert.equal(harness.diagnostics().view, "result");
  assert.equal(harness.diagnostics().insufficient, true);
  assert.equal(harness.diagnostics().pendingRaf, 0);
  assert.equal(harness.diagnostics().historyCount, 1);
  harness.advanceTimers(0);
  assert.equal(harness.diagnostics().historyCount, 1, "the cleared wall timer must not finalize the same session twice");
});

test("a cutoff after one valid Express candidate keeps only that candidate as tested evidence", async () => {
  const harness = await startRawApp("express");
  completeLiveExpressBlock(harness, { staticHits: 2 });
  assert.equal(harness.diagnostics().completedBlocks, 1);
  harness.advanceTimers(Core.constants.modes.express.budgetMs - harness.clock.now());

  const diagnostics = harness.diagnostics();
  assert.equal(harness.clock.now(), 120_000);
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.insufficient, true);
  assert.equal(diagnostics.testedCandidateCount, 1);
  assert.equal(diagnostics.resultRange.length, 3);
  assert.equal(diagnostics.fastDirection, "unclear");
  assert.equal((harness.elements.get("rangeList").innerHTML.match(/已完成/g) || []).length, 1);
  assert.equal((harness.elements.get("rangeList").innerHTML.match(/未完成/g) || []).length, 2);
  assert.equal(harness.elements.get("copyCommand").disabled, true);
});

test("leaving an active Express session abandons its timer and cannot navigate away from the profile later", async () => {
  const harness = await startRawApp("express");
  harness.elements.get("backToProfile").click();
  assert.equal(harness.diagnostics().view, "profile");
  harness.advanceTimers(130_000);

  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(diagnostics.view, "profile");
  assert.equal(diagnostics.resultMode, null);
  assert.equal(diagnostics.mode, null);
  assert.equal(diagnostics.historyCount, 0);
  assert.equal(stored.session, null);
  assert.equal(stored.result, null);
});

test("a deadline atomically cancels a pending raw handshake so late callbacks cannot duplicate history", async () => {
  const harness = await startRawApp("express");
  harness.window.dispatchEvent({ type: "blur" });
  harness.advanceTimers(118_000);
  harness.start();
  assert.equal(harness.rawRequests.length, 2);
  assert.equal(harness.diagnostics().awaitingLock, true);

  harness.advanceTimers(2_000);
  assert.equal(harness.diagnostics().view, "result");
  assert.equal(harness.diagnostics().awaitingLock, false);
  assert.equal(harness.diagnostics().historyCount, 1);

  harness.rawRequests[1].resolve();
  await harness.flushPromises();
  harness.acquirePointer();
  assert.equal(harness.diagnostics().view, "result");
  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().historyCount, 1);
  assert.equal(harness.document.pointerLockElement, null);
});

test("rebuilding compatibility input clears the old Express deadline before the new session starts", async () => {
  const harness = createAppHarness({ compatPromise: true });
  harness.submitProfile("express");
  harness.start();
  harness.rawRequests[0].resolve();
  await harness.flushPromises();
  harness.acquirePointer();
  harness.window.dispatchEvent({ type: "blur" });
  harness.advanceTimers(118_000);

  harness.start();
  harness.rawRequests[1].reject(new Error("raw denied"));
  await harness.flushPromises();
  harness.elements.get("overlayAction").click();
  assert.equal(harness.compatRequests.length, 1);
  assert.equal(harness.diagnostics().awaitingLock, true);
  harness.advanceTimers(2_000);
  assert.equal(harness.clock.now(), 120_000);
  assert.equal(harness.diagnostics().view, "lab");
  assert.equal(harness.diagnostics().insufficient, false);
  assert.equal(harness.diagnostics().completedBlocks, 0);

  harness.acquirePointer();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.diagnostics().active, true);
  assert.equal(harness.diagnostics().inputMode, "compat");
  assert.equal(stored.session.expressStartedAt, Date.parse("2026-08-20T00:00:00.000Z") + 120_000);
  assert.equal(stored.session.expressDeadlineAt - stored.session.expressStartedAt, 120_000);
});

test("a persisted Express deadline survives refresh and cannot reset the two-minute budget", () => {
  const harness = createAppHarness({
    preload: (core) => {
      const payload = completedSessionPayload(core, { mode: "express", inputMode: "raw", id: "persisted-deadline" });
      payload.session.blocks = payload.session.blocks.slice(0, 1);
      payload.session.validTaskMs = payload.session.blocks[0].validTaskMs;
      payload.session.status = "paused";
      payload.session.expressStartedAt = Date.parse("2026-08-19T23:58:01.000Z");
      payload.session.expressDeadlineAt = Date.parse("2026-08-20T00:00:01.000Z");
      return payload;
    }
  });
  assert.equal(harness.diagnostics().view, "lab");
  assert.equal(harness.diagnostics().completedBlocks, 1);
  harness.advanceTimers(999);
  assert.equal(harness.diagnostics().view, "lab");
  assert.equal(harness.diagnostics().insufficient, false);
  harness.advanceTimers(1);
  assert.equal(harness.diagnostics().view, "result");
  assert.equal(harness.diagnostics().insufficient, true);
  assert.equal(harness.diagnostics().testedCandidateCount, 1);
});

test("a compatibility Express session completes the full range without a command or stable history", async () => {
  const harness = createAppHarness({ compatPromise: true });
  harness.submitProfile("express");
  harness.start();
  harness.rawRequests[0].reject(new Error("raw denied"));
  await harness.flushPromises();
  harness.elements.get("overlayAction").click();
  harness.acquirePointer();
  assert.equal(harness.diagnostics().inputMode, "compat");

  for (let index = 0; index < 3; index += 1) completeLiveExpressBlock(harness, { staticHits: 2 });
  const diagnostics = harness.diagnostics();
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(harness.clock.now(), 97_800);
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.inputMode, "compat");
  assert.equal(diagnostics.evidence, "兼容估算");
  assert.equal(diagnostics.testedCandidateCount, 3);
  assert.equal(diagnostics.resultRange.length, 3);
  assert.equal(diagnostics.hasMain, false);
  assert.equal(harness.elements.get("copyCommand").disabled, true);
  assert.equal(stored.history.at(-1).eligible, false);
});

test("raw input starts only after both Promise confirmation and pointerlockchange", async () => {
  const promiseFirst = createAppHarness();
  promiseFirst.submitProfile();
  promiseFirst.start();
  promiseFirst.start();
  assert.equal(promiseFirst.pointerCalls.length, 1, "duplicate Start must not request Pointer Lock twice");
  assert.deepEqual(promiseFirst.pointerCalls[0].options, { unadjustedMovement: true });

  promiseFirst.rawRequests[0].resolve();
  await promiseFirst.flushPromises();
  assert.equal(promiseFirst.diagnostics().active, false, "Promise alone must not start a block");
  assert.equal(promiseFirst.diagnostics().pendingRaf, 0);
  assert.equal(promiseFirst.diagnostics().awaitingLock, true);

  promiseFirst.acquirePointer();
  assert.equal(promiseFirst.diagnostics().active, true);
  assert.equal(promiseFirst.diagnostics().rawConfirmed, true);
  assert.equal(promiseFirst.diagnostics().pendingRaf, 1);
  promiseFirst.start();
  assert.equal(promiseFirst.pointerCalls.length, 1);
  assert.equal(promiseFirst.diagnostics().pendingRaf, 1, "active duplicate Start must not add a RAF");

  const lockFirst = createAppHarness();
  lockFirst.submitProfile();
  lockFirst.start();
  lockFirst.acquirePointer();
  assert.equal(lockFirst.diagnostics().active, false, "pointerlockchange alone must not start a raw block");
  assert.equal(lockFirst.diagnostics().pendingRaf, 0);
  assert.equal(lockFirst.diagnostics().awaitingLock, true);

  lockFirst.rawRequests[0].resolve();
  await lockFirst.flushPromises();
  assert.equal(lockFirst.diagnostics().active, true);
  assert.equal(lockFirst.diagnostics().rawConfirmed, true);
  assert.equal(lockFirst.diagnostics().pendingRaf, 1);
});

test("an unlocked change after raw Promise resolution exits the handshake through the compatibility CTA", async () => {
  const harness = createAppHarness();
  harness.submitProfile("standard");
  harness.start();
  harness.rawRequests[0].resolve();
  await harness.flushPromises();
  assert.equal(harness.diagnostics().awaitingLock, true);
  assert.equal(harness.diagnostics().active, false);

  harness.losePointer();
  assert.equal(harness.diagnostics().awaitingLock, false);
  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().pendingRaf, 0);
  assert.match(harness.elements.get("overlayAction").textContent, /兼容粗筛/);
});

test("leaving the lab cancels a pending raw lock so late browser callbacks cannot start or contaminate a new session", async () => {
  const harness = createAppHarness();
  harness.submitProfile("standard");
  harness.start();
  assert.equal(harness.rawRequests.length, 1);
  assert.equal(harness.diagnostics().awaitingLock, true);

  harness.elements.get("backToProfile").click();
  assert.equal(harness.diagnostics().view, "profile");
  assert.equal(harness.diagnostics().awaitingLock, false);
  assert.equal(harness.diagnostics().active, false);

  harness.elements.get("currentSens").value = "2.000";
  harness.submitProfile("standard");
  const fresh = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  const freshSessionId = fresh.session.id;
  assert.equal(fresh.session.inputMode, "pending");
  assert.equal(fresh.session.blocks.length, 0);

  harness.rawRequests[0].resolve();
  await harness.flushPromises();
  harness.acquirePointer();

  const afterLateCallbacks = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(afterLateCallbacks.session.id, freshSessionId, "a late callback must not replace the newly-created session");
  assert.equal(afterLateCallbacks.session.inputMode, "pending", "a stale raw Promise must not confirm the new session");
  assert.equal(afterLateCallbacks.session.blocks.length, 0);
  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().pendingRaf, 0);
  assert.equal(harness.diagnostics().awaitingLock, false);
  assert.equal(harness.document.pointerLockElement, null, "a stale lock acquisition must be released immediately");
});

test("pausing during a pending raw request invalidates that attempt before any late Promise or lock event", async () => {
  const harness = createAppHarness();
  harness.submitProfile("standard");
  harness.start();
  harness.elements.get("pauseSession").click();

  assert.equal(harness.diagnostics().awaitingLock, false);
  assert.equal(harness.diagnostics().sessionStatus, "paused");
  harness.rawRequests[0].resolve();
  await harness.flushPromises();
  harness.acquirePointer();

  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().pendingRaf, 0);
  assert.equal(harness.diagnostics().inputMode, "pending");
  assert.equal(harness.document.pointerLockElement, null);

  harness.start();
  assert.equal(harness.rawRequests.length, 2, "the resumed session must require a fresh raw-input handshake");
});

test("a rejected compatibility Pointer Lock Promise clears awaiting state without console errors", async () => {
  const harness = createAppHarness({
    compatPromise: true,
    preload: (core) => completedSessionPayload(core, { mode: "quick", inputMode: "compat", id: "compat-reject" })
  });
  harness.start();
  assert.equal(harness.compatRequests.length, 1);
  assert.equal(harness.diagnostics().awaitingLock, true);
  harness.compatRequests[0].reject(new Error("compat denied"));
  await harness.flushPromises();

  assert.equal(harness.diagnostics().awaitingLock, false);
  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().pendingRaf, 0);
  assert.match(harness.elements.get("overlayTitle").textContent, /兼容 Pointer Lock 也未能建立/);
  assert.deepEqual(harness.errors, []);
});

test("raw and compatibility lock handshakes fail closed after 2.5 seconds", () => {
  const raw = createAppHarness();
  raw.submitProfile("standard");
  raw.start();
  raw.advanceTimers(2499);
  assert.equal(raw.diagnostics().awaitingLock, true);
  raw.advanceTimers(1);
  assert.equal(raw.diagnostics().awaitingLock, false);
  assert.match(raw.elements.get("overlayAction").textContent, /兼容粗筛/);

  const compat = createAppHarness({
    preload: (core) => completedSessionPayload(core, { mode: "quick", inputMode: "compat", id: "compat-timeout" })
  });
  compat.start();
  compat.advanceTimers(2499);
  assert.equal(compat.diagnostics().awaitingLock, true);
  compat.advanceTimers(1);
  assert.equal(compat.diagnostics().awaitingLock, false);
  assert.match(compat.elements.get("overlayTitle").textContent, /兼容 Pointer Lock 也未能建立/);
});

test("mouse-down moves the rendered reticle down without moving the static target", async () => {
  const harness = await startRawApp();
  advanceClock(harness.clock, 3000);

  const target = harness.elements.get("sceneTarget");
  const reticle = harness.elements.get("virtualCrosshair");
  const targetBefore = { left: target.style.left, top: target.style.top };
  assert.notEqual(targetBefore.left, undefined);
  assert.notEqual(targetBefore.top, undefined);

  harness.document.dispatchEvent({ type: "mousemove", movementX: 0, movementY: 10 });

  assert.ok(parseFloat(reticle.style.getPropertyValue("--reticle-y")) > 0, "positive movementY must render below center");
  assert.deepEqual({ left: target.style.left, top: target.style.top }, targetBefore);
  assert.equal(harness.diagnostics().pendingRaf, 1);
});

test("a 351ms first RAF gap invalidates immediately instead of advancing a frozen countdown", async () => {
  const harness = await startRawApp();
  harness.clock.frame(351);

  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().pendingRaf, 0);
  assert.equal(harness.diagnostics().sessionStatus, "paused");
  assert.equal(harness.diagnostics().anomalyCount, 1);
  assert.match(harness.elements.get("overlayTitle").textContent, /作废/);
});

test("stall, resize, blur, and Pointer Lock loss invalidate the active block and cancel RAF", async () => {
  const stall = await startRawApp();
  stall.clock.frame(16);
  stall.clock.frame(351);
  assert.equal(stall.diagnostics().active, false);
  assert.equal(stall.diagnostics().pendingRaf, 0);
  assert.equal(stall.diagnostics().sessionStatus, "paused");
  assert.equal(stall.diagnostics().anomalyCount, 1);

  const resize = await startRawApp();
  resize.window.dispatchEvent({ type: "resize" });
  assert.equal(resize.diagnostics().active, false);
  assert.equal(resize.diagnostics().pendingRaf, 0);
  assert.equal(resize.diagnostics().anomalyCount, 1);

  const blur = await startRawApp();
  blur.window.dispatchEvent({ type: "blur" });
  assert.equal(blur.diagnostics().active, false);
  assert.equal(blur.diagnostics().pendingRaf, 0);
  assert.equal(blur.diagnostics().anomalyCount, 1);

  const lockLost = await startRawApp();
  lockLost.losePointer();
  assert.equal(lockLost.diagnostics().active, false);
  assert.equal(lockLost.diagnostics().pendingRaf, 0);
  assert.equal(lockLost.diagnostics().anomalyCount, 1);
});

test("mousemove exit and re-entry between RAF callbacks resets the continuous 100ms dwell", async () => {
  const harness = await reachFirstTask("express");
  moveToActiveTarget(harness);
  const firstEntry = harness.diagnostics().activeTarget.dwell.enteredAt;
  assert.equal(firstEntry, harness.clock.now());

  harness.clock.elapse(60);
  harness.document.dispatchEvent({ type: "mousemove", movementX: 200, movementY: 0 });
  assert.equal(harness.diagnostics().activeTarget.dwell.enteredAt, null, "leaving before RAF must clear dwell immediately");

  harness.clock.elapse(10);
  moveToActiveTarget(harness);
  const secondEntry = harness.diagnostics().activeTarget.dwell.enteredAt;
  assert.equal(secondEntry, firstEntry + 70);

  harness.clock.frame(40);
  assert.equal(harness.diagnostics().activeTaskHits, 0, "the first contact's elapsed time must not leak across re-entry");
  assert.equal(harness.diagnostics().activeTarget.dwell.hit, false);

  harness.clock.frame(60);
  assert.equal(harness.diagnostics().activeTaskHits, 1, "the second uninterrupted 100ms dwell should hit");
});

test("100ms and 200ms RAF sampling produce the same logical dwell-hit timing metrics", async () => {
  async function sampleAt(delayMs) {
    const harness = await reachFirstTask("express");
    const taskEndsAt = harness.diagnostics().activePhaseEndsAt;
    moveToActiveTarget(harness);
    harness.clock.frame(delayMs);
    assert.equal(harness.diagnostics().activeTaskHits, 1);
    advanceClock(harness.clock, taskEndsAt - harness.clock.now());
    const result = harness.diagnostics().activeTaskResults.flick;
    assert.equal(result.hits, 1);
    return { timePerId: result.timePerId, settleMs: result.settleMs };
  }

  const exactSample = await sampleAt(100);
  const lateSample = await sampleAt(200);
  approximately(lateSample.timePerId, exactSample.timePerId, 1e-12);
  approximately(lateSample.settleMs, exactSample.settleMs, 1e-12);
  assert.equal(exactSample.settleMs, 100);
});

test("entering at 2150ms cannot beat a 2200ms target timeout when sampled at 2250ms", async () => {
  const harness = await reachFirstTask("express");
  advanceClock(harness.clock, 2150);
  moveToActiveTarget(harness);
  assert.equal(harness.diagnostics().activeTarget.dwell.enteredAt, harness.clock.now());

  harness.clock.frame(100);
  assert.equal(harness.diagnostics().activeTaskHits, 0);
  assert.equal(harness.diagnostics().activeTarget, null, "the expired trial must be recorded as a miss, not a late hit");
});

test("input at or after the task deadline cannot score and the last frame seals metrics at phaseEndsAt", async () => {
  const harness = await reachFirstTask("express");
  const taskEndsAt = harness.diagnostics().activePhaseEndsAt;
  advanceClock(harness.clock, Core.constants.modes.express.taskMs - 50);
  assert.equal(harness.clock.now(), taskEndsAt - 50);
  assert.ok(harness.diagnostics().activeTarget, "a static target should be active near the task deadline");

  moveToActiveTarget(harness);
  const beforeDeadlineInput = harness.diagnostics();
  assert.equal(beforeDeadlineInput.activeTaskHits, 0);
  harness.clock.elapse(60);
  const cameraBeforeLateInput = harness.diagnostics().activeCamera;
  harness.document.dispatchEvent({ type: "mousemove", movementX: 80, movementY: 80 });
  assert.deepEqual(harness.diagnostics().activeCamera, cameraBeforeLateInput, "late input must be ignored");

  harness.clock.frame(1);
  const sealed = harness.diagnostics();
  assert.equal(sealed.activePhase, "intermission");
  assert.equal(sealed.activeTaskHits, 0);
  assert.equal(sealed.activeTaskResults.flick.sampleMs, Core.constants.modes.express.taskMs);
});

test("a late RAF timestamps a newly displayed static target at actual exposure time, not its earlier schedule", async () => {
  const harness = await reachFirstTask("express");
  const taskEndsAt = harness.diagnostics().activePhaseEndsAt;
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  const stage = stored.session.stages[0];
  const sequence = Core.createTaskSequence(
    "flick",
    (stage.passSeeds[0] + 101) >>> 0,
    Core.constants.modes.express.taskMs
  );

  moveToActiveTarget(harness);
  harness.clock.frame(100);
  assert.equal(harness.diagnostics().activeTaskHits, 1);

  harness.clock.frame(300);
  assert.ok(harness.diagnostics().activeTarget, "the second target should become visible on this RAF");
  moveToActiveTarget(harness);
  harness.clock.frame(100);
  assert.equal(harness.diagnostics().activeTaskHits, 2);

  advanceClock(harness.clock, taskEndsAt - harness.clock.now());
  const result = harness.diagnostics().activeTaskResults.flick;
  const expected = Core.median(sequence.targets.slice(0, 2).map((target) => (
    Core.constants.dwellMs / Core.taskDifficulty(target.amplitude, target.radius)
  )));
  assert.equal(result.hits, 2);
  approximately(result.timePerId, expected, 1e-9, "late presentation time must not inflate target acquisition duration");
});

test("static tasks do not expose an un-hittable target near the deadline or create one on the deadline frame", async () => {
  async function finishAfterRapidHits(initialDelayMs) {
    const harness = await reachFirstTask("express");
    const taskEndsAt = harness.diagnostics().activePhaseEndsAt;
    if (initialDelayMs) harness.clock.frame(initialDelayMs);

    for (let index = 0; index < 36; index += 1) {
      moveToActiveTarget(harness);
      harness.clock.frame(Core.constants.dwellMs);
      assert.equal(harness.diagnostics().activeTaskHits, index + 1);
      if (index < 35) harness.clock.frame(120);
    }
    return { harness, taskEndsAt };
  }

  const lessThanDwell = await finishAfterRapidHits(0);
  lessThanDwell.harness.clock.frame(120);
  assert.equal(lessThanDwell.harness.clock.now(), lessThanDwell.taskEndsAt - 80);
  assert.equal(
    lessThanDwell.harness.diagnostics().activeTarget,
    null,
    "a target must not appear when less than the required 100ms dwell remains"
  );
  lessThanDwell.harness.clock.frame(80);
  assert.equal(lessThanDwell.harness.diagnostics().activeTaskResults.flick.misses, 0);

  const exactDeadline = await finishAfterRapidHits(80);
  assert.equal(exactDeadline.harness.clock.now(), exactDeadline.taskEndsAt - 120);
  assert.equal(exactDeadline.harness.diagnostics().activeTarget, null);
  exactDeadline.harness.clock.frame(120);
  const sealed = exactDeadline.harness.diagnostics();
  assert.equal(sealed.activePhase, "intermission");
  assert.equal(sealed.activeTaskResults.flick.misses, 0, "the deadline frame must not spawn then miss a new target");
});

test("raw rejection requires the CTA before rebuilding a clean compatibility session", async () => {
  function preloadWithCompletedBlock(mode) {
    return (core) => {
      const profile = baseProfile({ mode });
      const candidates = core.buildCoarseCandidates(profile, `preload-${mode}`);
      const stage = core.createBalancedStage("coarse", candidates, 1234, core.constants.modes[mode].passes, false);
      stage.kind = "coarse";
      stage.searchCenterSensitivity = Number(core.formatSensitivity(core.startingCenter(profile)));
      const key = stage.orders[0][0];
      const candidate = stage.candidates.find((entry) => entry.key === key);
      return {
        version: core.version,
        profile,
        session: {
          id: `stored-${mode}`,
          version: core.version,
          taskVersion: core.constants.taskVersion,
          profile,
          mode,
          inputMode: "pending",
          rawRequested: false,
          compatibilityRestricted: false,
          seed: 1234,
          confirmation: false,
          stages: [stage],
          stageIndex: 0,
          blocks: [{ stageId: stage.id, pass: 0, candidateKey: key, sensitivity: candidate.sensitivity, valid: true }],
          boundaryExpansionUsed: false,
          boundaryLimited: false,
          status: "paused",
          validTaskMs: 25000,
          interruptions: [],
          anomalies: [],
          createdAt: "2026-08-12T00:00:00.000Z",
          result: null
        },
        result: null,
        history: []
      };
    };
  }

  for (const [sourceMode, compatibilityMode] of [["standard", "quick"], ["express", "express"]]) {
    const harness = createAppHarness({ preload: preloadWithCompletedBlock(sourceMode) });
    assert.equal(harness.diagnostics().completedBlocks, 1);
    harness.start();
    harness.rawRequests[0].reject(new Error("raw denied"));
    await harness.flushPromises();

    assert.equal(harness.diagnostics().completedBlocks, 1, "rejection alone must not rebuild or mix the session");
    assert.equal(harness.diagnostics().mode, sourceMode);
    assert.equal(harness.diagnostics().awaitingLock, false);
    assert.equal(harness.pointerCalls.length, 1);
    assert.match(harness.elements.get("overlayAction").textContent, /兼容粗筛/);

    harness.elements.get("overlayAction").click();
    assert.equal(harness.pointerCalls.length, 2, "CTA must make the separate compatibility request");
    assert.equal(harness.pointerCalls[1].options, undefined);
    assert.equal(harness.diagnostics().completedBlocks, 0, "compatibility rebuild must not retain raw/pending scores");
    assert.equal(harness.diagnostics().inputMode, "compat");
    assert.equal(harness.diagnostics().mode, compatibilityMode);
    assert.equal(harness.diagnostics().awaitingLock, true);

    harness.acquirePointer();
    assert.equal(harness.diagnostics().active, true);
    assert.equal(harness.diagnostics().pendingRaf, 1);
    assert.equal(harness.diagnostics().rawConfirmed, false);
  }
});

test("a late stale Pointer Lock acquisition is immediately released after raw rejection", async () => {
  const harness = createAppHarness();
  harness.submitProfile("standard");
  harness.start();
  harness.rawRequests[0].reject(new Error("raw denied before lock change"));
  await harness.flushPromises();

  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().awaitingLock, false);
  harness.acquirePointer();

  assert.equal(harness.document.pointerLockElement, null);
  assert.equal(harness.diagnostics().active, false);
  assert.equal(harness.diagnostics().pendingRaf, 0);
});

test("Start and compatibility CTA cannot bypass an asynchronous Pointer Lock exit handshake", async () => {
  const harness = createAppHarness({ deferPointerExit: true });
  harness.submitProfile("standard");
  harness.start();
  harness.acquirePointer();
  assert.equal(harness.diagnostics().active, false, "the lock alone is not raw confirmation");

  harness.rawRequests[0].reject(new Error("raw denied after acquisition"));
  await harness.flushPromises();
  assert.equal(harness.pointerExitRequested(), true);
  assert.equal(harness.document.pointerLockElement, harness.elements.get("arena"));
  assert.equal(harness.diagnostics().active, false);

  harness.start();
  harness.elements.get("overlayAction").click();
  assert.equal(harness.pointerCalls.length, 1, "neither control may request compatibility while exit is pending");
  assert.match(harness.elements.get("toast").textContent, /等待浏览器释放鼠标/);

  harness.completePointerExit();
  assert.equal(harness.document.pointerLockElement, null);
  harness.elements.get("overlayAction").click();
  assert.equal(harness.pointerCalls.length, 2);
  assert.equal(harness.pointerCalls[1].options, undefined);
  assert.equal(harness.diagnostics().active, false, "compatibility still requires its own pointerlockchange");
  assert.equal(harness.diagnostics().awaitingLock, true);

  harness.acquirePointer();
  assert.equal(harness.diagnostics().active, true);
  assert.equal(harness.diagnostics().inputMode, "compat");
});

test("a delayed result-page unlock cannot mask the next session's real Pointer Lock loss", async () => {
  for (const takeover of ["restart", "new-profile"]) {
    const harness = createAppHarness({
      deferPointerExit: true,
      preload: (core) => completedSessionPayload(core, {
        mode: "standard",
        inputMode: "raw",
        id: `result-exit-${takeover}`
      })
    });

    const result = await resumePersistedSessionToResult(harness, "raw");
    assert.equal(result.view, "result");
    assert.equal(harness.pointerExitRequested(), true);
    assert.equal(harness.document.pointerLockElement, harness.elements.get("arena"));

    if (takeover === "restart") {
      harness.elements.get("restartTests").click();
      assert.equal(harness.diagnostics().view, "lab");
    } else {
      harness.elements.get("newProfile").click();
      assert.equal(harness.diagnostics().view, "profile");
    }
    assert.equal(harness.diagnostics().active, false);

    harness.completePointerExit();
    assert.equal(harness.document.pointerLockElement, null);
    if (takeover === "new-profile") {
      harness.submitProfile("standard");
      assert.equal(harness.diagnostics().view, "lab", harness.elements.get("formError").textContent);
    }
    harness.start();
    assert.equal(harness.rawRequests.length, 2);
    harness.rawRequests[1].resolve();
    await harness.flushPromises();
    harness.acquirePointer();
    assert.equal(harness.diagnostics().active, true);

    harness.losePointer();
    assert.equal(harness.diagnostics().active, false, `${takeover}: a genuine new-session lock loss must invalidate the block`);
    assert.equal(harness.diagnostics().sessionStatus, "paused");
    assert.equal(harness.diagnostics().anomalyCount, 1);
    assert.equal(harness.diagnostics().pendingRaf, 0);
  }
});

test("raw and compatibility sessions with a fully persisted stage advance to a result on resume", async () => {
  for (const [mode, inputMode] of [["standard", "raw"], ["quick", "compat"]]) {
    const harness = createAppHarness({
      preload: (core) => completedSessionPayload(core, { mode, inputMode, id: `resume-${inputMode}` })
    });
    assert.equal(harness.diagnostics().completedBlocks, inputMode === "raw" ? 9 : 3);
    assert.equal(harness.diagnostics().view, "lab");

    const diagnostics = await resumePersistedSessionToResult(harness, inputMode);
    assert.equal(diagnostics.view, "result", `${inputMode} recovery should resolve rather than start a phantom block`);
    assert.equal(diagnostics.sessionStatus, "complete");
    assert.equal(diagnostics.active, false);
    assert.equal(diagnostics.pendingRaf, 0);
    assert.equal(diagnostics.hasMain, inputMode === "raw");

    const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
    assert.equal(stored.session.id, `resume-${inputMode}`);
    assert.equal(stored.session.status, "complete");
    assert.equal(stored.result.sessionId, `resume-${inputMode}`);
  }
});

test("recovery invalidates a persisted activeBlock exactly once and clears the crash marker", () => {
  const harness = createAppHarness({
    preload(core) {
      const payload = completedSessionPayload(core, { mode: "standard", inputMode: "raw", id: "interrupted-block" });
      const stage = payload.session.stages[0];
      payload.session.blocks = [];
      payload.session.validTaskMs = 0;
      payload.session.status = "running";
      payload.session.activeBlock = {
        stageId: stage.id,
        pass: 0,
        position: 0,
        candidateKey: stage.orders[0][0],
        startedAt: "2026-08-12T00:00:00.000Z"
      };
      return payload;
    }
  });

  assert.equal(harness.diagnostics().sessionStatus, "paused");
  assert.equal(harness.diagnostics().completedBlocks, 0);
  assert.equal(harness.diagnostics().anomalyCount, 1);
  const recovered = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(recovered.session.activeBlock, null);
  assert.deepEqual(recovered.session.anomalies, ["process-interruption"]);
  assert.equal(recovered.session.interruptions.length, 1);
  assert.equal(recovered.session.interruptions[0].code, "process-interruption");

  const reloaded = createAppHarness({ preload: () => recovered });
  const afterSecondLoad = JSON.parse(reloaded.storage.getItem(Core.constants.storageKey));
  assert.equal(reloaded.diagnostics().anomalyCount, 1, "a cleared marker must not duplicate the anomaly on every reload");
  assert.equal(afterSecondLoad.session.activeBlock, null);
  assert.equal(afterSecondLoad.session.interruptions.length, 1);
});

test("an anomalous raw Standard recovery can only produce a tested range, never a main recommendation", async () => {
  const harness = createAppHarness({
    preload: (core) => completedSessionPayload(core, {
      mode: "standard",
      inputMode: "raw",
      anomalies: ["frame-stall"],
      id: "anomalous-raw"
    })
  });
  const diagnostics = await resumePersistedSessionToResult(harness, "raw");

  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.hasMain, false);
  assert.match(diagnostics.evidence, /数据异常/);
  assert.match(harness.elements.get("resultPrimaryLabel").textContent, /实测范围/);
  assert.equal(harness.elements.get("copyCommand").disabled, true);
  assert.match(harness.elements.get("commandText").textContent, /不提供单一命令/);
});

test("a persisted edge stage cannot expand a second time after process interruption", async () => {
  const harness = createAppHarness({
    preload(core) {
      const payload = completedSessionPayload(core, { mode: "standard", inputMode: "raw", id: "edge-resume" });
      const profile = payload.profile;
      const edgeCandidates = core.buildCandidates(profile, 1.25, 1.2, "persisted-edge");
      const edge = core.createBalancedStage("edge-1", edgeCandidates, 0xED6E, 3, false);
      edge.kind = "edge";
      const edgeBlocks = completeStageBlocks(edge, [[0.8, 1, 1.2], [0.8, 1, 1.2], [0.8, 1, 1.2]], "raw", payload.session.blocks.length);
      payload.session.stages.push(edge);
      payload.session.stageIndex = 1;
      payload.session.blocks.push(...edgeBlocks);
      payload.session.validTaskMs += edgeBlocks.reduce((sum, block) => sum + block.validTaskMs, 0);
      payload.session.boundaryExpansionUsed = true;
      return payload;
    }
  });

  const diagnostics = await resumePersistedSessionToResult(harness, "raw");
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.hasMain, false);
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(stored.session.boundaryExpansionUsed, true);
  assert.equal(stored.session.boundaryLimited, true);
  assert.equal(stored.session.stages.length, 2, "resume must not append another edge stage");
});

test("an inward endpoint winner on an edge stage is not treated as an outward boundary limit", async () => {
  const harness = createAppHarness({
    preload(core) {
      const payload = completedSessionPayload(core, { mode: "standard", inputMode: "raw", id: "edge-inward-winner" });
      const coarse = payload.session.stages[0];
      const coarseSorted = coarse.candidates.slice().sort((first, second) => first.sensitivity - second.sensitivity);
      const edgeCandidates = core.buildBoundaryCandidates(
        payload.profile,
        coarse,
        coarseSorted.at(-1),
        1.2,
        "edge-inward-grid"
      );
      const edge = core.createBalancedStage("edge-inward", edgeCandidates, 0x1A2B3C, 3, false);
      edge.kind = "edge";
      const sorted = edge.candidates.slice().sort((first, second) => first.sensitivity - second.sensitivity);
      const inward = sorted[0];
      const outward = sorted.at(-1);
      edge.outwardKey = outward.key;
      const factors = edge.candidates.map((candidate) => candidate.key === inward.key ? 0.8 : 1.2);
      const edgeBlocks = completeStageBlocks(edge, [factors, factors, factors], "raw", payload.session.blocks.length);

      payload.session.stages.push(edge);
      payload.session.stageIndex = 1;
      payload.session.blocks.push(...edgeBlocks);
      payload.session.validTaskMs += edgeBlocks.reduce((sum, block) => sum + block.validTaskMs, 0);
      payload.session.boundaryExpansionUsed = true;
      return payload;
    }
  });

  const diagnostics = await resumePersistedSessionToResult(harness, "raw");
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.hasMain, true);
  assert.equal(stored.session.boundaryLimited, false);
  assert.equal(stored.result.boundaryLimited, false);
  assert.equal(stored.session.stages.length, 2);
});

test("a confirmation endpoint winner finalizes the fixed grid without boundary expansion", async () => {
  const harness = createAppHarness({
    preload(core) {
      const payload = completedSessionPayload(core, { mode: "standard", inputMode: "raw", id: "confirmation-endpoint" });
      const candidates = core.buildCoarseCandidates(payload.profile, "confirmation-fixed-grid");
      const stage = core.createBalancedStage("confirm", candidates, 0xC0FFEE, 3, true);
      stage.kind = "confirm";
      const sorted = stage.candidates.slice().sort((first, second) => first.sensitivity - second.sensitivity);
      const endpoint = sorted.at(-1);
      const factors = stage.candidates.map((candidate) => candidate.key === endpoint.key ? 0.8 : 1.2);
      const blocks = completeStageBlocks(stage, [factors, factors, factors], "raw");

      payload.session.confirmation = true;
      payload.session.stages = [stage];
      payload.session.stageIndex = 0;
      payload.session.blocks = blocks;
      payload.session.validTaskMs = blocks.reduce((sum, block) => sum + block.validTaskMs, 0);
      payload.session.boundaryExpansionUsed = false;
      payload.session.boundaryLimited = false;
      return payload;
    }
  });

  const diagnostics = await resumePersistedSessionToResult(harness, "raw");
  const stored = JSON.parse(harness.storage.getItem(Core.constants.storageKey));
  assert.equal(diagnostics.view, "result");
  assert.equal(diagnostics.hasMain, true);
  assert.equal(stored.session.confirmation, true);
  assert.equal(stored.session.stages.length, 1, "confirmation must keep the exact tested grid");
  assert.equal(stored.session.boundaryExpansionUsed, false);
  assert.equal(stored.session.boundaryLimited, false);
  assert.equal(stored.result.boundaryLimited, false);
});

test("clipboard rejection plus a false execCommand fallback reports copy failure", async () => {
  const harness = createAppHarness({
    clipboardReject: true,
    execCommandResult: false,
    preload: (core) => completedSessionPayload(core, { mode: "quick", inputMode: "compat", id: "copy-failure" })
  });
  await resumePersistedSessionToResult(harness, "compat");
  harness.elements.get("copyReport").click();
  await harness.flushPromises();

  assert.equal(harness.clipboardWrites.length, 1);
  assert.match(harness.clipboardWrites[0], /未经过 CS2 游戏内提升验证/);
  assert.equal(harness.elements.get("toast").textContent, "复制失败，请手动复制。");
  assert.equal(harness.elements.get("toast").classList.contains("is-visible"), true);
  assert.equal(harness.document.body.children.length, 0, "fallback textarea must be cleaned up");
});

test("m_pitch validation accepts inversion but rejects zero and out-of-range values", () => {
  for (const mPitch of [-0.1, -0.001, 0.001, 0.022, 0.1]) {
    assert.equal(Core.validateProfile(baseProfile({ mPitch })).valid, true, `m_pitch ${mPitch}`);
  }
  for (const mPitch of [-0.101, -0.0009, 0, 0.0009, 0.101]) {
    assert.equal(Core.validateProfile(baseProfile({ mPitch })).valid, false, `m_pitch ${mPitch}`);
  }
});

test("relative input has the correct signs in every cardinal and diagonal direction", () => {
  const calibration = { sensitivity: 1, mYaw: 0.022, mPitch: 0.022 };
  const directions = [
    [{ x: 10, y: 0 }, 1, 0],
    [{ x: -10, y: 0 }, -1, 0],
    [{ x: 0, y: -10 }, 0, 1],
    [{ x: 0, y: 10 }, 0, -1],
    [{ x: 10, y: -10 }, 1, 1],
    [{ x: -10, y: -10 }, -1, 1],
    [{ x: 10, y: 10 }, 1, -1],
    [{ x: -10, y: 10 }, -1, -1]
  ];

  for (const [movement, yawSign, pitchSign] of directions) {
    const result = Core.applyPointerDelta({ yaw: 0, pitch: 0 }, movement, calibration);
    const yawActualSign = result.yawDelta === 0 ? 0 : Math.sign(result.yawDelta);
    const pitchActualSign = result.pitchDelta === 0 ? 0 : Math.sign(result.pitchDelta);
    assert.equal(yawActualSign, yawSign, `yaw sign for ${JSON.stringify(movement)}`);
    assert.equal(pitchActualSign, pitchSign, `pitch sign for ${JSON.stringify(movement)}`);
  }
});

test("negative m_pitch inverts only the vertical axis and sensitivity scales angles linearly", () => {
  const normal = Core.applyPointerDelta(
    { yaw: 0, pitch: 0 },
    { x: 12, y: 8 },
    { sensitivity: 1, mYaw: 0.022, mPitch: 0.022 }
  );
  const inverted = Core.applyPointerDelta(
    { yaw: 0, pitch: 0 },
    { x: 12, y: 8 },
    { sensitivity: 1, mYaw: 0.022, mPitch: -0.022 }
  );
  const doubled = Core.applyPointerDelta(
    { yaw: 0, pitch: 0 },
    { x: 12, y: 8 },
    { sensitivity: 2, mYaw: 0.022, mPitch: 0.022 }
  );

  approximately(inverted.yawDelta, normal.yawDelta);
  approximately(inverted.pitchDelta, -normal.pitchDelta);
  approximately(doubled.yawDelta, normal.yawDelta * 2);
  approximately(doubled.pitchDelta, normal.pitchDelta * 2);
  approximately(doubled.pathDelta, normal.pathDelta * 2);
});

test("cm/360 conversion round-trips across supported DPI, sensitivity, and m_yaw values", () => {
  for (const dpi of [400, 800, 1600, 3200]) {
    for (const sensitivity of [0.1, 0.575, 1.25, 4, 8]) {
      for (const mYaw of [0.001, 0.01, 0.022, 0.1]) {
        const cm = Core.cmForSensitivity(dpi, sensitivity, mYaw);
        approximately(Core.sensitivityForCm(dpi, cm, mYaw), sensitivity, 1e-10);
      }
    }
  }
});

test("reticle projection depends on camera motion, not target motion", () => {
  const viewport = { width: 1600, height: 900 };
  const presentation = { yaw: 0, pitch: 0 };
  const camera = { yaw: 12, pitch: -5 };
  const before = plain(Core.projectReticle(camera, presentation, viewport));
  const firstTarget = Core.projectTarget({ yaw: -20, pitch: 8, radius: 1.2 }, presentation, viewport);
  const secondTarget = Core.projectTarget({ yaw: 25, pitch: -9, radius: 1.2 }, presentation, viewport);
  const after = plain(Core.projectReticle(camera, presentation, viewport));

  assert.notEqual(firstTarget.x, secondTarget.x);
  assert.notEqual(firstTarget.y, secondTarget.y);
  assert.deepEqual(after, before);
});

test("reticle and target align pixel-for-pixel at the same logical angle", () => {
  const viewport = { width: 1920, height: 1080 };
  const presentation = { yaw: -3, pitch: 2 };
  const angle = { yaw: 21, pitch: -7 };
  const target = Core.projectTarget({ ...angle, radius: 1.2 }, presentation, viewport);
  const reticle = Core.projectReticle(angle, presentation, viewport);
  approximately(reticle.x, target.x, 1e-9);
  approximately(reticle.y, target.y, 1e-9);
});

test("off-FOV target and reticle centers remain pixel-aligned at the same logical angle", () => {
  const viewport = { width: 1280, height: 720 };
  const presentation = { yaw: 0, pitch: 0 };
  for (const angle of [
    { yaw: 120, pitch: 0 },
    { yaw: -120, pitch: 0 },
    { yaw: 0, pitch: 80 },
    { yaw: 0, pitch: -80 },
    { yaw: 130, pitch: 70 }
  ]) {
    const target = Core.projectTarget({ ...angle, radius: 1.5 }, presentation, viewport);
    const reticle = Core.projectReticle(angle, presentation, viewport);
    assert.equal(target.onScreen, false);
    assert.equal(reticle.onScreen, false);
    approximately(target.x, reticle.x, 1e-9, `off-FOV x at ${JSON.stringify(angle)}`);
    approximately(target.y, reticle.y, 1e-9, `off-FOV y at ${JSON.stringify(angle)}`);
  }
});

test("projection preserves direction and clamps off-FOV points to finite edges", () => {
  const viewport = { width: 1280, height: 720 };
  const origin = { yaw: 0, pitch: 0 };
  const center = Core.projectAngularPoint({ yaw: 0, pitch: 0 }, origin, viewport);
  const right = Core.projectAngularPoint({ yaw: 10, pitch: 0 }, origin, viewport);
  const left = Core.projectAngularPoint({ yaw: -10, pitch: 0 }, origin, viewport);
  const up = Core.projectAngularPoint({ yaw: 0, pitch: 10 }, origin, viewport);
  const down = Core.projectAngularPoint({ yaw: 0, pitch: -10 }, origin, viewport);

  assert.ok(right.x > center.x && left.x < center.x);
  assert.ok(up.y < center.y && down.y > center.y);

  const offscreenCases = [
    [{ yaw: 120, pitch: 0 }, "right"],
    [{ yaw: -120, pitch: 0 }, "left"],
    [{ yaw: 0, pitch: 80 }, "top"],
    [{ yaw: 0, pitch: -80 }, "bottom"],
    [{ yaw: 179, pitch: 0 }, "right"],
    [{ yaw: -179, pitch: 0 }, "left"]
  ];
  for (const [point, edge] of offscreenCases) {
    const projection = Core.projectAngularPoint(point, origin, viewport);
    assert.equal(projection.onScreen, false);
    assert.equal(Number.isFinite(projection.x) && Number.isFinite(projection.y), true);
    if (edge === "right") assert.ok(projection.x > viewport.width - 3);
    if (edge === "left") assert.ok(projection.x < 3);
    if (edge === "top") assert.ok(projection.y < 3);
    if (edge === "bottom") assert.ok(projection.y > viewport.height - 3);
  }
});

test("task generation is deterministic for an identical task, seed, and duration", () => {
  for (const taskName of Core.constants.tasks) {
    const first = Core.createTaskSequence(taskName, 0xC0FFEE, 25000);
    const second = Core.createTaskSequence(taskName, 0xC0FFEE, 25000);
    assert.deepEqual(plain(first), plain(second));
  }
});

test("10,000 seeded task sets obey true angular distance, speed, and tracking bounds", () => {
  let violation = null;

  outer: for (let seed = 0; seed < 10000; seed += 1) {
    const flick = Core.createTaskSequence("flick", seed, 25000);
    for (const target of flick.targets) {
      const distance = Math.hypot(target.yawOffset, target.pitchOffset);
      if (distance < 10 - 1e-9 || distance > 30 + 1e-9 || Math.abs(distance - target.amplitude) > 1e-9 || target.radius !== 1.2) {
        violation = { seed, task: "flick", target: plain(target), distance };
        break outer;
      }
    }

    const lateral = Core.createTaskSequence("lateral", seed, 25000);
    for (let index = 0; index < lateral.targets.length; index += 1) {
      const target = lateral.targets[index];
      const expectedSign = index % 2 === 0 ? 1 : -1;
      if (Math.sign(target.yawOffset) !== expectedSign || Math.abs(target.yawOffset) < 28 || Math.abs(target.yawOffset) > 42 || target.pitchOffset !== 0 || target.radius !== 1.5) {
        violation = { seed, task: "lateral", index, target: plain(target) };
        break outer;
      }
    }

    const track = Core.createTaskSequence("track", seed, 25000);
    let previousEnd = null;
    for (const segment of track.segments) {
      const durationSeconds = (segment.endMs - segment.startMs) / 1000;
      const distance = Core.angularDistance(segment.end, segment.start);
      const actualSpeed = distance / durationSeconds;
      const points = [segment.start, segment.end, Core.trackPosition(track, (segment.startMs + segment.endMs) / 2)];
      const inBounds = points.every((point) => Math.abs(point.yaw) <= 21 + 1e-9 && Math.abs(point.pitch) <= 11 + 1e-9);
      const continuous = !previousEnd || (Math.abs(previousEnd.yaw - segment.start.yaw) <= 1e-9 && Math.abs(previousEnd.pitch - segment.start.pitch) <= 1e-9);
      if (!inBounds || !continuous || !Number.isFinite(actualSpeed) || actualSpeed < 12 - 1e-9 || actualSpeed > 25 + 1e-9 || Math.abs(actualSpeed - segment.speed) > 1e-8) {
        violation = { seed, task: "track", segment: plain(segment), actualSpeed, inBounds, continuous };
        break outer;
      }
      previousEnd = segment.end;
    }
    if (!track.segments.length || track.segments.at(-1).endMs < 27000) {
      violation = { seed, task: "track-duration", endMs: track.segments.at(-1)?.endMs };
      break;
    }
  }

  assert.equal(violation, null, violation && JSON.stringify(violation));
});

test("tracking summary distinguishes perfect contact, never-acquired contact, and one continuous loss", () => {
  const taskMs = 8000;
  const perfect = Core.summarizeTracking({
    sampleMs: taskMs,
    errorSqMs: 0,
    offTargetMs: 0,
    speedMismatchSqMs: 0,
    reacquireDurations: [],
    offStartedAt: null,
    contacts: 1
  }, taskMs, taskMs);
  assert.equal(perfect.reacquireMs, 0);

  const neverAcquired = Core.summarizeTracking({
    sampleMs: taskMs,
    errorSqMs: taskMs,
    offTargetMs: taskMs,
    speedMismatchSqMs: taskMs,
    reacquireDurations: [],
    offStartedAt: 0,
    contacts: 0
  }, taskMs, taskMs);
  assert.equal(neverAcquired.reacquireMs, taskMs);

  const oneContinuousLoss = Core.summarizeTracking({
    sampleMs: 5000,
    errorSqMs: 5000,
    offTargetMs: 3000,
    speedMismatchSqMs: 5000,
    reacquireDurations: [],
    offStartedAt: 2000,
    contacts: 1,
    segmentIndex: 99
  }, 5000, 5000);
  assert.equal(oneContinuousLoss.reacquireMs, 3000, "trajectory segment changes must not split one physical off-target interval");
});

test("dwell requires a continuous 100 ms contact and resets after a brush", () => {
  let dwell = Core.createDwellState();
  dwell = Core.updateDwell(dwell, true, 1000);
  dwell = Core.updateDwell(dwell, true, 1099);
  assert.equal(dwell.hit, false);
  dwell = Core.updateDwell(dwell, true, 1100);
  assert.equal(dwell.hit, true);
  assert.equal(dwell.hitAt, 1100);

  let coarseSample = Core.createDwellState();
  coarseSample = Core.updateDwell(coarseSample, true, 1000);
  coarseSample = Core.updateDwell(coarseSample, true, 1200);
  assert.equal(coarseSample.hitAt, 1100, "a late RAF sample must preserve the logical 100ms hit timestamp");

  let brush = Core.createDwellState();
  brush = Core.updateDwell(brush, true, 2000);
  brush = Core.updateDwell(brush, false, 2050);
  assert.equal(brush.enteredAt, null);
  assert.equal(brush.feedback, false);
  assert.equal(brush.hitAt, null);
  brush = Core.updateDwell(brush, true, 2100);
  brush = Core.updateDwell(brush, true, 2199);
  assert.equal(brush.hit, false);
  brush = Core.updateDwell(brush, true, 2200);
  assert.equal(brush.hit, true);
  assert.equal(brush.hitAt, 2200);
  brush = Core.updateDwell(brush, false, 2210);
  assert.equal(brush.hit, false);
  assert.equal(brush.hitAt, null);
});

test("principal-axis overshoot and correction work horizontally, vertically, and diagonally", () => {
  const cases = [
    [{ yaw: 10, pitch: 0 }, { yaw: 11, pitch: 0 }, { yaw: 10.5, pitch: 0 }],
    [{ yaw: 0, pitch: 10 }, { yaw: 0, pitch: 11 }, { yaw: 0, pitch: 10.5 }],
    [{ yaw: 10, pitch: 10 }, { yaw: 11, pitch: 11 }, { yaw: 10.5, pitch: 10.5 }]
  ];

  for (const [target, overshoot, returnPoint] of cases) {
    let axis = Core.createAxisState({ yaw: 0, pitch: 0 }, target);
    axis = Core.updateAxisState(axis, overshoot);
    assert.equal(axis.overshoots, 1, `overshoot for ${JSON.stringify(target)}`);
    axis = Core.updateAxisState(axis, returnPoint);
    assert.equal(axis.corrections, 1, `correction for ${JSON.stringify(target)}`);
    axis = Core.updateAxisState(axis, returnPoint);
    assert.equal(axis.corrections, 1, "stationary samples must not duplicate corrections");
  }
});

test("candidate grids remain distinct and inside the tool range at both boundaries", () => {
  const profile = baseProfile();
  for (const center of [0.1, 1.25, 8]) {
    const candidates = Core.buildCandidates(profile, center, 1.2, `grid-${center}`);
    const values = candidates.map((candidate) => candidate.sensitivity);
    assert.equal(values.length, 3);
    assert.equal(new Set(values).size, 3);
    assert.ok(values.every((value) => value >= 0.1 && value <= 8));
    assert.deepEqual(values, values.slice().sort((a, b) => a - b));
  }
});

test("balanced and confirmation orders counterbalance every blind label", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "balanced");
  const stage = Core.createBalancedStage("coarse", candidates, 42, 3, false);
  const confirmation = Core.createBalancedStage("coarse", candidates, 42, 3, true);
  const labels = (candidateStage) => candidateStage.orders.map((order) => order.map((key) => Core.candidateLabel(candidateStage, key)));

  assert.deepEqual(plain(labels(stage)), [["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"]]);
  assert.deepEqual(plain(labels(confirmation)), [["C", "B", "A"], ["A", "C", "B"], ["B", "A", "C"]]);
  for (let position = 0; position < 3; position += 1) {
    assert.deepEqual(plain(labels(stage).map((order) => order[position]).sort()), ["A", "B", "C"]);
  }
  assert.equal(new Set(stage.passSeeds).size, 3);
});

test("grid signatures and scoring conclusions are invariant to candidate label/order changes", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "invariant");
  const stage = Core.createBalancedStage("score", candidates, 101, 3, false);
  const factors = Object.fromEntries(candidates.map((candidate, index) => [candidate.key, [0.92, 1, 1.08][index]]));
  const evaluation = Core.evaluateStage(stageBlocks(stage, [factors, factors, factors]), stage, "rifle", { mode: "standard" });

  const reordered = Core.createBalancedStage("score", candidates.slice().reverse(), 98765, 3, false);
  const reorderedEvaluation = Core.evaluateStage(stageBlocks(reordered, [factors, factors, factors]), reordered, "rifle", { mode: "standard" });

  assert.equal(Core.gridSignature(candidates), Core.gridSignature(candidates.slice().reverse()));
  assert.equal(evaluation.uniqueLeader?.key, candidates[0].key);
  assert.equal(reorderedEvaluation.uniqueLeader?.key, candidates[0].key);
});

test("boundary expansion works only for an outside leader and stays in range", () => {
  const profile = baseProfile();
  const candidates = Core.buildCandidates(profile, 1.25, 1.2, "edge-base");
  const stage = Core.createBalancedStage("coarse", candidates, 7, 3, false);
  const low = Core.buildBoundaryCandidates(profile, stage, candidates[0], 1.2, "edge-low");
  const middle = Core.buildBoundaryCandidates(profile, stage, candidates[1], 1.2, "edge-middle");
  const high = Core.buildBoundaryCandidates(profile, stage, candidates[2], 1.2, "edge-high");

  assert.equal(low.length, 3);
  assert.ok(low.some((candidate) => candidate.sensitivity < candidates[0].sensitivity));
  assert.deepEqual(plain(middle), []);
  assert.equal(high.length, 3);
  assert.ok(high.some((candidate) => candidate.sensitivity > candidates[2].sensitivity));
  assert.ok([...low, ...high].every((candidate) => candidate.sensitivity >= 0.1 && candidate.sensitivity <= 8));
});

test("losses are logarithmic and clamped, and role weights are normalized", () => {
  approximately(Core.logRelativeLoss(9, 1), Math.log(3));
  approximately(Core.logRelativeLoss(1 / 9, 1), -Math.log(3));
  approximately(Core.logRelativeLoss(1.08, 1), Math.log(1.08));

  for (const weights of Object.values(plain(Core.constants.roleWeights))) {
    approximately(weights.flick + weights.lateral + weights.track, 1);
  }
});

test("Theil-Sen drift is robustly calculated and contributes to the distinction threshold", () => {
  approximately(Core.theilSenSlope([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 8, y: 16 }]), 2);
  approximately(Core.sessionDrift([
    { candidateKey: "A", loss: 0, orderIndex: 0 },
    { candidateKey: "B", loss: 0, orderIndex: 1 },
    { candidateKey: "A", loss: 2, orderIndex: 2 },
    { candidateKey: "B", loss: 2, orderIndex: 3 }
  ]), 2.5);

  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "drift");
  const stage = Core.createBalancedStage("drift-stage", candidates, 19, 3, false);
  const blocks = stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [0.92, 1, 1.08]]);
  const evaluation = Core.evaluateStage(blocks, stage, "rifle", { mode: "standard" });
  const winningPair = evaluation.pairwise.find((pair) => pair.first === candidates[0].key && pair.second === candidates[1].key);

  approximately(winningPair.threshold, Math.max(Math.log(1.03), 1.4826 * winningPair.mad, evaluation.drift));
  assert.equal(winningPair.dominates, true);
});

test("a leader must win all three passes beyond threshold; ties and anomalies remain ranges", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "dominance");
  const stage = Core.createBalancedStage("dominance-stage", candidates, 29, 3, false);
  const decisive = Core.evaluateStage(
    stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [0.92, 1, 1.08]]),
    stage,
    "rifle",
    { mode: "standard" }
  );
  assert.equal(decisive.uniqueLeader?.key, candidates[0].key);

  const reversedPass = Core.evaluateStage(
    stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [1.02, 1, 1.08]]),
    stage,
    "rifle",
    { mode: "standard" }
  );
  assert.equal(reversedPass.uniqueLeader, null);
  assert.ok(reversedPass.rangeCandidates.length >= 2);

  const tied = Core.evaluateStage(
    stageBlocks(stage, [[1, 1.01, 1.02], [1, 1.01, 1.02], [1, 1.01, 1.02]]),
    stage,
    "rifle",
    { mode: "standard" }
  );
  assert.equal(tied.uniqueLeader, null);
  const sensitivities = tied.rangeCandidates.map((candidate) => candidate.sensitivity);
  const low = Math.min(...sensitivities);
  const high = Math.max(...sensitivities);
  assert.deepEqual(
    sensitivities,
    stage.candidates.filter((candidate) => candidate.sensitivity >= low && candidate.sensitivity <= high).map((candidate) => candidate.sensitivity)
  );

  const anomalous = Core.evaluateStage(
    stageBlocks(stage, [[0.8, 1, 1.2], [0.8, 1, 1.2], [0.8, 1, 1.2]]),
    stage,
    "rifle",
    { mode: "standard", anomaly: true }
  );
  assert.equal(anomalous.uniqueLeader, null);
});

test("Express and Quick never create a unique winner from pure stage evaluation", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "range-only");
  for (const mode of ["express", "quick"]) {
    const stage = Core.createBalancedStage(mode, candidates, 37, 1, false);
    const evaluation = Core.evaluateStage(stageBlocks(stage, [[0.8, 1, 1.2]]), stage, "rifle", { mode, rangeOnly: true });
    assert.equal(evaluation.uniqueLeader, null);
    assert.equal(evaluation.rangeCandidates.length, mode === "express" ? 3 : 2);
  }
});

test("fast guidance requires a real single-pass gap and never turns a tie or anomaly into a direction", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "fast-guidance");
  const stage = Core.createBalancedStage("fast-guidance-stage", candidates, 41, 1, false);
  function guidance(factors, anomaly = false) {
    const evaluation = Core.evaluateStage(stageBlocks(stage, [factors]), stage, "rifle", { mode: "express", rangeOnly: true, anomaly });
    return Core.createFastGuidance(stage, evaluation);
  }

  const tied = guidance([1, 1, 1]);
  assert.equal(tied.direction, "unclear");
  assert.equal(tied.clarity, "unclear");
  assert.equal(tied.nextCenterSensitivity, candidates[1].sensitivity);

  assert.equal(guidance([0.82, 1, 1.12]).direction, "slower");
  assert.equal(guidance([1, 0.82, 1.12]).direction, "center");
  assert.equal(guidance([1.12, 1, 0.82]).direction, "faster");

  const anomalous = guidance([0.82, 1, 1.12], true);
  assert.equal(anomalous.direction, "unclear");
  assert.equal(anomalous.nextCenterSensitivity, candidates[1].sensitivity);
});

test("fast guidance compares against the true search center at both tool boundaries", () => {
  function boundary(center, factors) {
    const profile = baseProfile({ currentSens: center, mode: "express" });
    const candidates = Core.buildCoarseCandidates(profile, `boundary-${center}`);
    const stage = Core.createBalancedStage(`boundary-stage-${center}`, candidates, 73, 1, false);
    stage.searchCenterSensitivity = Number(Core.formatSensitivity(Core.startingCenter(profile)));
    const evaluation = Core.evaluateStage(stageBlocks(stage, [factors]), stage, "rifle", { mode: "express", rangeOnly: true });
    return { candidates, guidance: Core.createFastGuidance(stage, evaluation) };
  }

  const lowTie = boundary(0.1, [1, 1, 1]);
  assert.deepEqual(plain(lowTie.candidates.map((candidate) => candidate.sensitivity)), [0.1, 0.12, 0.144]);
  assert.equal(lowTie.guidance.direction, "unclear");
  assert.equal(lowTie.guidance.nextCenterSensitivity, 0.1);
  assert.equal(boundary(0.1, [0.82, 1, 1.12]).guidance.direction, "center");
  assert.equal(boundary(0.1, [1, 0.82, 1.12]).guidance.direction, "faster");
  assert.equal(boundary(0.1, [1.12, 1, 0.82]).guidance.direction, "faster");

  const highTie = boundary(8, [1, 1, 1]);
  assert.deepEqual(plain(highTie.candidates.map((candidate) => candidate.sensitivity)), [5.556, 6.667, 8]);
  assert.equal(highTie.guidance.direction, "unclear");
  assert.equal(highTie.guidance.nextCenterSensitivity, 8);
  assert.equal(boundary(8, [0.82, 1, 1.12]).guidance.direction, "slower");
  assert.equal(boundary(8, [1, 0.82, 1.12]).guidance.direction, "slower");
  assert.equal(boundary(8, [1.12, 1, 0.82]).guidance.direction, "center");
});

test("synthetic 8% leadership is found reliably while <=3% gaps rarely produce a unique value", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "simulation");
  const stage = Core.createBalancedStage("simulation-stage", candidates, 73, 3, false);
  let correct = 0;
  let falseUnique = 0;
  const simulations = 1000;

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const rng = Core.createRng(0x51A7 + simulation * 7919);
    const decisiveFactors = [];
    const nearTieFactors = [];
    for (let pass = 0; pass < 3; pass += 1) {
      decisiveFactors.push([0.92, 1, 1.08].map((truth) => truth * Math.exp(gaussian(rng) * 0.015)));
      nearTieFactors.push([1, 1.015, 1.03].map((truth) => truth * Math.exp(gaussian(rng) * 0.015)));
    }
    const decisive = Core.evaluateStage(stageBlocks(stage, decisiveFactors), stage, "rifle", { mode: "standard" });
    const nearTie = Core.evaluateStage(stageBlocks(stage, nearTieFactors), stage, "rifle", { mode: "standard" });
    if (decisive.uniqueLeader?.key === candidates[0].key) correct += 1;
    if (nearTie.uniqueLeader) falseUnique += 1;
  }

  assert.ok(correct / simulations >= 0.95, `8% synthetic correct rate was ${(correct / simulations * 100).toFixed(1)}%`);
  assert.ok(falseUnique / simulations <= 0.05, `<=3% synthetic false-unique rate was ${(falseUnique / simulations * 100).toFixed(1)}%`);
});

test("advertised base mode durations stay inside their declared windows", () => {
  const express = Core.estimateDuration("express", 1);
  const quick = Core.estimateDuration("quick", 1);
  const standard = Core.estimateDuration("standard", 1);
  const deep = Core.estimateDuration("deep", 2);

  assert.ok(express < 120000, `Express was ${(express / 1000).toFixed(1)} seconds`);
  assert.equal(Core.constants.modes.express.budgetMs, 120000);
  assert.ok(quick >= 4 * 60000 && quick <= 6 * 60000, `Quick was ${(quick / 60000).toFixed(1)} minutes`);
  assert.ok(standard >= 13 * 60000 && standard <= 15 * 60000, `Standard was ${(standard / 60000).toFixed(1)} minutes`);
  assert.ok(deep >= 27 * 60000 && deep <= 30 * 60000, `Deep was ${(deep / 60000).toFixed(1)} minutes`);
});

test("v2 migration keeps only the profile and supplies the default m_pitch", () => {
  const legacy = {
    version: "2.2.0",
    profile: { ...baseProfile(), mPitch: undefined },
    session: { id: "must-not-migrate" },
    result: { main: { sensitivity: 1.25 } }
  };
  const before = JSON.stringify(legacy);
  const migrated = plain(Core.migratePersistedState({ v2: legacy }));

  assert.equal(migrated.migratedFrom, "v2");
  assert.equal(migrated.profile.mPitch, 0.022);
  assert.equal(migrated.session, null);
  assert.equal(migrated.result, null);
  assert.deepEqual(migrated.history, []);
  assert.equal(JSON.stringify(legacy), before, "migration must not mutate its source payload");
});

test("v3 migration restores only matching algorithm data and caps history at 100", () => {
  const profile = baseProfile();
  const candidates = Core.buildCandidates(profile, 1.25, 1.2, "restore");
  const stage = Core.createBalancedStage("restore-stage", candidates, 5150, 3, false);
  const history = Array.from({ length: 105 }, (_, index) => ({
    id: `summary-${index}`,
    algorithmVersion: Core.version,
    taskVersion: Core.constants.taskVersion
  }));
  const current = {
    version: Core.version,
    profile,
    session: {
      version: Core.version,
      taskVersion: Core.constants.taskVersion,
      id: "session",
      profile,
      stages: [stage],
      blocks: [],
      interruptions: [],
      anomalies: [],
      status: "complete"
    },
    result: {
      id: "result",
      algorithmVersion: Core.version,
      taskVersion: Core.constants.taskVersion,
      sessionId: "session",
      profile,
      range: candidates.slice(0, 2),
      testedCandidates: candidates,
      evaluation: { pairwise: [] },
      evidence: "重复一致"
    },
    history
  };
  const restored = plain(Core.migratePersistedState({ v3: current }));
  assert.equal(restored.session.id, "session");
  assert.equal(restored.result.id, "result");
  assert.equal(restored.history.length, 100);
  assert.equal(restored.history[0].id, "summary-5");

  const incompatible = plain(Core.migratePersistedState({
    v3: { ...current, version: "3.0.1" }
  }));
  assert.equal(incompatible.session, null);
  assert.equal(incompatible.result, null);

  const staleSession = plain(current);
  staleSession.session.taskVersion = "angles-3.0.0";
  const withoutStaleSession = plain(Core.migratePersistedState({ v3: staleSession }));
  assert.equal(withoutStaleSession.session, null, "a session from another task definition must be discarded");
  assert.equal(withoutStaleSession.result, null, "a result cannot survive without its matching completed session");

  const missingTaskVersion = plain(current);
  delete missingTaskVersion.session.taskVersion;
  const withoutVersionedSession = plain(Core.migratePersistedState({ v3: missingTaskVersion }));
  assert.equal(withoutVersionedSession.session, null, "a session without an explicit task version must be discarded");
  assert.equal(withoutVersionedSession.result, null);

  const incompleteFastSession = plain(current);
  incompleteFastSession.session.mode = "express";
  incompleteFastSession.session.profile.mode = "express";
  delete incompleteFastSession.session.stages[0].searchCenterSensitivity;
  const withoutFastCenter = plain(Core.migratePersistedState({ v3: incompleteFastSession }));
  assert.equal(withoutFastCenter.session, null, "a current fast session without its true search center must be discarded");
  assert.equal(withoutFastCenter.result, null);

  const incompleteFastResult = plain(current);
  incompleteFastResult.session.mode = "express";
  incompleteFastResult.session.profile.mode = "express";
  incompleteFastResult.session.stages[0].searchCenterSensitivity = 1.25;
  incompleteFastResult.result.mode = "express";
  delete incompleteFastResult.result.fastGuidance;
  const withoutFastGuidance = plain(Core.migratePersistedState({ v3: incompleteFastResult }));
  assert.equal(withoutFastGuidance.session, null, "a completed session without a valid result must not deadlock restoration");
  assert.equal(withoutFastGuidance.result, null, "a current fast result without actionable guidance must be discarded");

  const staleResult = plain(current);
  staleResult.result.taskVersion = "angles-3.0.0";
  const withoutStaleResult = plain(Core.migratePersistedState({ v3: staleResult }));
  assert.equal(withoutStaleResult.session, null, "a completed session cannot remain after its result is discarded");
  assert.equal(withoutStaleResult.result, null, "a result from another task definition must be discarded");

  const filteredHistory = plain(Core.migratePersistedState({
    v3: {
      ...current,
      history: [
        { id: "matching-task", algorithmVersion: Core.version, taskVersion: Core.constants.taskVersion },
        { id: "stale-task", algorithmVersion: Core.version, taskVersion: "angles-3.0.0" }
      ]
    }
  }));
  assert.deepEqual(filteredHistory.history.map((entry) => entry.id), ["matching-task"]);

  const malformed = plain(Core.migratePersistedState({
    v3: {
      version: Core.version,
      profile,
      session: { version: Core.version, taskVersion: Core.constants.taskVersion },
      result: { algorithmVersion: Core.version, taskVersion: Core.constants.taskVersion },
      history: []
    }
  }));
  assert.equal(malformed.profile.mPitch, 0.022);
  assert.equal(malformed.session, null);
  assert.equal(malformed.result, null);
});

test("history stores capped, cloned summaries without raw pointer samples", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "history");
  const stage = Core.createBalancedStage("coarse", candidates, 83, 3, false);
  const evaluation = Core.evaluateStage(
    stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [0.92, 1, 1.08]]),
    stage,
    "rifle",
    { mode: "standard" }
  );
  const result = {
    completedAt: "2026-08-12T00:00:00.000Z",
    main: candidates[0],
    range: [candidates[0]],
    boundaryLimited: false,
    evaluation
  };
  const session = {
    id: "eligible-session",
    inputMode: "raw",
    mode: "standard",
    validTaskMs: 420000,
    anomalies: [],
    interruptions: [],
    profile: baseProfile(),
    stages: [stage],
    blocks: stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [0.92, 1, 1.08]]),
    rawPointerSamples: [{ movementX: 99, movementY: -42 }]
  };
  const summary = plain(Core.createSessionSummary(session, result));

  assert.equal(summary.eligible, true);
  assert.doesNotMatch(JSON.stringify(summary), /rawPointerSamples|movementX|movementY/);

  let history = [];
  for (let index = 0; index < 105; index += 1) {
    history = Core.appendHistory(history, { ...summary, id: `history-${index}` });
  }
  const stored = plain(history);
  assert.equal(stored.length, 100);
  assert.equal(stored[0].id, "history-5");
  assert.equal(stored.at(-1).id, "history-104");

  summary.winner = "8.000";
  assert.notEqual(stored.at(-1).winner, "8.000", "history must clone appended summaries");
});

test("cross-session stability requires a complementary confirmation run plus identical eligible evidence after 24 hours", () => {
  const standardOrders = [[
    ["A", "B", "C"],
    ["B", "C", "A"],
    ["C", "A", "B"]
  ]];
  const confirmationOrders = [[
    ["C", "B", "A"],
    ["A", "C", "B"],
    ["B", "A", "C"]
  ]];
  const common = {
    algorithmVersion: Core.version,
    taskVersion: Core.constants.taskVersion,
    profileSignature: "same-profile",
    mode: "standard",
    grid: "1.000|1.200|1.440",
    winner: "1.200",
    winnerKey: "candidate-middle",
    dominance: [
      { first: "candidate-middle", second: "candidate-low", dominates: true },
      { first: "candidate-middle", second: "candidate-high", dominates: true }
    ],
    confirmation: false,
    orderLabels: standardOrders,
    eligible: true
  };
  const prior = { ...common, id: "prior", completedAt: "2026-08-10T00:00:00.000Z" };
  const confirmation = {
    ...common,
    confirmation: true,
    orderLabels: confirmationOrders
  };
  const tooSoon = { ...confirmation, id: "too-soon", completedAt: "2026-08-10T23:59:59.999Z" };
  const exactDay = { ...confirmation, id: "exact-day", completedAt: "2026-08-11T00:00:00.000Z" };

  assert.equal(Core.findCrossSessionConfirmation([prior], tooSoon).stable, false);
  assert.equal(Core.findCrossSessionConfirmation([prior], exactDay).stable, true);
  assert.equal(
    Core.findCrossSessionConfirmation([prior], { ...common, id: "ordinary-second-standard", completedAt: exactDay.completedAt }).stable,
    false,
    "repeating an ordinary Standard run must not be mislabeled cross-session stable"
  );
  assert.equal(
    Core.findCrossSessionConfirmation([prior], { ...exactDay, id: "wrong-confirmation-orders", orderLabels: standardOrders }).stable,
    false,
    "the current session must use CBA / ACB / BAC complementary orders"
  );
  assert.equal(
    Core.findCrossSessionConfirmation([{ ...prior, orderLabels: confirmationOrders }], exactDay).stable,
    false,
    "the historical baseline must be the ordinary ABC / BCA / CAB session"
  );
  assert.equal(Core.findCrossSessionConfirmation([prior], { ...exactDay, id: "grid-change", grid: "1.000|1.250|1.500" }).stable, false);
  assert.equal(Core.findCrossSessionConfirmation([prior], { ...exactDay, id: "winner-change", winner: "1.440" }).stable, false);
  const failedConfirmation = Core.findCrossSessionConfirmation([prior], { ...exactDay, id: "failed-confirmation", winner: "1.440" });
  assert.equal(
    new Date(failedConfirmation.nextEligibleAt).getTime(),
    new Date(exactDay.completedAt).getTime() + 86_400_000,
    "a failed day-two confirmation must wait until day three instead of allowing same-day cherry-picking"
  );
  assert.equal(Core.findCrossSessionConfirmation([prior], { ...exactDay, id: "profile-change", profileSignature: "different-profile" }).stable, false);
  assert.equal(Core.findCrossSessionConfirmation([prior], { ...exactDay, id: "ineligible", eligible: false }).stable, false);
});

test("profile signatures distinguish both current sensitivity and speed-control priority", () => {
  const baseline = Core.profileSignature(baseProfile({ currentSens: 1.25, priority: "balance" }));
  assert.notEqual(baseline, Core.profileSignature(baseProfile({ currentSens: 1.5, priority: "balance" })));
  assert.notEqual(baseline, Core.profileSignature(baseProfile({ currentSens: 1.25, priority: "speed" })));
  assert.notEqual(
    Core.profileSignature(baseProfile({ currentSens: null, priority: "balance" })),
    Core.profileSignature(baseProfile({ currentSens: 1.25, priority: "balance" }))
  );
});

test("session summaries retain whether the run used ordinary or complementary blind-label orders", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "summary-orders");
  const expected = {
    false: [["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"]],
    true: [["C", "B", "A"], ["A", "C", "B"], ["B", "A", "C"]]
  };

  for (const confirmation of [false, true]) {
    const stage = Core.createBalancedStage("summary-order-stage", candidates, 404, 3, confirmation);
    const evaluation = Core.evaluateStage(
      stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [0.92, 1, 1.08]]),
      stage,
      "rifle",
      { mode: "standard" }
    );
    const session = {
      id: confirmation ? "confirmation-summary" : "standard-summary",
      inputMode: "raw",
      mode: "standard",
      confirmation,
      validTaskMs: 420000,
      anomalies: [],
      interruptions: [],
      profile: baseProfile(),
      stages: [stage],
      blocks: []
    };
    const result = {
      completedAt: "2026-08-12T00:00:00.000Z",
      main: evaluation.uniqueLeader,
      range: [evaluation.uniqueLeader],
      boundaryLimited: false,
      evaluation
    };
    const summary = plain(Core.createSessionSummary(session, result));
    assert.equal(summary.confirmation, confirmation);
    assert.deepEqual(summary.orderLabels.at(-1), expected[String(confirmation)]);
  }
});

test("session-summary eligibility excludes short, compatible, range-only, anomalous, and boundary-limited runs", () => {
  const candidates = Core.buildCandidates(baseProfile(), 1.25, 1.2, "eligibility");
  const stage = Core.createBalancedStage("coarse", candidates, 97, 3, false);
  const evaluation = Core.evaluateStage(
    stageBlocks(stage, [[0.92, 1, 1.08], [0.92, 1, 1.08], [0.92, 1, 1.08]]),
    stage,
    "rifle",
    { mode: "standard" }
  );
  const baseSession = {
    id: "session",
    inputMode: "raw",
    mode: "standard",
    validTaskMs: 420000,
    anomalies: [],
    interruptions: [],
    profile: baseProfile(),
    stages: [stage],
    blocks: []
  };
  const baseResult = {
    completedAt: "2026-08-12T00:00:00.000Z",
    main: evaluation.uniqueLeader,
    range: [evaluation.uniqueLeader],
    boundaryLimited: false,
    evaluation
  };

  assert.equal(Core.createSessionSummary(baseSession, baseResult).eligible, true);
  assert.equal(Core.createSessionSummary({ ...baseSession, validTaskMs: 419999 }, baseResult).eligible, false);
  assert.equal(Core.createSessionSummary({ ...baseSession, inputMode: "compat" }, baseResult).eligible, false);
  assert.equal(Core.createSessionSummary({ ...baseSession, mode: "quick" }, baseResult).eligible, false);
  assert.equal(Core.createSessionSummary({ ...baseSession, anomalies: ["stall"] }, baseResult).eligible, false);
  assert.equal(Core.createSessionSummary(baseSession, { ...baseResult, boundaryLimited: true }).eligible, false);
  assert.equal(Core.createSessionSummary(baseSession, { ...baseResult, main: null }).eligible, false);
});

test("RAF scheduler permits only one pending callback and is safe across reentrant transitions", () => {
  const clock = createVirtualRaf();
  const scheduler = Core.createRafScheduler(clock);
  const calls = [];

  const firstId = scheduler.request((now) => {
    calls.push(["first", now]);
    scheduler.request((nextNow) => calls.push(["second", nextNow]));
  });
  const duplicateId = scheduler.request(() => calls.push(["duplicate"]));
  assert.equal(duplicateId, firstId);
  assert.equal(clock.pendingCount(), 1);
  assert.equal(scheduler.pendingCount(), 1);

  clock.frame(16);
  assert.deepEqual(calls, [["first", 16]]);
  assert.equal(clock.pendingCount(), 1);
  assert.equal(scheduler.pendingCount(), 1);

  clock.frame(17);
  assert.deepEqual(calls, [["first", 16], ["second", 33]]);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(scheduler.pendingCount(), 0);

  scheduler.request(() => calls.push(["cancelled"]));
  scheduler.cancel();
  assert.equal(clock.pendingCount(), 0);
  scheduler.destroy();
  assert.equal(scheduler.request(() => calls.push(["after-destroy"])), null);
  assert.equal(clock.pendingCount(), 0);

  const zeroQueue = [];
  const zeroIdScheduler = Core.createRafScheduler({
    requestFrame(callback) {
      zeroQueue.push(callback);
      return 0;
    },
    cancelFrame() {}
  });
  zeroIdScheduler.request(() => {});
  zeroIdScheduler.request(() => {});
  assert.equal(zeroQueue.length, 1, "RAF id 0 must still be treated as pending");
  assert.equal(zeroIdScheduler.pendingCount(), 1);
});

test("offline HTML has no automatic external resource or network API", () => {
  const resourceTags = [...html.matchAll(/<(script|link|img|iframe|audio|video|source)\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of resourceTags) {
    assert.doesNotMatch(tag, /\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i, tag);
  }
  assert.doesNotMatch(html, /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /url\(\s*["']?\s*(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bimport\s*\(/);
});

test("offline copy states the evidence boundary and tool-compatible sensitivity range", () => {
  assert.match(html, /非官方网页模拟/);
  assert.match(html, /不连接 Aim Lab/);
  assert.match(html, /未经过 CS2 游戏内提升验证/);
  assert.match(html, /0\.100[–-]8\.000/);
  assert.match(html, /非 Valve 官方边界/);
});
