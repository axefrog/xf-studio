// The senses for the Story Engine (research/story-engine/runtime-requirements.md S2 to S6): world.facts with its presets,
// world.district, player.status and scene.read's npc_detail, through the command API against the self-test host
// (selftest/SimSenses.cpp), plus the offline pieces: the presets kept in step with the research data, and a source check that
// the redscript layer's senses only read. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { CATALOGUE, findCommand } from "../api/catalogue.ts";
import { FINAL_BOARDS_FACTS, MAIN_STORY_FACTS } from "../api/fact-presets.ts";
import { expandFacts, FACT_PRESETS, MAX_FACTS, SENSES_COMMANDS } from "../api/catalogueSenses.ts";
import { validate } from "../api/schema.ts";
import { FACTS_JSON, finalBoards, mainStory, PRESETS_OUT, render } from "../gen-fact-presets.ts";
import { HOOK_TIMEOUT_MS, projectDir, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-senses-cap-"), "captures"), auditDir: tempDir("xfb-senses-audit-"), idleCloseMs: 300 });

async function ok(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<Any> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} ${JSON.stringify(out)}`).toBe(true);
  return out.ok ? (out.result as Any) : null;
}

async function refused(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<string> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} should be refused: ${JSON.stringify(out)}`).toBe(false);
  return out.ok ? "" : out.error.code;
}

async function phase(api: CommandApi, value: string) {
  const response = await api.callBridge("selftest.phase", { phase: value }, "t-phase");
  expect(response.ok, JSON.stringify(response)).toBe(true);
}

describe("the fact presets stay in step with the research data", () => {
  test("fact-presets.ts is what the generator writes from main-story-facts.json and the main-story page", () => {
    expect(readFileSync(PRESETS_OUT, "utf8").replace(/\r\n/g, "\n")).toBe(render());
  });

  test("main_story is every fact of the research table, in its order, with its category", () => {
    const json = JSON.parse(readFileSync(FACTS_JSON, "utf8")) as { facts: { name: string; category: string }[] };
    expect(MAIN_STORY_FACTS.map((f) => f.name)).toEqual(json.facts.map((f) => f.name));
    expect(MAIN_STORY_FACTS.map((f) => f.category)).toEqual(json.facts.map((f) => f.category));
    expect(MAIN_STORY_FACTS).toHaveLength(93);
    expect(mainStory()).toHaveLength(MAIN_STORY_FACTS.length);
    expect(FACT_PRESETS.main_story!.facts).toHaveLength(93);
  });

  test("final_boards is the page's list of what the final boards read", () => {
    expect([...FINAL_BOARDS_FACTS]).toEqual(finalBoards());
    expect(FINAL_BOARDS_FACTS).toHaveLength(25);
    expect(FINAL_BOARDS_FACTS).toContain("q114_done");
    expect(FINAL_BOARDS_FACTS).toContain("q306_finale_deal_done");
  });

  test("every preset name is a valid fact name and a preset fits in one read", () => {
    for (const [name, preset] of Object.entries(FACT_PRESETS)) {
      expect(preset.facts.length, name).toBeLessThanOrEqual(MAX_FACTS);
      expect(new Set(preset.facts).size, `${name} has no repeats`).toBe(preset.facts.length);
      for (const fact of preset.facts) expect(fact, `${name}: ${fact}`).toMatch(/^[A-Za-z0-9_.]{1,96}$/);
    }
  });

  test("expanding: a preset, extra facts merged without repeats, the cap, an unknown preset, nothing", () => {
    expect(expandFacts({ preset: "main_story" }).facts).toHaveLength(93);
    const merged = expandFacts({ preset: "final_boards", facts: ["q114_done", "my_own_fact"] }).facts;
    expect(merged).toHaveLength(26);
    expect(merged.at(-1)).toBe("my_own_fact");
    const many = Array.from({ length: MAX_FACTS + 1 }, (_, i) => `fact_${i}`);
    expect(() => expandFacts({ facts: many })).toThrow(/at most 128/);
    expect(() => expandFacts({ preset: "nope" })).toThrow(/Unknown preset/);
    expect(() => expandFacts({})).toThrow(/Give facts/);
    expect(expandFacts({ facts: Array.from({ length: MAX_FACTS }, (_, i) => `fact_${i}`) }).facts).toHaveLength(MAX_FACTS);
  });
});

