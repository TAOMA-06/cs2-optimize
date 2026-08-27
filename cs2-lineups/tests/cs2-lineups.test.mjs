import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(workspace, "index.html");
const html = readFileSync(htmlPath, "utf8");

function scriptById(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<script\\b[^>]*\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  assert.ok(match, `missing inline script #${id}`);
  return match[1];
}

function loadContext() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  new vm.Script(scriptById("lineups-data"), { filename: `${htmlPath}#lineups-data` }).runInContext(context);
  new vm.Script(scriptById("lineups-core"), { filename: `${htmlPath}#lineups-core` }).runInContext(context);
  assert.ok(context.CS2LineupsCore, "lineups-core did not export CS2LineupsCore");
  return context;
}

const context = loadContext();
const Core = context.CS2LineupsCore;
const MAP_DIRECTORY = context.MAP_DIRECTORY;
const MAP_CATALOG = context.MAP_CATALOG;

test("empty hash initializes as map selection", () => {
  assert.deepEqual(Core.normalizeRoute(Core.parseRoute("")), { version: 1, screen: "maps" });
  assert.deepEqual(Core.normalizeRoute(Core.parseRoute("#")), { version: 1, screen: "maps" });
  assert.equal(Core.serializeRoute(Core.normalizeRoute(Core.parseRoute("#/maps"))), "#/maps");
});

test("seven Active Duty maps have correct availability", () => {
  assert.deepEqual(MAP_DIRECTORY.map((entry) => entry.id), ["cache", "mirage", "dust2", "inferno", "nuke", "ancient", "anubis"]);
  assert.equal(MAP_DIRECTORY.find((entry) => entry.id === "mirage").status, "available");
  assert.equal(MAP_DIRECTORY.find((entry) => entry.id === "dust2").status, "available");
  assert.equal(MAP_DIRECTORY.find((entry) => entry.id === "mirage").lineupCount, MAP_CATALOG.mirage.lineups.length);
  assert.equal(MAP_DIRECTORY.find((entry) => entry.id === "dust2").lineupCount, MAP_CATALOG.dust2.lineups.length);
  for (const id of ["cache", "inferno", "nuke", "ancient", "anubis"]) {
    const entry = MAP_DIRECTORY.find((item) => item.id === id);
    assert.equal(entry.status, "coming-soon");
    assert.equal(entry.lineupCount, 0);
    assert.equal(Core.isAvailableMap(id), false);
    assert.deepEqual(Core.normalizeRoute({ version: 1, screen: "side", mapId: id }), { version: 1, screen: "maps" });
  }
});

test("hash routes round-trip and parent chain is maps <- side <- radar <- nearby <- lineup", () => {
  const examples = [
    "#/maps",
    "#/side/mirage",
    "#/radar/mirage/T/nearby",
    "#/nearby/mirage/T/512/386",
    "#/lineup/mirage/demo-t-window-smoke",
    "#/radar/mirage/T/opening",
    "#/opening/mirage/T/spawn/mirage-t-01/objective",
    "#/opening/mirage/T/plan/demo-plan-t-mid",
    "#/opening/mirage/T/plan/demo-plan-t-mid/step/1",
    "#/favorites"
  ];
  for (const hash of examples) {
    const parsed = Core.normalizeRoute(Core.parseRoute(hash));
    assert.equal(Core.serializeRoute(parsed), hash, hash);
  }

  const lineup = Core.normalizeRoute({
    version: 1,
    screen: "lineup",
    mapId: "mirage",
    lineupId: "demo-t-window-smoke",
    point: { x: 512, y: 386, layerId: "main" }
  });
  const nearby = Core.parentRoute(lineup);
  const radar = Core.parentRoute(nearby);
  const side = Core.parentRoute(radar);
  const maps = Core.parentRoute(side);
  assert.equal(nearby.screen, "nearby");
  assert.equal(radar.screen, "radar");
  assert.equal(radar.radarMode, "nearby");
  assert.equal(side.screen, "side");
  assert.equal(maps.screen, "maps");
});

test("invalid hashes, coordinates, lineups and retired content fall back safely", () => {
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/nope")).screen, "maps");
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/side/train")).screen, "maps");
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/radar/mirage/X/nearby")).screen, "radar");
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/nearby/mirage/T/1/1")).screen, "radar");
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/nearby/mirage/T/1/1")).radarMode, "nearby");
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/lineup/mirage/does-not-exist")).screen, "radar");
  assert.equal(Core.normalizeRoute(Core.parseRoute("#/opening/mirage/T/plan/retired-plan")).screen, "radar");
  assert.equal(Core.normalizeRoute({
    version: 1,
    screen: "lineup",
    mapId: "mirage",
    lineupId: "demo-t-window-smoke",
    point: { x: 1, y: 1 }
  }).point, undefined);
});

