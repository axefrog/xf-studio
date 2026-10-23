// Bridge 0.8's NPC direction (research/runtime/npc-direction-design.md), offline: the catalogue's npc commands and their
// mapping, the scenario checker and runner, the actor records against the native tables; and against the self-test host's
// simulated street (selftest/SimNpc.cpp, the plugin's own core/Npc.cpp service): the npc write class, refusals in the
// design's order, protected and busy picks, spawn limits, commands and their events, lines, gestures, dialogue choices
// answered through session.wait, walk_away, save holds, automatic release on combat, a handover and a load, the kill switch,
// and the first scenario end to end; the Story Engine's staging needs (mortal and hostile stand-ins handed back in a fight,
// an out-of-sight spawn, the dissolve release) and the handover's release in its own request. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { CATALOGUE, findCommand, PERMISSIONS } from "../api/catalogue.ts";
import { NPC_CASTS, NPC_EXPRESSIONS, NPC_GESTURES, NPC_REFUSALS, NPC_TRIGGERS, NPC_WAIT_KINDS, npcParams } from "../api/catalogue080npc.ts";
import { NPC_MESSAGES } from "../api/errors080npc.ts";
import { plainBridgeError } from "../api/errors.ts";
import { WAIT_KINDS } from "../api/catalogue070.ts";
import { checkScenario, loadScenario, runScenario, SCENARIO_DIR, type Scenario } from "../npc/scenario.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const ALL = "photo,world,character,save,showroom,player,npc";
const npcSource = readFileSync(join(projectDir, "native", "src", "core", "Npc.cpp"), "utf8");

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-npc-cap-"), "captures"), auditDir: tempDir("xfb-npc-audit-"), idleCloseMs: 300 });

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

async function bridge(api: CommandApi, method: string, params: Record<string, unknown> = {}): Promise<Any> {
  const response = await api.callBridge(method, params, `t-${method}`);
  expect(response.ok, `${method} ${JSON.stringify(response)}`).toBe(true);
  return response.ok ? response.result : null;
}

/** Waits for an npc event after `since` (and for `who`), up to `ms`. */
async function event(api: CommandApi, kind: string, since: number, who?: string, ms = 8000): Promise<Any> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const read = await bridge(api, "session.events", { since, limit: 100, kinds: [kind] });
    const hit = (read.events as Any[]).find((e) => !who || e.data?.who === who);
    if (hit) return hit;
    await sleep(100);
  }
  throw new Error(`no ${kind}${who ? ` for ${who}` : ""} within ${ms} ms`);
}

const latest = async (api: CommandApi) => Number((await bridge(api, "session.events", { since: 0, limit: 1 })).latest ?? 0);

async function releaseAll(api: CommandApi) {
  await api.run("npc.release", { who: "all" });
  await bridge(api, "selftest.npc", { hub_busy: false, codeware: true, records_missing: false, carrier: true, speed: 8 });
  await bridge(api, "selftest.player", { busy: "", position: [100, 200, 10], yaw: 0 });
}