describe("the senses are read-only", () => {
  const source = readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeSenses.reds"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");

  test("the redscript layer calls no setter, queue, request or event, and takes no save lock", () => {
    expect(code).not.toMatch(/\.(Set\w*|Queue\w*|Request\w*|Add\w*|Remove\w*|Toggle\w*|Signal\w*|Teleport\w*)\s*\(/);
    expect(code).not.toMatch(/EnsureSaveLock|RestoreAfterKill|MarkWrite|SetFact|ArrayClear\(items/);
  });

  test("CityAreaType is not read (session 14: 0 everywhere)", () => {
    expect(code).not.toContain("CityAreaType");
  });

  test("the three commands are read-only in the catalogue and each has refusals", () => {
    expect(SENSES_COMMANDS.map((c) => c.name)).toEqual(["world.facts", "world.district", "player.status"]);
    for (const command of SENSES_COMMANDS) {
      expect(command.permission, command.name).toBe("read");
      const listed = CATALOGUE.find((c) => c.name === command.name);
      expect(listed, command.name).toBeDefined();
      expect(listed!.refusals?.length, command.name).toBeGreaterThan(0);
      expect(listed!.refusals).toContain("game_not_ready");
    }
  });
});

describe("the senses through the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost([], 240);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  }, HOOK_TIMEOUT_MS);

  test("world.facts: the main-story preset in one call, grouped by category", async () => {
    await phase(api, "gameplay");
    const out = await ok(api, "world.facts", { preset: "main_story" });
    expect(Object.keys(out.facts)).toHaveLength(93);
    expect(out).toMatchObject({ requested: 93, preset: "main_story", game_version: "2.31" });
    expect(out.facts.q000_done).toBe(1);
    expect(out.nonzero).toBeGreaterThanOrEqual(1);
    expect(Object.keys(out.by_category).sort()).toEqual([...new Set(MAIN_STORY_FACTS.map((f) => f.category))].sort());
    expect(out.by_category.spine.q000_done).toBe(1);
  });

  test("world.facts: named facts, the cap, repeated names, bad names", async () => {
    const some = await ok(api, "world.facts", { facts: ["q104_mitch_rescued", "q114_started", "never_set"] });
    expect(some.facts).toEqual({ q104_mitch_rescued: 1, q114_started: 2, never_set: 0 });
    expect(some).toMatchObject({ requested: 3, nonzero: 2 });
    expect(some).not.toHaveProperty("preset");
    const names = Array.from({ length: 128 }, (_, i) => `fact_${i}`);
    expect(Object.keys((await ok(api, "world.facts", { facts: names })).facts)).toHaveLength(128);
    expect(await refused(api, "world.facts", { facts: [...names, "one_more"] })).toBe("bad_input");
    expect(await refused(api, "world.facts", {})).toBe("bad_input");
    expect(await refused(api, "world.facts", { preset: "nope" })).toBe("bad_input");
    expect(await refused(api, "world.facts", { facts: ["has space"] })).toBe("bad_input");
    expect(await refused(api, "world.facts", { facts: ["x".repeat(97)] })).toBe("bad_input");
    // The bridge checks the names itself, whatever a client sends it.
    const raw = await api.callBridge("world.facts", { facts: ["fine", "bad,name"] }, "t-raw");
    expect(raw.ok).toBe(false);
    expect(raw.ok ? "" : raw.error.code).toBe("bad_params");
    const rawMany = await api.callBridge("world.facts", { facts: names.concat(["extra"]) }, "t-raw2");
    expect(rawMany.ok ? "" : rawMany.error.code).toBe("bad_params");
  });

  test("world.district: a place inside a subdistrict inside a district, a plain district, and not known yet", async () => {
    await phase(api, "gameplay");
    await api.callBridge("selftest.senses", { district: "place" }, "t-d0");
    const place = await ok(api, "world.district");
    expect(place).toMatchObject({ levels: 3, district: { enum: "Watson" }, subdistrict: { enum: "Kabuki" }, place: { enum: "Kabuki_NoTellMotel" }, area: { enum: "Kabuki_NoTellMotel" } });
    expect(place.chain).toEqual(["Kabuki_NoTellMotel", "Kabuki", "Watson"]);
    expect(place.map.agrees).toBe(true);
    await api.callBridge("selftest.senses", { district: "district" }, "t-d");
    const plain = await ok(api, "world.district");
    expect(plain).toMatchObject({ levels: 1, subdistrict: null, place: null });
    await api.callBridge("selftest.senses", { district: "none" }, "t-d2");
    expect(await refused(api, "world.district")).toBe("no_district");
    await api.callBridge("selftest.senses", { district: "place" }, "t-d3");
    expect(await refused(api, "world.district", { x: 1 })).toBe("bad_input");
  });

  test("player.status: every part by default, chosen parts, the vehicle and the scanner", async () => {
    await phase(api, "gameplay");
    const all = await ok(api, "player.status");
    expect(Object.keys(all).filter((k) => !["simulated", "phase"].includes(k)).sort()).toEqual(["heat", "inventory", "money", "progress", "scanner", "vehicle", "vitals"]);
    expect(all.vitals).toMatchObject({ health: 450, health_max: 500 });
    expect(all.progress).toMatchObject({ level: 21, street_cred: 34 });
    expect(all.money).toBe(12345);
    expect(all.heat).toMatchObject({ stage: 0, star_state: "Default", chasing: false });
    expect(all.vehicle).toEqual({ mounted: false });
    expect(all.inventory.types.length).toBeGreaterThan(0);
    expect(all.scanner).toMatchObject({ scanning: false, scanned_object: null });
    await api.callBridge("selftest.senses", { vehicle: true, scanning: true }, "t-s");
    const some = await ok(api, "player.status", { parts: ["vehicle", "scanner", "vehicle"] });
    expect(Object.keys(some).filter((k) => !["simulated", "phase"].includes(k)).sort()).toEqual(["scanner", "vehicle"]);
    expect(some.vehicle).toMatchObject({ mounted: true, driver: true });
    expect(some.scanner).toMatchObject({ scanning: true, scanned_object: { loaded: true } });
    expect(await refused(api, "player.status", { parts: ["wallet"] })).toBe("bad_input");
    await api.callBridge("selftest.senses", { vehicle: false, scanning: false }, "t-s2");
  });

  test("every sense refuses while the game has no world: the main menu and a loading screen", async () => {
    for (const where of ["main_menu", "loading"]) {
      await phase(api, where);
      expect(await refused(api, "world.facts", { facts: ["q000_done"] }), `facts in ${where}`).toBe("game_not_ready");
      expect(await refused(api, "world.district"), `district in ${where}`).toBe("game_not_ready");
      expect(await refused(api, "player.status"), `status in ${where}`).toBe("game_not_ready");
    }
    await phase(api, "gameplay");
    expect((await ok(api, "world.facts", { facts: ["q000_done"] })).facts.q000_done).toBe(1);
  });

  test("scene.read: npc_detail adds each NPC's character record, and only when asked", async () => {
    await phase(api, "gameplay");
    const plain = await ok(api, "scene.read", { parts: ["npcs"], radius: 20 });
    expect(plain.npcs.length).toBeGreaterThan(0);
    for (const npc of plain.npcs) expect(npc).not.toHaveProperty("character");
    expect(plain).not.toHaveProperty("npc_detail");
    const detailed = await ok(api, "scene.read", { parts: ["npcs"], radius: 20, npc_detail: true });
    expect(detailed.npc_detail).toBe(true);
    const a = detailed.npcs.find((n: Any) => n.record === "Character.Sim_NPC_A");
    expect(a.character).toMatchObject({ affiliation: { record: "Factions.TygerClaws", name: "TygerClaws" }, npc_type: "Human", crowd: false });
    const b = detailed.npcs.find((n: Any) => n.record === "Character.Sim_NPC_B");
    expect(b.character).toBeNull();
    expect(await refused(api, "scene.read", { npc_detail: "yes" })).toBe("bad_input");
  });

  test("the catalogue knows the new reads, and scene.read's schema takes npc_detail", () => {
    expect(findCommand("world_facts")?.name).toBe("world.facts");
    expect(findCommand("player_status")?.name).toBe("player.status");
    expect(validate(findCommand("scene.read")!.input, { npc_detail: true })).toEqual([]);
    expect(validate(findCommand("world.facts")!.input, { preset: "main_story" })).toEqual([]);
    expect(validate(findCommand("world.facts")!.input, { preset: "nope" }).length).toBeGreaterThan(0);
  });
});