test("Mirage mid click returns grenade-grouped nearby results without mixing far lineups", () => {
  const mapData = MAP_CATALOG.mirage;
  const point = { x: 512, y: 386, layerId: "main" };
  const zone = Core.findZoneForPoint(point, mapData.zones);
  assert.equal(zone.id, "mid");
  const tResult = Core.queryNearbyLineups({ mapData, side: "T", point });
  const ctResult = Core.queryNearbyLineups({ mapData, side: "CT", point });
  assert.ok(tResult.nearby.length > 0);
  assert.equal(tResult.nearby.every((item) => item.proximity === "current" || item.proximity === "neighbor"), true);
  assert.equal(tResult.far.every((item) => item.proximity === "far"), true);
  assert.equal(tResult.nearby.some((item) => item.proximity === "far"), false);
  const grouped = Core.groupLineupsByGrenade(tResult.nearby);
  const orderIndex = (type) => ["smoke", "flash", "molotov", "he"].indexOf(type);
  for (let i = 1; i < grouped.length; i += 1) {
    assert.ok(orderIndex(grouped[i - 1].type) < orderIndex(grouped[i].type));
  }
  assert.equal(grouped.reduce((sum, group) => sum + group.entries.length, 0), tResult.nearby.length);
  assert.equal(grouped.every((group) => group.entries.length > 0), true);
  assert.ok(ctResult.nearby.length > 0);
  assert.equal(
    tResult.nearby.length + tResult.far.length,
    mapData.lineups.filter((lineup) => lineup.side === "T").length
  );
});

test("Dust II mid click stays on its own catalog", () => {
  const mapData = MAP_CATALOG.dust2;
  const point = { x: 520, y: 500, layerId: "main" };
  const zone = Core.findZoneForPoint(point, mapData.zones);
  assert.equal(zone.id, "mid");
  const result = Core.queryNearbyLineups({ mapData, side: "T", point });
  assert.ok(result.nearby.length > 0);
  assert.equal(result.nearby.every((item) => item.lineup.id.startsWith("demo-d2-")), true);
});

test("v1 state migrates allowed fields only and does not keep workbench filters", () => {
  const migrated = Core.migrateUserState(null, {
    schemaVersion: 1,
    mapId: "dust2",
    mode: "opening",
    side: "CT",
    grenadeFilter: "smoke",
    favoritesOnly: true,
    favorites: ["demo-t-window-smoke", "missing-id"],
    notes: { "demo-t-window-smoke": "keep me", "missing-id": "drop" },
    recent: ["demo-t-window-smoke"],
    currentPoint: { x: 512, y: 386, layerId: "main" },
    selectedSpawnId: "dust2-ct-01",
    selectedObjective: "ct-b",
    activePlanId: "demo-d2-plan-ct-b",
    planStepIndex: 2
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.defaultSide, "CT");
  assert.deepEqual(migrated.favorites, ["demo-t-window-smoke"]);
  assert.equal(migrated.notes["demo-t-window-smoke"], "keep me");
  assert.equal(migrated.notes["missing-id"], undefined);
  assert.deepEqual(migrated.recent, ["demo-t-window-smoke"]);
  assert.equal(migrated.mapId, undefined);
  assert.equal(migrated.mode, undefined);
  assert.equal(migrated.grenadeFilter, undefined);
  assert.equal(migrated.favoritesOnly, undefined);
  assert.equal(migrated.currentPoint, undefined);
  assert.equal(migrated.opening.mapId, "dust2");
  assert.equal(migrated.opening.planId, "demo-d2-plan-ct-b");
  assert.equal(migrated.opening.stepIndex, 2);
  assert.equal(migrated.opening.spawnId, "dust2-ct-01");
});

test("opening parent routes stay on the opening branch", () => {
  const step = Core.normalizeRoute(Core.parseRoute("#/opening/mirage/T/plan/demo-plan-t-mid/step/1"));
  const plan = Core.parentRoute(step);
  const radar = Core.parentRoute(Core.normalizeRoute(Core.parseRoute("#/opening/mirage/T/spawn/mirage-t-01/objective")));
  assert.equal(plan.screen, "opening-plan");
  assert.equal(plan.planId, "demo-plan-t-mid");
  assert.equal(radar.screen, "radar");
  assert.equal(radar.radarMode, "opening");
  const completed = Core.normalizeRoute({
    version: 1,
    screen: "opening-step",
    mapId: "mirage",
    side: "T",
    planId: "demo-plan-t-mid",
    stepIndex: 99
  });
  assert.equal(
    completed.stepIndex,
    MAP_CATALOG.mirage.openingPlans.find((planItem) => planItem.id === "demo-plan-t-mid").steps.length + 1
  );
});

test("missing media helper never invents image data", () => {
  const lineup = MAP_CATALOG.mirage.lineups[0];
  assert.equal(Core.frameSource(lineup, "aim"), null);
  assert.equal(Core.nextFrame("aim", 1), "result");
  assert.equal(Core.nextFrame("aim", -1), "stance");
  assert.equal(Core.nextFrame("stance", -1), "stance");
  assert.equal(Core.nextFrame("result", 1), "result");
});