describe("0.8 npc offline: the catalogue, the scenario checker, the actor records", () => {
  test("every npc command is in the catalogue with the npc class (reads stay read), and the class has plain text", () => {
    const npc = CATALOGUE.filter((c) => c.name.startsWith("npc."));
    expect(npc.map((c) => c.name).sort()).toEqual(
      ["npc.act", "npc.choices", "npc.face", "npc.follow", "npc.list", "npc.look", "npc.move", "npc.pick", "npc.place", "npc.release", "npc.say", "npc.scenario", "npc.spawn", "npc.status", "npc.stop", "npc.turn"].sort(),
    );
    for (const c of npc) expect(c.permission).toBe(["npc.list", "npc.pick", "npc.status"].includes(c.name) ? "read" : "write-npc");
    expect(PERMISSIONS["write-npc"].label).toBe("Direct NPCs");
    for (const kind of NPC_WAIT_KINDS) expect(WAIT_KINDS).toContain(kind);
  });

  test("every npc command lists its own refusals, each with plain NPC wording", () => {
    for (const command of CATALOGUE.filter((c) => c.name.startsWith("npc."))) {
      const refusals = (command as Any).refusals as string[];
      expect(Array.isArray(refusals), command.name).toBe(true);
      expect(refusals).toEqual([...(NPC_REFUSALS[command.name] ?? [])]);
      for (const code of refusals) expect(NPC_MESSAGES[code], `${command.name}: ${code}`).toBeDefined();
    }
    expect(Object.keys(NPC_REFUSALS).sort()).toEqual(CATALOGUE.filter((c) => c.name.startsWith("npc.")).map((c) => c.name).sort());
    // A code the showroom shares reads right for NPCs, and stays the showroom's for the showroom.
    expect(plainBridgeError("too_far", "x", "npc.spawn").message).toContain("NPCs are directed within 30 m");
    expect(plainBridgeError("too_far", "x", "showroom.place").message).toContain("nothing was spawned there");
  });

  test("the point forms map onto the bridge's parameters", () => {
    expect(npcParams({ who: "a1", to_point: [1, 2, 3] })).toEqual({ who: "a1", to: [1, 2, 3] });
    expect(npcParams({ cast: "woman_corpo", ahead_m: 12, side_m: 4, face: "v" })).toEqual({ cast: "woman_corpo", at: { ahead_m: 12, side_m: 4 }, face: "v" });
    expect(npcParams({ cast: "woman_corpo", at_point: [1, 2, 3], face_point: [4, 5, 6] })).toEqual({ cast: "woman_corpo", at: [1, 2, 3], face: [4, 5, 6] });
    expect(npcParams({ who: "p1", at: "v" })).toEqual({ who: "p1", at: "v" });
    expect(npcParams({ cast: "woman_corpo", out_of_sight: true, min_m: 10 })).toEqual({ cast: "woman_corpo", at: "out_of_sight", min_m: 10 });
    expect(npcParams({ cast: "woman_corpo", out_of_sight: false, ahead_m: 3 })).toEqual({ cast: "woman_corpo", at: { ahead_m: 3 } });
  });

  test("the tools' lists equal the plugin's own tables (casts, expressions, triggers, gestures)", () => {
    for (const cast of NPC_CASTS) expect(npcSource).toContain(`{"${cast}", "Character.`);
    for (const expression of NPC_EXPRESSIONS) expect(npcSource).toContain(`{"${expression}", `);
    for (const trigger of NPC_TRIGGERS) expect(npcSource).toContain(`"${trigger}"`);
    for (const gesture of NPC_GESTURES) expect(npcSource).toContain(`{"${gesture}", "`);
    expect((npcSource.match(/\{"[a-z_]+", "Character\./g) ?? []).length).toBe(NPC_CASTS.length);
  });

  test("the actor records: one TweakXL clone per XF cast, none from Phantom Liberty, none crowd, none with a Talk prompt", () => {
    const yaml = (Bun as Any).YAML.parse(readFileSync(join(projectDir, "tweaks", "test-profile", "xf_npc_actors.yaml"), "utf8"));
    const records = npcSource.match(/"Character\.xfs_actor_[a-z_]+"/g)!.map((r) => r.slice(1, -1));
    expect(records.length).toBe(NPC_CASTS.length - 1); // research_crowd_record is the vanilla record itself
    for (const record of records) {
      const r = yaml[record];
      expect(r, record).toBeDefined();
      expect(r.$base).toMatch(/^Character\./);
      expect(String(r.entityTemplatePath)).toMatch(/^base\\characters\\entities\\citizen\\citizen__[a-z]+_[wm]a\.ent$/);
      expect(r.objectActions).toEqual([]);
      expect(r.savable).toBe(false);
      if (record !== "Character.xfs_actor_research_npc_base") expect(r.isCrowd).toBe(false);
    }
    expect(yaml["XFRuntimeBridge.Npc.actorsVersion"]).toBe(2);
    // V15: each cast (not the research ones) again with the game's own civilian reactions; nothing else differs.
    for (const record of records.filter((r) => !r.includes("research"))) {
      const reactive = yaml[`${record}_reactive`];
      expect(reactive, `${record}_reactive`).toBeDefined();
      expect(reactive.reactionPreset).toBe("ReactionPresets.Civilian_Neutral");
      expect({ ...reactive, reactionPreset: undefined }).toEqual({ ...yaml[record], reactionPreset: undefined });
    }
  });

  test("the first scenario is valid, and a dry run lists its branches", async () => {
    const scenario = loadScenario(join(SCENARIO_DIR, "stranger_question.json"));
    expect(checkScenario(scenario)).toEqual([]);
    const report = await runScenario(scenario, { api: null as Any, cid: "t", captureRoot: "" }, { dryRun: true });
    expect(report).toMatchObject({ ok: true, outcome: "checked", dry_run: true });
    const plan = report.steps.map((s) => s.plan).join("\n");
    expect(plan).toContain("do npc.spawn (stranger)");
    expect(plan).toContain("case 0");
    expect(plan).toContain("case timeout");
  });

  test("the checker names what's wrong in a scene", () => {
    const bad = {
      scenario: "Bad Name",
      actors: { v: { cast: "judy" } },
      steps: [
        { do: "npc.teleport", who: "v" },
        { wait: "npc.nothing", who: "stranger" },
        { on: "answer", cases: { 0: [{ do: "npc.say", who: "v", text: "x".repeat(300) }] } },
        { do: "npc.move", who: "v", to: "v", note: "two kinds" },
      ],
    } as Any as Scenario;
    const problems = checkScenario(bad).join("\n");
    expect(problems).toContain("scenario must be a short lowercase name");
    expect(problems).toContain('actor name "v"');
    expect(problems).toContain('actor "v" needs a cast');
    expect(problems).toContain('"npc.teleport" isn\'t an npc command');
    expect(problems).toContain("wait for one of");
    expect(problems).toContain('on "answer" needs an earlier wait');
    expect(problems).toContain("too long");
    expect(problems).toContain("exactly one of do, wait, on, pause or note");
  });
});

describe("0.8 npc against the self-test host's street", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = apiFor(host);
    await bridge(api, "selftest.npc", { speed: 8 });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    if (process.env.XFB_NPC_DEBUG) console.log(host.log.slice(-60).join("\n"), "exit", host.child.exitCode);
    await host?.stop();
  }, 30_000);

  test("npc.list: the street with protected reasons, busy NPCs and the session's own; pick refuses protected and busy ones", async () => {
    const list = await ok(api, "npc.list", { radius_m: 20 });
    const byId = Object.fromEntries((list.npcs as Any[]).map((n) => [n.id, n]));
    expect(byId["EntityID(9001)"]).toMatchObject({ crowd: true, protected: false });
    expect(byId["EntityID(9002)"]).toMatchObject({ protected: true, reasons: ["vendor"] });
    expect(byId["EntityID(9003)"].reasons).toEqual(["quest"]);
    expect(byId["EntityID(9004)"].busy).toBe("workspot");
    expect(await refused(api, "npc.pick", { id: "EntityID(9002)" })).toBe("npc_protected");
    expect(await refused(api, "npc.pick", { id: "EntityID(9004)" })).toBe("npc_busy");
    expect(await refused(api, "npc.pick", { id: "EntityID(1)" })).toBe("npc_not_found");
  }, 30_000);

  test("a pick takes look, face and say (with undos), never a move or a gesture; leave releases it", async () => {
    const since = await latest(api);
    const pick = await ok(api, "npc.pick", { id: "EntityID(9001)" });
    expect(pick.who).toBe("p1");
    expect(pick.undo).toEqual({ method: "npc.release", params: { who: "p1", how: "leave" } });
    expect((await ok(api, "npc.pick", { id: "EntityID(9001)" })).already).toBe(true);
    expect((await ok(api, "npc.look", { who: "p1", at: "v" })).undo).toEqual({ method: "npc.look", params: { who: "p1", off: true } });
    expect((await ok(api, "npc.face", { who: "p1", expression: "joy" })).undo).toEqual({ method: "npc.face", params: { who: "p1", off: true } });
    const said = await ok(api, "npc.say", { who: "p1", trigger: "greeting", text: "Hey there.", style: "overhead", seconds: 1 });
    expect(said.undo).toEqual({ method: "npc.say", params: { who: "p1", hide: said.line } });
    expect(said.trigger_note).toContain("the voice's");
    expect(await refused(api, "npc.move", { who: "p1", to: "v" })).toBe("not_ours");
    expect(await refused(api, "npc.act", { who: "p1", gesture: "wave" })).toBe("not_ours");
    await event(api, "npc.said", since, "p1");
    const street = await bridge(api, "selftest.npc", {});
    expect(street.actors.find((a: Any) => a.who === "p1")).toMatchObject({ face: [3, 5], trigger: "greeting", lines: [] });
    expect((await ok(api, "npc.list", {})).npcs.find((n: Any) => n.id === "EntityID(9001)").ours).toBe("p1");
    expect(await refused(api, "npc.release", { who: "p1", how: "despawn" })).toBe("bad_params");
    await ok(api, "npc.release", { who: "p1" });
    await event(api, "npc.released", since, "p1");
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 30_000);

  test("spawn: refusals in the design's order, the limit of three, npc.spawned, and its undo", async () => {
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 30, side_m: 30 })).toBe("too_far");
    await bridge(api, "selftest.player", { busy: "in_combat" });
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 5 })).toBe("in_combat");
    await bridge(api, "selftest.player", { busy: "" });
    await bridge(api, "selftest.npc", { codeware: false });
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 5 })).toBe("codeware_missing");
    await bridge(api, "selftest.npc", { codeware: true, records_missing: true });
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 5 })).toBe("record_missing");
    await bridge(api, "selftest.npc", { records_missing: false, no_ground: true });
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 5 })).toBe("not_walkable");
    const since = await latest(api);
    const a = await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 5, side_m: 1 });
    expect(a).toMatchObject({ who: "a1", cast: "woman_corpo", record: "Character.xfs_actor_woman_corpo", spawning: true });
    expect(a.asked_at[0]).toBeCloseTo(101, 5); // V at (100, 200) facing +Y: 5 m ahead, 1 m to the right
    expect(a.asked_at[1]).toBeCloseTo(205, 5);
    expect(a.undo).toEqual({ method: "npc.release", params: { who: "a1", how: "despawn" } });
    const spawned = await event(api, "npc.spawned", since, "a1");
    expect(spawned.data.cast).toBe("woman_corpo");
    await ok(api, "npc.spawn", { cast: "man_corpo", ahead_m: 6 });
    await ok(api, "npc.spawn", { cast: "woman_lowlife", ahead_m: 7 });
    expect(await refused(api, "npc.spawn", { cast: "man_lowlife", ahead_m: 8 })).toBe("limit");
    await releaseAll(api);
    expect((await ok(api, "npc.status")).actors).toBe(0);
  }, 30_000);

  test("move to V: npc.arrived near stop_m; a failed command; follow, turn, place and stop with their undos", async () => {
    let since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 10 });
    await event(api, "npc.spawned", since, "a4");
    const move = await ok(api, "npc.move", { who: "a4", to: "v", stop_m: 1.6 });
    expect(move.undo).toEqual({ method: "npc.stop", params: { who: "a4" } });
    const arrived = await event(api, "npc.arrived", since, "a4");
    expect(arrived.data.distance_v).toBeLessThan(2.3);
    await bridge(api, "selftest.npc", { fail_next_command: "not_walkable" });
    expect(await refused(api, "npc.move", { who: "a4", to_point: [100, 215, 10] })).toBe("not_walkable");
    expect(await refused(api, "npc.move", { who: "a4", to_point: [100, 260, 10] })).toBe("too_far");
    await ok(api, "npc.follow", { who: "a4", target: "v", distance_m: 2 });
    expect((await ok(api, "npc.status")).npcs[0].motion.kind).toBe("follow");
    const stop = await ok(api, "npc.stop", { who: "a4" });
    expect(stop).toMatchObject({ stopped: "follow", undo: null });
    await ok(api, "npc.turn", { who: "a4", to: "v" });
    const place = await ok(api, "npc.place", { who: "a4", at: [102, 203, 10], yaw: 90 });
    expect(place.undo.method).toBe("npc.place");
    expect(place.undo.params.who).toBe("a4");
    since = await latest(api);
    await releaseAll(api);
    await event(api, "npc.released", since, "a4");
  }, 30_000);

  test("lines: length and trigger checks, npc.said when a line's time ends, and hide", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a5");
    const long = await api.callBridge("npc.say", { who: "a5", text: "é".repeat(201) }, "t-long");
    expect(long.ok ? "" : long.error.code).toBe("line_too_long");
    const unknown = await api.callBridge("npc.say", { who: "a5", trigger: "start_combat" }, "t-trigger");
    expect(unknown.ok ? "" : unknown.error.code).toBe("trigger_unknown");
    expect(await refused(api, "npc.say", { who: "a5" })).toBe("bad_params");
    const line = await ok(api, "npc.say", { who: "a5", text: "Is the market still open?", seconds: 1 });
    expect(line.style).toBe("subtitle");
    const said = await event(api, "npc.said", since, "a5");
    expect(said.data.line).toBe(line.line);
    const second = await ok(api, "npc.say", { who: "a5", text: "Another line.", seconds: 15 });
    await ok(api, "npc.say", { who: "a5", hide: second.line });
    expect((await ok(api, "npc.status")).npcs[0].lines).toEqual([]);
    await releaseAll(api);
  }, 30_000);

  test("gestures: npc.act_done after its time; carrier_missing without the carrier; not while walking", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "man_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a6");
    const act = await ok(api, "npc.act", { who: "a6", gesture: "wave", seconds: 0.5 });
    expect(act.clip).toBe("stand__2h_on_sides__01__crowd_wave__01");
    expect(act.undo).toEqual({ method: "npc.act", params: { who: "a6", off: true } });
    const done = await event(api, "npc.act_done", since, "a6");
    expect(done.data.gesture).toBe("wave");
    await bridge(api, "selftest.npc", { carrier: false });
    expect(await refused(api, "npc.act", { who: "a6", gesture: "talk" })).toBe("carrier_missing");
    await bridge(api, "selftest.npc", { carrier: true, speed: 0.2 });
    await ok(api, "npc.move", { who: "a6", to_point: [100, 215, 10] });
    expect(await refused(api, "npc.act", { who: "a6", gesture: "talk" })).toBe("npc_moving");
    await releaseAll(api);
  }, 30_000);

  test("dialogue choices: refused while the game shows its own, too far, one at a time; the pick comes back through session.wait", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 8 });
    await event(api, "npc.spawned", since, "a7");
    const choices = { who: "a7", choices: ["Two blocks down, still open.", "No idea. Ask someone else."], max_s: 30 };
    expect(await refused(api, "npc.choices", choices)).toBe("too_far");
    await ok(api, "npc.move", { who: "a7", to: "v" });
    await event(api, "npc.arrived", since, "a7");
    await bridge(api, "selftest.npc", { hub_busy: true });
    expect(await refused(api, "npc.choices", choices)).toBe("choices_busy");
    await bridge(api, "selftest.npc", { hub_busy: false });
    const shown = await ok(api, "npc.choices", { ...choices, title: "Stranger" });
    expect(shown.hub).toBeGreaterThan(58460000);
    expect(shown.undo).toEqual({ method: "npc.choices", params: { withdraw: shown.hub } });
    expect(await refused(api, "npc.choices", choices)).toBe("one_hub_at_a_time");
    const street = await bridge(api, "selftest.npc", {});
    expect(street.hub).toMatchObject({ shown: true, title: "Stranger", choices: choices.choices });
    const waiting = api.run("session.wait", { kinds: ["npc.choice"], timeout_s: 10 });
    await sleep(600);
    await bridge(api, "selftest.npc", { answer: 1 });
    const waited = (await waiting) as Any;
    expect(waited.ok).toBe(true);
    const picked = waited.result.events.find((e: Any) => e.kind === "npc.choice");
    expect(picked.data).toMatchObject({ who: "a7", hub: shown.hub, index: 1, label: "No idea. Ask someone else." });
    expect((await ok(api, "npc.status")).hub).toBeNull();
    // Withdrawn by its undo, and timed out by max_s.
    const again = await ok(api, "npc.choices", choices);
    expect((await ok(api, "npc.choices", { withdraw: again.hub })).withdrawn).toBe(true);
    const since2 = await latest(api);
    await ok(api, "npc.choices", { ...choices, max_s: 5 });
    const timeout = await event(api, "npc.choice", since2, "a7", 9000);
    expect(timeout.data.timeout).toBe(true);
    await releaseAll(api);
  }, 30_000);

  test("release walk_away: the actor walks 15 m from V, then npc.released", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a8");
    await ok(api, "npc.look", { who: "a8", at: "v" });
    const out = await ok(api, "npc.release", { who: "a8", how: "walk_away" });
    expect(out.to[1]).toBeGreaterThan(215);
    expect((await ok(api, "npc.status")).npcs[0]).toMatchObject({ releasing: "walk_away", look: null });
    const released = await event(api, "npc.released", since, "a8", 12000);
    expect(released.data.how).toBe("walk_away");
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 30_000);

  test("saves wait for the actors: game.save refused bridge_effects_active even with override_lock, then saves once released", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a9");
    const save = await api.run("game.save", { override_lock: true });
    expect(save.ok ? "" : `${save.error.code} ${save.error.message} ${(save.error as Any).detail ?? ""}`).toContain("bridge_effects_active");
    await releaseAll(api);
    expect((await ok(api, "game.save", { override_lock: true })).saved).toBe(true);
  }, 30_000);

  test("automatic release: combat, a handover; the npc class gate", async () => {
    let since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a10");
    await bridge(api, "selftest.player", { busy: "in_combat" });
    const combat = await event(api, "npc.auto_released", since, "a10");
    expect(combat.data.reason).toBe("combat");
    await bridge(api, "selftest.player", { busy: "" });
    since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a11");
    await ok(api, "session.handover", { note: "the player takes over" });
    const handover = await event(api, "npc.auto_released", since, "a11");
    expect(handover.data.reason).toBe("handover");
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 })).toBe("handed_over");
    await ok(api, "session.resume", {});
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 30_000);

  test("the first scenario end to end: the stranger walks up, asks, the player picks, she reacts and walks away", async () => {
    await releaseAll(api);
    const run = api.run("npc.scenario", { name: "stranger_question" });
    // The player's pick: answer as soon as the choices show.
    let answered = false;
    for (let i = 0; i < 300 && !answered; i++) {
      await sleep(100);
      const street = await api.callBridge("selftest.npc", {}, "t-street");
      if (street.ok && (street.result as Any).hub.shown) {
        await bridge(api, "selftest.npc", { answer: 0 });
        answered = true;
      }
    }
    expect(answered).toBe(true);
    const out = (await run) as Any;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const report = out.result;
    expect(report, JSON.stringify(report)).toMatchObject({ ok: true, outcome: "done", answers: { answer: "0" }, actors: { stranger: expect.stringMatching(/^a\d+$/) } });
    expect(report.released).toEqual(["stranger"]);
    const kinds = report.events.map((e: Any) => e.kind);
    for (const kind of ["npc.spawned", "npc.arrived", "npc.said", "npc.choice", "npc.released"]) expect(kinds).toContain(kind);
    expect(report.steps.find((s: Any) => s.on === "answer").branch).toBe("0");
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 60_000);

  test("a failing scenario still releases what it brought in", async () => {
    const scenario: Scenario = {
      scenario: "xfs_test_fail",
      actors: { walker: { cast: "man_corpo" } },
      steps: [
        { do: "npc.spawn", who: "walker", ahead_m: 4 },
        { wait: "npc.spawned", who: "walker", max_s: 5 },
        { do: "npc.act", who: "walker", gesture: "wave", optional: true },
        { wait: "npc.arrived", who: "walker", max_s: 0.5 },
      ],
    };
    const report = await runScenario(scenario, { api, cid: "t-fail", captureRoot: "" });
    expect(report).toMatchObject({ ok: false, outcome: "failed", released: ["walker"] });
    expect(report.why).toContain("no npc.arrived");
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 30_000);

  test("a load drops everything without a game call (Codeware drops non-persistent entities with the world)", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a14");
    await ok(api, "game.load", { latest: true, discard_unsaved: true });
    const dropped = await event(api, "npc.auto_released", since, "a14", 10000);
    expect(dropped.data.reason).toBe("load");
    for (let i = 0; i < 100; i++) {
      const status = await api.run("game.status", {});
      if (status.ok && (status.result as Any).phase === "gameplay") break;
      await sleep(100);
    }
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
    const street = await bridge(api, "selftest.npc", {});
    expect(street.actors).toEqual([]);
  }, 30_000);

  test("the kill switch releases every NPC in one step (last: it ends the host's bridge)", async () => {
    const since = await latest(api);
    await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, "a15");
    await ok(api, "bridge.kill", {});
    for (let i = 0; i < 80 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await sleep(50);
    const line = host.log.find((l) => l.includes("bridge.kill_restored")) ?? "";
    expect(line).toContain("npcs_released");
    expect(line).toContain("a15");
  }, 30_000);
});

