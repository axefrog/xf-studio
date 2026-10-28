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
import { FACTS_JSON, finalBoards, finalBoardsFrom, mainStory, PRESETS_OUT, render } from "../gen-fact-presets.ts";
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
    expect(FINAL_BOARDS_FACTS).toContain("q114_done");
    expect(FINAL_BOARDS_FACTS).toContain("q306_finale_deal_done");
  });

  // The Sol review of the senses (finding 2): the page writes "the four `q115_*_romance_chosen` facts" and the first generator
  // read only plain names, so it dropped them without a word (25 instead of 29), and the check above used the same parser.
  // These assertions do not use the parser: the count is counted by hand from the page's list, the four names come from the
  // research table, and the page's backticked entries are counted separately.
  test("final_boards holds all 29, the four romance facts among them (independent of the generator's parser)", () => {
    expect(FINAL_BOARDS_FACTS).toHaveLength(29);
    expect(new Set(FINAL_BOARDS_FACTS).size).toBe(29);
    for (const who of ["panam", "judy", "kerry", "river"]) {
      const name = `q115_${who}_romance_chosen`;
      expect(FINAL_BOARDS_FACTS, name).toContain(name);
      expect(MAIN_STORY_FACTS.map((f) => f.name), `${name} is in the research table`).toContain(name);
    }
    // 25 plain names on the page plus the one pattern that stands for four: 25 + 4 = 29.
    const page = readFileSync(join(projectDir, "..", "..", "knowledge", "main-story-state.md"), "utf8").replace(/\r\n/g, "\n");
    const start = page.indexOf("The final boards phase reads");
    const list = page.slice(start, page.indexOf("That list is", start));
    const entries = [...list.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
    const patterns = entries.filter((e) => e.includes("*"));
    expect(patterns).toEqual(["q115_*_romance_chosen"]);
    expect(entries.length - patterns.length + 4).toBe(29);
  });

  test("the generator refuses an entry it cannot read instead of dropping it", () => {
    const original = readFileSync(join(projectDir, "..", "..", "knowledge", "main-story-state.md"), "utf8");
    // finalBoards() reads the real page; the refusal is exercised through the same function on altered copies of the page text,
    // altered inside the final boards paragraph (the page names some of these facts elsewhere too).
    const at = original.indexOf("The final boards phase reads");
    const inList = (from: string, to: string) => original.slice(0, at) + original.slice(at).replace(from, to);
    expect(() => finalBoardsFrom(inList("`sq017_done`", "`Sq017 Done`"))).toThrow(/cannot read the entry/);
    expect(() => finalBoardsFrom(inList("`q115_*_romance_chosen`", "`q999_*_nothing`"))).toThrow(/matches no fact/);
    expect(() => finalBoardsFrom(inList("`q115_*_romance_chosen`", "`q115_*_*_chosen`"))).toThrow(/cannot read the entry/);
    expect(finalBoardsFrom(original)).toHaveLength(29);
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
    expect(merged).toHaveLength(30);
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

  test("the four commands are read-only in the catalogue and each has refusals", () => {
    expect(SENSES_COMMANDS.map((c) => c.name)).toEqual(["world.events", "world.facts", "world.district", "player.status"]);
    for (const command of SENSES_COMMANDS) {
      expect(command.permission, command.name).toBe("read");
      const listed = CATALOGUE.find((c) => c.name === command.name);
      expect(listed, command.name).toBeDefined();
      expect(listed!.refusals?.length, command.name).toBeGreaterThan(0);
      if (command.name === "world.events") expect(listed!.refusals).toContain("bad_params");
      else expect(listed!.refusals).toContain("game_not_ready");
    }
  });
});

// The Sol review of the senses: the redscript layer has no test host of its own, so these read the source, as the rest of this
// file does.
describe("the Sol review's fixes in the redscript layer", () => {
  const source = readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeSenses.reds"), "utf8").replace(/\r\n/g, "\n");
  const code = source.replace(/\/\/.*$/gm, "");
  const body = (name: string) => {
    const start = code.indexOf(`func ${name}(`);
    expect(start, name).toBeGreaterThan(0);
    const next = code.indexOf("  public static func ", start + 10);
    return code.slice(start, next > 0 ? next : undefined);
  };

  test("finding 1: the inventory read is bounded, indexed by type and says when it was cut", () => {
    const inventory = body("Inventory");
    expect(inventory).toContain("XFSenses.InventoryCap()");
    expect(inventory).toMatch(/while i < limit \{/);
    expect(inventory).toContain("\\\"truncated\\\":");
    expect(inventory).toContain("\\\"total_stacks\\\":");
    // No linear search per stack; the stacks are counted in arrays indexed by the item type's enum value.
    expect(code).not.toContain("ArrayFindFirst");
    expect(inventory).toMatch(/stacks\[type\] \+= 1;/);
    // The per-stack native calls are the ones the summary needs; 0.8.9 adds the item id (the equipped check) and the
    // screen's filter (HiddenInBackpack: its tags and the preview flag).
    const loop = inventory.slice(inventory.indexOf("while i < limit {"), inventory.indexOf("let out ="));
    expect([...new Set([...loop.matchAll(/item\.(\w+)\(/g)].map((m) => m[1]))].sort()).toEqual(["GetID", "GetItemType", "GetQuantity", "HasTag"]);
    expect(loop).toContain("XFSenses.HiddenInBackpack(item)");
    const cap = /func InventoryCap\(\) -> Int32 \{\s*return (\d+);/.exec(code);
    expect(cap).not.toBeNull();
    expect(Number(cap![1])).toBeLessThanOrEqual(2000);
    expect(Number(cap![1])).toBeGreaterThan(0);
  });

  test("finding 3: a separator follows the entries written, never the source index, wherever a loop skips entries", () => {
    expect(body("DistrictRecordJson")).toMatch(/emitted > 0/);
    expect(body("DistrictRecordJson")).not.toMatch(/if i > 0/);
    // Any loop that skips entries (an `if IsDefined(` inside a while) and writes a comma must count what it wrote.
    const loops = code.split(/\n\s*while /).slice(1);
    let checked = 0;
    for (const loop of loops) {
      const text = loop.slice(0, loop.indexOf("\n    }\n") > 0 ? loop.indexOf("\n    }\n") + 8 : undefined);
      if (/\bif IsDefined\(/.test(text) && /out \+= ","/.test(text)) {
        checked += 1;
        expect(text, text.slice(0, 60)).toMatch(/emitted > 0/);
        expect(text, text.slice(0, 60)).not.toMatch(/if i > 0/);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
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

  // The Sol review of the senses (finding 4): in the game the dispatcher's gate (the script layer) refuses first, so on the main
  // menu, between sessions and during a load a caller sees game_loading; game_not_ready is only the script's own answer when the
  // gate is open and the game has no world (the test above). Both are real, and the docs name both.
  test("while the script layer is detached or a load is requested, every sense is refused game_loading by the gate, before the script", async () => {
    const layer = async (event: string) => {
      const response = await api.callBridge("selftest.script_layer", { event }, "t-layer");
      expect(response.ok, JSON.stringify(response)).toBe(true);
      return response.ok ? (response.result as { state: string; ready: boolean }) : null;
    };
    const reads = async (where: string) => {
      expect(await refused(api, "world.facts", { facts: ["q000_done"] }), `facts ${where}`).toBe("game_loading");
      expect(await refused(api, "world.district"), `district ${where}`).toBe("game_loading");
      expect(await refused(api, "player.status"), `status ${where}`).toBe("game_loading");
      expect(await refused(api, "scene.read", { parts: ["npcs"], npc_detail: true }), `npc_detail ${where}`).toBe("game_loading");
    };
    await phase(api, "gameplay");
    expect((await ok(api, "world.facts", { facts: ["q000_done"] })).facts.q000_done).toBe(1);
    expect((await layer("detach"))?.ready).toBe(false);
    await reads("after a detach");
    // The phase says gameplay here, so the refusal can only be the gate's.
    await layer("attach");
    await reads("attached, the player not yet in");
    await layer("player_attach");
    expect((await ok(api, "world.district")).levels).toBeGreaterThan(0);
    expect((await layer("load_requested"))?.ready).toBe(false);
    await reads("with a load requested");
    await layer("detach");
    await layer("attach");
    await layer("player_attach");
    expect((await ok(api, "player.status", { parts: ["money"] })).money).toBe(12345);
  });

  test("the catalogue and the docs name both refusals: game_loading (the gate) and game_not_ready (the script)", () => {
    for (const command of SENSES_COMMANDS.filter(c => c.name !== "world.events")) {
      expect(command.description, command.name).toMatch(/game_loading/);
      expect(command.description, command.name).toMatch(/game_not_ready/);
    }
    expect(readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeSenses.reds"), "utf8")).toMatch(/game_loading.*gate/s);
  });

  test("the inventory summary says how much it read", async () => {
    await phase(api, "gameplay");
    const inventory = (await ok(api, "player.status", { parts: ["inventory"] })).inventory;
    expect(inventory).toMatchObject({ stacks: 3, total_stacks: 3, truncated: false, quest_stacks: 1, other_stacks: 0 });
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