describe("0.8 npc: the live DM's additions (turn away and hold, a voice with no body, npc.blocked, masked casts)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 180);
    api = apiFor(host);
    await bridge(api, "selftest.npc", { speed: 8 });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await host?.stop();
  });

  test("a masked cast spawns in its mask by default; variant picks another; npc.status lists the casts", async () => {
    const since = await latest(api);
    const a = await ok(api, "npc.spawn", { cast: "man_masked", ahead_m: 4 });
    expect(a.appearance).toBe("king_of_the_stoop_ma_king_of_the_stoop_ma_012");
    await event(api, "npc.spawned", since, a.who);
    const status = await ok(api, "npc.status");
    const casts = Object.fromEntries((status.casts as Any[]).map((c) => [c.cast, c]));
    expect(casts.woman_masked).toMatchObject({ masked: true, appearances: ["citizen__creole_wa_caribbean_29"] });
    expect(casts.woman_corpo.masked).toBe(false);
    const b = await ok(api, "npc.spawn", { cast: "man_masked", ahead_m: 5, variant: 2 });
    expect(b.appearance).toBe("king_of_the_stoop_ma_king_of_the_stoop_ma_014");
    await ok(api, "npc.release", { who: "all" });
  }, 30_000);

  test("turn away and hold: it faces away, turns away again when V walks round it, and after a walk; off ends it", async () => {
    let since = await latest(api);
    const a = await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 4 });
    await event(api, "npc.spawned", since, a.who);
    const away = await ok(api, "npc.turn", { who: a.who, away_from: "v", hold: true });
    expect(away.hold).toBe(true);
    const first = await event(api, "npc.turned", since, a.who);
    expect(first.data).toMatchObject({ away: true, hold: true, reached: true });
    // V walks round to the far side of the actor (V at 100,200; the actor at 100,204).
    since = await latest(api);
    await bridge(api, "selftest.player", { position: [100, 210, 10] });
    const again = await event(api, "npc.turned", since, a.who);
    expect(again.data).toMatchObject({ away: true, again: true });
    const street = await bridge(api, "selftest.npc", {});
    const yaw = street.actors.find((x: Any) => x.who === a.who).yaw;
    expect(Math.abs(Math.abs(yaw) - 180)).toBeLessThan(1); // facing -Y, away from V at +Y
    expect((await ok(api, "npc.status")).npcs[0].facing).toEqual({ away_from: "v", hold: true });
    const off = await ok(api, "npc.turn", { who: a.who, off: true });
    expect(off.was_holding).toBe(true);
    await bridge(api, "selftest.player", { position: [100, 200, 10] });
    await ok(api, "npc.release", { who: "all" });
  }, 30_000);

  test("npc.blocked when a walk makes no headway, then npc.move_failed at max_s", async () => {
    const since = await latest(api);
    const a = await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 10 });
    await event(api, "npc.spawned", since, a.who);
    await bridge(api, "selftest.npc", { stuck: a.who });
    await ok(api, "npc.move", { who: a.who, to: "v", max_s: 7 });
    const blocked = await event(api, "npc.blocked", since, a.who, 9000);
    expect(blocked.data).toMatchObject({ reason: "stuck", walking: "move" });
    const failed = await event(api, "npc.move_failed", since, a.who, 9000);
    expect(failed.data.state).toBe("timeout");
    await ok(api, "npc.release", { who: "all" });
  }, 30_000);

  test("a voice with no body: ownerless by default, holocall and subtitle carried by V; npc.said names the speaker; hide", async () => {
    const since = await latest(api);
    expect(await refused(api, "npc.say", { text: "No name." })).toBe("bad_params");
    expect(await refused(api, "npc.say", { speaker: "A voice", text: "Up here.", style: "overhead" })).toBe("bad_params");
    const ownerless = await ok(api, "npc.say", { speaker: "A voice", text: "Can you hear me?", seconds: 1 });
    expect(ownerless).toMatchObject({ voice: true, style: "ownerless", speaker: "A voice", who: null });
    expect(ownerless.undo).toEqual({ method: "npc.say", params: { hide: ownerless.line } });
    const holocall = await ok(api, "npc.say", { speaker: "A voice", text: "Over the relay.", style: "holocall", seconds: 10 });
    let street = await bridge(api, "selftest.npc", {});
    expect(street.voice_lines[holocall.line]).toBe("A voice|holocall");
    const said = await event(api, "npc.said", since);
    expect(said.data).toMatchObject({ voice: true, speaker: "A voice", line: ownerless.line });
    await ok(api, "npc.say", { hide: holocall.line });
    street = await bridge(api, "selftest.npc", {});
    expect(street.voice_lines).toEqual({});
    expect((await ok(api, "npc.status")).voice_lines).toEqual([]);
  }, 30_000);
});

describe("0.8 npc: the class gate", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom,player"], 120);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await host?.stop();
  }, 30_000);

  test("without npc in allow_write_classes every npc write is refused and reads still work", async () => {
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 })).toBe("write_class_disabled");
    expect(await refused(api, "npc.release", { who: "all" })).toBe("write_class_disabled");
    expect((await ok(api, "npc.list", {})).npcs.length).toBeGreaterThan(0);
    expect(findCommand("npc_spawn")!.name).toBe("npc.spawn");
  }, 30_000);
});

describe("0.8.6+npc: the Story Engine's staging (V15 stand-ins, V16 out of sight) and the 0.8.6 rules", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 180);
    api = apiFor(host);
    await bridge(api, "selftest.npc", { speed: 8 });
    await bridge(api, "selftest.player", { busy: "", position: [100, 200, 10], yaw: 0 });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await host?.stop();
  });

  test("V15: a hostile, mortal stand-in is handed back in a fight (the friendly actor is removed), and its body stays when it dies", async () => {
    let since = await latest(api);
    const standIn = await ok(api, "npc.spawn", { cast: "man_lowlife", ahead_m: 4, attitude: "hostile", immortal: false, reactions: "game" });
    expect(standIn).toMatchObject({ attitude: "hostile", immortal: false, reactions: "game", record: "Character.xfs_actor_man_lowlife_reactive" });
    expect(standIn.stand_in_note).toContain("handed_back");
    const friendly = await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    expect(friendly).toMatchObject({ attitude: "friendly", immortal: true, reactions: "quiet" });
    await event(api, "npc.spawned", since, standIn.who);
    await event(api, "npc.spawned", since, friendly.who);
    const street = await bridge(api, "selftest.npc", {});
    expect((street.actors as Any[]).find((a) => a.who === standIn.who)).toMatchObject({ attitude: 2, immortal: false });
    await ok(api, "npc.look", { who: standIn.who, at: "v" });
    await bridge(api, "selftest.player", { busy: "in_combat" });
    const back = await event(api, "npc.handed_back", since, standIn.who);
    expect(back.data).toMatchObject({ reason: "combat", attitude: "hostile", immortal: false });
    expect((await event(api, "npc.auto_released", since, friendly.who)).data.reason).toBe("combat");
    const status = await ok(api, "npc.status");
    expect(status.npcs).toHaveLength(1);
    expect(status.npcs[0]).toMatchObject({ who: standIn.who, handed_back: true, look: null });
    await bridge(api, "selftest.player", { busy: "" });
    expect(await refused(api, "npc.move", { who: standIn.who, to: "v" })).toBe("npc_handed_back");
    since = await latest(api);
    await bridge(api, "selftest.npc", { kill: standIn.who });
    expect((await event(api, "npc.died", since, standIn.who)).data.kept_body).toBe(true);
    expect((await ok(api, "npc.status")).npcs[0]).toMatchObject({ who: standIn.who, dead: true });
    const plain = await api.run("npc.say", { who: standIn.who, text: "Hello." });
    expect(plain.ok ? "" : plain.error.code).toBe("npc_dead");
    expect(plain.ok ? "" : plain.error.message).toContain("body stays");
    await ok(api, "npc.release", { who: standIn.who });
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 30_000);

  test("V16: an out-of-sight spawn lands behind V on walkable ground; with none in range it is refused in plain words", async () => {
    const since = await latest(api);
    const hidden = await ok(api, "npc.spawn", { cast: "woman_corpo", out_of_sight: true, min_m: 12, max_m: 20 });
    expect(hidden.asked_at[1]).toBeLessThan(200 - 11.5); // V at (100, 200) faces +Y: behind her is -Y
    expect(hidden.out_of_sight.probes).toBeGreaterThanOrEqual(1);
    expect(hidden.out_of_sight.distance_v).toBeGreaterThanOrEqual(11.5);
    await event(api, "npc.spawned", since, hidden.who);
    await ok(api, "npc.release", { who: hidden.who });
    await bridge(api, "selftest.npc", { no_ground_far: true });
    const none = await api.run("npc.spawn", { cast: "woman_corpo", out_of_sight: true });
    expect(none.ok ? "" : none.error.code).toBe("no_hidden_spot");
    expect(none.ok ? "" : none.error.message).toContain("out of V's sight");
    await bridge(api, "selftest.npc", { no_ground_far: false });
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3, min_m: 5 })).toBe("bad_params");
  }, 30_000);

  test("V16: dissolve walks the actor off and removes it only once V can't see it", async () => {
    const since = await latest(api);
    const a = await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, a.who);
    await ok(api, "npc.face", { who: a.who, expression: "joy" });
    const out = await ok(api, "npc.release", { who: a.who, how: "dissolve" });
    expect(out).toMatchObject({ how: "dissolve", walk: true, distance_m: 15 });
    expect(out.to[1]).toBeGreaterThan(215);
    expect((await ok(api, "npc.status")).npcs[0]).toMatchObject({ releasing: "dissolve", face: null });
    await sleep(1500); // it walks off along V's view (+Y) and stays in sight
    expect((await ok(api, "npc.status")).npcs).toHaveLength(1);
    await bridge(api, "selftest.npc", { sight_blocked: true }); // a wall between V and everything
    const dissolved = await event(api, "npc.dissolved", since, a.who, 12000);
    expect(dissolved.data.waited_s).toBeGreaterThan(0);
    expect((await event(api, "npc.released", since, a.who)).data.how).toBe("dissolve");
    await bridge(api, "selftest.npc", { sight_blocked: false });
    expect((await ok(api, "npc.status")).npcs).toEqual([]);
  }, 30_000);

  test("0.8.6: the handover releases every NPC in its own request and says so", async () => {
    const since = await latest(api);
    const a = await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await event(api, "npc.spawned", since, a.who);
    await ok(api, "npc.say", { speaker: "A voice", text: "Over here.", seconds: 10 });
    const handed = await ok(api, "session.handover", { note: "the player takes over" });
    const step = (handed.steps as Any[]).find((s) => s.step === "release the NPCs the bridge directs");
    expect(step).toMatchObject({ ok: true, released: [a.who] });
    // Released in the request itself: the event is there at once, without waiting for a tick.
    const read = await bridge(api, "session.events", { since, limit: 100, kinds: ["npc.auto_released"] });
    expect((read.events as Any[]).some((e) => e.data?.who === a.who && e.data?.reason === "handover")).toBe(true);
    expect((await ok(api, "npc.status")).voice_lines).toEqual([]);
    await ok(api, "session.resume", {});
  }, 30_000);
});
