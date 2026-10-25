// Bridge 0.8.19: crowd substitution (Story Engine V17, route (a); research/story-engine/probes/v17-crowd-substitution.md) and the
// supervisor's NPC actors, offline: the catalogue entries and their refusals, the plugin's tables, and npc.substitute against the
// self-test host's street (selftest/SimNpc.cpp, the plugin's own core/Npc.cpp and core/NpcSubstitute.cpp): the look read, the
// cast match and its report, the order of the swap (held, requested, removed only once the actor stands there), waiting for a
// moment V cannot see, every way a swap is undone, restore, the five-actor bound, and the supervisor's schema, lease and
// simulated state for several actors. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { CATALOGUE, findCommand } from "../api/catalogue.ts";
import { NPC_REFUSALS, NPC_SUBSTITUTE_KINDS, NPC_WAIT_KINDS } from "../api/catalogue080npc.ts";
import { NPC_MESSAGES } from "../api/errors080npc.ts";
import { validate } from "../api/schema.ts";
import { WAIT_KINDS } from "../api/catalogue070.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const ALL = "photo,world,character,save,showroom,player,npc";
const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-sub-cap-"), "captures"), auditDir: tempDir("xfb-sub-audit-"), idleCloseMs: 300 });

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
async function reset(api: CommandApi) {
  await api.run("npc.release", { who: "all" });
  await bridge(api, "selftest.npc", { codeware: true, records_missing: false, speed: 8, reset_street: true, looking_at: "", appearance_override: "", variant_override: "", remove_refuses: false, spawn_never: false });
  await bridge(api, "selftest.player", { busy: "", position: [100, 200, 10], yaw: 0 });
  for (const [id, position, yaw] of [["EntityID(9005)", [100, 192, 10], 0], ["EntityID(9006)", [98, 207, 10], 90]] as const) await bridge(api, "selftest.npc", { street: { id, position, yaw } });
}
const ids = { behind: "EntityID(9005)", community: "EntityID(9006)", vendor: "EntityID(9002)", workspot: "EntityID(9004)" };
async function street(api: CommandApi, id: string): Promise<Any> {
  return (await bridge(api, "selftest.npc", {})).street.find((n: Any) => n.id === id);
}

describe("0.8.19 crowd substitution offline: the catalogue and the tables", () => {
  test("npc.substitute is a write-npc command with refusals, plain words and its events", () => {
    const command = findCommand("npc.substitute")!;
    expect(command.permission).toBe("write-npc");
    expect(command.bridge?.method).toBe("npc.substitute");
    expect((command as Any).refusals).toEqual([...NPC_REFUSALS["npc.substitute"]!]);
    for (const code of NPC_REFUSALS["npc.substitute"]!) expect(NPC_MESSAGES[code], code).toBeDefined();
    for (const kind of NPC_SUBSTITUTE_KINDS) expect(WAIT_KINDS).toContain(kind);
    expect(NPC_SUBSTITUTE_KINDS).toEqual(["npc.substitute_started", "npc.substituted", "npc.substitute_failed", "npc.restored"]);
    // The scenario runner reads NPC_WAIT_KINDS in one session.events call, which the bridge limits to 16 kinds.
    expect(NPC_WAIT_KINDS.length).toBeLessThanOrEqual(16);
    expect(CATALOGUE.filter((c) => c.name.startsWith("npc.")).map((c) => c.name)).toContain("npc.substitute");
    expect(validate(command.input, { id: "EntityID(1)", restore: true, in_view: true, max_wait_s: 10, reactions: "game", cast: "woman_corpo" })).toEqual([]);
    expect(validate(command.input, { look_at: true, dry_run: true })).toEqual([]);
    expect(validate(command.input, { cast: "fighter_melee" })).not.toEqual([]); // a civilian can't be stood in for by a fighter
    expect(validate(command.input, { max_wait_s: 500 })).not.toEqual([]);
    expect(validate(command.input, { who: "a1" })).not.toEqual([]); // a pick's handle, never an actor's
    expect(validate(findCommand("npc.release")!.input, { who: "a1", restore: true })).toEqual([]);
  });

  test("the plugin registers it as an npc write and the source has the refusals the tools name", () => {
    const npc = readFileSync(join(projectDir, "native", "src", "core", "Npc.cpp"), "utf8");
    const substitute = readFileSync(join(projectDir, "native", "src", "core", "NpcSubstitute.cpp"), "utf8");
    expect(npc).toContain('{"npc.substitute", Access::WriteNpc,');
    for (const code of ["look_unmatched", "already_substituting", "cast_unknown", "npc_not_found"]) expect(substitute).toContain(`"${code}"`);
    expect(npc).toContain("kMaxActors");
    expect(readFileSync(join(projectDir, "native", "src", "core", "Npc.hpp"), "utf8")).toContain("kMaxActors = 5;");
  });

  test("the script side: the levers are the game's own, never the aggressive-crowd entry, density or settings", () => {
    const reds = readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeNpc.reds"), "utf8");
    for (const call of ["TryStopTrafficMovement", "AllowWorkspotsUsage", "HideIrreversibly", "MarkDespawnCandidate", "UnmarkDespawnCandidate", "AIJoinCrowdCommand", "GetFixedEntityIdsFromSpawnerEntityID", "gameEntityStubComponentPS"])
      expect(reds, call).toContain(call);
    // The research's two cautions: combat is the aggressive-crowd entry's meaning, and the player's settings and density are not ours.
    for (const forbidden of ["TryRegisteringAggressiveNPC", "TriggerReactionBehaviorForCrowd", "ChangeDensityModifier", "ResetDensityModifier", "EnableDynamicCrowdNullArea", "CrowdDensity", "SetSetting"])
      expect(reds, forbidden).not.toContain(forbidden);
  });
});

describe("0.8.19 supervisor actors offline: schema, permissions and the lease", () => {
  const entry = (ref: string) => ({
    schema: "xfb/supervisor-entry-1",
    actor: { kind: "npc", ref },
    goal: { kind: "hold_position", at: [100, 210, 10], radius_m: 1 },
    invariants: ["alive", "not_in_combat", "not_lost"],
    policy: { goal: "return_last_safe", alive: "release", not_in_combat: "pause_world", not_lost: "release" },
  });

  test("the schema takes an XF actor's invariants and policies, and the state and clear commands take an actor", () => {
    const set = findCommand("supervisor.set")!;
    expect(validate(set.input, entry("a1"))).toEqual([]);
    expect(validate(set.input, { ...entry("a1"), policy: { ...entry("a1").policy, alive: "eval" } })).not.toEqual([]);
    expect(validate(set.input, { ...entry("a1"), invariants: ["alive", "teleport"] })).not.toEqual([]);
    expect(validate(findCommand("supervisor.state")!.input, { actor: { kind: "npc", ref: "a1" } })).toEqual([]);
    expect(validate(findCommand("supervisor.state")!.input, {})).toEqual([]);
    expect(validate(findCommand("supervisor.clear")!.input, { actor: { kind: "player", ref: "V" } })).toEqual([]);
    expect(validate(findCommand("supervisor.clear")!.input, { actor: { kind: "npc" } })).not.toEqual([]);
    // Arming an actor's entry needs the npc class beside the command's own, and release the npc class too.
    const needed = (set as Any).requiredPermissions(entry("a1"));
    expect(needed).toContain("write-npc");
    expect(needed).toContain("write-world");
    expect((set as Any).requiredPermissions({ ...entry("a1"), policy: { alive: "release" } })).toContain("write-npc");
  });

  test("the plugin's supervisor keeps actor entries on the NPC class and its adapter reads the actor afresh", () => {
    const cpp = readFileSync(join(projectDir, "native", "src", "plugin", "Supervisor.cpp"), "utf8");
    expect(cpp).toContain("ClassOf(");
    expect(cpp).toContain('"ReadActor"');
    expect(cpp).toContain('"npc.release"');
    expect(cpp).toContain('"npc.place"');
    expect(cpp).toContain("StateAll()");
    const reds = readFileSync(join(projectDir, "redscript-probes", "autonomous", "XFRuntimeBridgeSupervisor.reds"), "utf8");
    expect(reds).toContain("class XFSupervisorActors");
    expect(reds).toContain("IsSpawned(entry.id)"); // streamed in
    expect(reds).not.toMatch(/Listen\(|DrainEvents\(/);
  });

  test("clearing one actor keeps the connection's lease for the rest; clearing the last releases it", async () => {
    const dir = tempDir("xfb-sup-actors-");
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "test", pid: process.pid, pipe: "fixture", control_pipe: "control", token: "t", started_at: new Date().toISOString(), plugin_version: "test", allow_writes: true }));
    let closes = 0, remaining = 2;
    const answer = (result: unknown) => ({ v: 1 as const, id: 1, cid: "t", ok: true as const, result });
    const api = new CommandApi({ runtimeDir: dir, auditDir: dir, idleCloseMs: 10,
      transport: async () => ({ call: async (method, params) => answer(method === "supervisor.clear" ? { active: --remaining > 0, cleared: (params as Any).actor ? "one" : "all" } : { active: true }), close: () => { closes++; } }),
      controlTransport: async () => ({ call: async (method, params) => answer(method === "supervisor.clear" ? { active: --remaining > 0, cleared: (params as Any).actor ? "one" : "all" } : { active: remaining > 0 }), close: () => {} }) });
    try {
      expect((await api.run("supervisor.set", entry("a1"))).ok).toBe(true);
      api.release(); await sleep(40);
      expect(closes).toBe(0); // armed: the connection stays
      expect((await api.run("supervisor.clear", { actor: { kind: "npc", ref: "a1" } })).ok).toBe(true);
      await sleep(40);
      expect(closes).toBe(0); // one entry is left
      expect((await api.run("supervisor.clear", { actor: { kind: "npc", ref: "a2" } })).ok).toBe(true);
      await sleep(60);
      expect(closes).toBe(1); // none left
    } finally { api.close(); }
  });
});

describe("0.8.19 npc.substitute against the self-test host's street", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = apiFor(host);
    await bridge(api, "selftest.npc", { speed: 8 });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => { await host?.stop(); }, 30_000);

  test("probe 1: npc.list gives each person's record, appearance, place, heading and crowd flag", async () => {
    await reset(api);
    const list = await ok(api, "npc.list", { radius_m: 20 });
    const byId = Object.fromEntries((list.npcs as Any[]).map((n) => [n.id, n]));
    expect(byId[ids.behind]).toMatchObject({ record: "Character.Citizen_Street_Man_07", appearance: "street_ma_07_a", yaw: 0, crowd: true, position: [100, 192, 10] });
    expect(byId[ids.community]).toMatchObject({ appearance: "citizen__corporat_wa_01", variant: "red", yaw: 90 });
  });

  test("dry run: the look, the match, the key and the respawn parameters; nothing held or spent", async () => {
    await reset(api);
    const dry = await ok(api, "npc.substitute", { id: ids.community, dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, cast: "woman_corpo", undo: null });
    expect(dry.who).toBeUndefined();
    expect(dry.look_match).toMatchObject({ confirmed: false, level: null, expected_level: "exact", cast: "woman_corpo" });
    expect(dry.look_match.record.match).toBe("clone_of_same_record");
    expect(dry.look_match.not_matched.length).toBeGreaterThanOrEqual(3);
    expect(dry.resident).toMatchObject({ kind: "community", key: "xfc1-EntityID_777_-bench_sitter-2", ours: true }); // the game's own pair, with the person's index
    expect(dry.resident.hash).toMatch(/^xfr1-[0-9a-f]{16}$/);
    const plain = await ok(api, "npc.substitute", { id: ids.behind, dry_run: true });
    expect(plain.resident.kind).toBe("crowd"); // a pure lane-crowd person has no key of the game's own: the hash
    expect(plain.resident.key).toBe(plain.resident.hash);
    expect(dry.respawn).toMatchObject({ method: "npc.spawn", params: { cast: "woman_corpo", appearance: "citizen__corporat_wa_01", reactions: "quiet" } });
    expect(dry.respawn.params.at).toEqual([98, 207, 10]);
    const after = await bridge(api, "selftest.npc", {});
    expect(after.detaches).toBe(0);
    expect((await ok(api, "npc.status")).actors).toBe(0);
  });

  test("probe 3: a person behind V is swapped at once: held, the actor requested, the original removed only when the actor stands there", async () => {
    await reset(api);
    const since = await latest(api);
    await bridge(api, "selftest.npc", { speed: 8 });
    const swap = await ok(api, "npc.substitute", { id: ids.behind });
    expect(swap).toMatchObject({ who: "a1", state: "spawning", cast: "man_lowlife" });
    expect(swap.swap).toMatchObject({ mode: "now", original_out_of_sight: true });
    expect(swap.look_match).toMatchObject({ confirmed: false, expected_level: "approximate" });
    expect(swap.look_match.record.match).toBe("gender_only");
    expect(swap.resident.key).toMatch(/^xfr1-[0-9a-f]{16}$/);
    expect(swap.resident.ours).toBe(true);
    expect(swap.undo).toEqual({ method: "npc.release", params: { who: "a1", how: "despawn" } });
    expect(swap.respawn.params).toMatchObject({ cast: "man_lowlife", appearance: "street_ma_07_a" });
    const done = await event(api, "npc.substituted", since, "a1");
    expect(done.data.look_match).toMatchObject({ confirmed: true, level: "approximate" });
    expect(done.data.look_match.appearance.match).toBe("exact");
    expect(done.data.in_view_at_swap).toBe(false);
    expect(done.data.resident.key).toBe(swap.resident.key);
    const after = await bridge(api, "selftest.npc", {});
    expect(after.removals).toBe(1);
    expect((await street(api, ids.behind)).removed).toBe(true);
    expect((await ok(api, "npc.list", { radius_m: 20 })).npcs.some((n: Any) => n.id === ids.behind)).toBe(false); // the original is gone from the street
    // It is an ordinary XF actor now.
    const moved = await ok(api, "npc.move", { who: "a1", to_point: [100, 205, 10] });
    expect(moved.undo.method).toBe("npc.stop");
    const status = await ok(api, "npc.status");
    expect(status.swaps).toEqual([]);
    expect(status.npcs[0]).toMatchObject({ who: "a1", substitute_of: ids.behind, resident: { key: swap.resident.key } });
  }, 30_000);

  test("probe 2/3 for a community person: the game's own pair, the exact record, the colour variant reported", async () => {
    await reset(api);
    const since = await latest(api);
    await bridge(api, "selftest.player", { yaw: 180 }); // she turns away: the person at (98, 207) is behind her now
    const swap = await ok(api, "npc.substitute", { id: ids.community });
    expect(swap).toMatchObject({ state: "spawning", cast: "woman_corpo" });
    expect(swap.resident).toMatchObject({ kind: "community", key: "xfc1-EntityID_777_-bench_sitter-2" });
    expect(swap.resident.hash).toMatch(/^xfr1-/);
    const done = await event(api, "npc.substituted", since, swap.who);
    expect(done.data.look_match.record.match).toBe("clone_of_same_record");
    expect(done.data.look_match.colour_variant).toMatchObject({ original: "red", actual: "", match: "different" });
    expect(done.data.look_match.level).toBe("close"); // exact record and appearance, but the colour variant can't be chosen
  }, 30_000);

  test("probe 4: a person in view is waited for, untouched; in_view true swaps at once and says V could see it", async () => {
    await reset(api);
    const since = await latest(api);
    const waiting = await ok(api, "npc.substitute", { id: ids.community });
    expect(waiting).toMatchObject({ state: "waiting", resident: null });
    expect(waiting.swap.mode).toBe("waiting");
    expect((await ok(api, "npc.status")).swaps[0]).toMatchObject({ who: waiting.who, state: "waiting", original: ids.community });
    expect(await refused(api, "npc.move", { who: waiting.who, to: "v" })).toBe("npc_not_spawned");
    expect((await bridge(api, "selftest.npc", {})).detaches).toBe(0);
    await bridge(api, "selftest.player", { yaw: 180 }); // she turns away: now it is out of her sight
    const done = await event(api, "npc.substituted", since, waiting.who);
    expect(done.data.in_view_at_swap).toBe(false);
    expect(done.data.waited_s).toBeGreaterThan(0);
    expect(done.data.resident.key).toBe("xfc1-EntityID_777_-bench_sitter-2");
    // In view, forced.
    await reset(api);
    const seen = await latest(api);
    const forced = await ok(api, "npc.substitute", { id: ids.community, in_view: true });
    expect(forced).toMatchObject({ state: "spawning" });
    expect(forced.swap).toMatchObject({ mode: "now", original_out_of_sight: false, in_view_allowed: true });
    const again = await event(api, "npc.substituted", seen, forced.who);
    expect(again.data.in_view_at_swap).toBe(true);
  }, 30_000);

  test("an original that stays in view is given up on after max_wait_s, and releasing a waiting swap cancels it", async () => {
    await reset(api);
    const since = await latest(api);
    const brief = await ok(api, "npc.substitute", { id: ids.community, max_wait_s: 1 });
    const failed = await event(api, "npc.substitute_failed", since, brief.who);
    expect(failed.data.reason).toBe("never_hidden");
    expect((await bridge(api, "selftest.npc", {})).detaches).toBe(0);
    expect((await ok(api, "npc.status")).swaps).toEqual([]);
    const mark = await latest(api);
    const second = await ok(api, "npc.substitute", { id: ids.community });
    const cancelled = await ok(api, "npc.release", { who: second.who });
    expect(cancelled.how).toBe("cancelled");
    expect((await event(api, "npc.substitute_failed", mark, second.who)).data.reason).toBe("cancelled");
  }, 30_000);

  test("undoing: an actor that never appears, or a removal the game refuses, gives the original back", async () => {
    await reset(api);
    await bridge(api, "selftest.npc", { remove_refuses: true });
    let since = await latest(api);
    const attempt = await ok(api, "npc.substitute", { id: ids.behind });
    const refusedRemoval = await event(api, "npc.substitute_failed", since, attempt.who);
    expect(refusedRemoval.data).toMatchObject({ reason: "remove_refused", original_returned: true });
    let report = await bridge(api, "selftest.npc", {});
    expect((await street(api, ids.behind))).toMatchObject({ removed: false, detached: false });
    expect(report.reattaches).toBeGreaterThanOrEqual(1);
    expect((await ok(api, "npc.status")).actors).toBe(0);
    await reset(api);
    await bridge(api, "selftest.npc", { spawn_never: true });
    since = await latest(api);
    const hopeless = await ok(api, "npc.substitute", { id: ids.behind });
    const never = await event(api, "npc.substitute_failed", since, hopeless.who, 20_000);
    expect(never.data).toMatchObject({ reason: "not_spawned", original_returned: true });
    expect((await street(api, ids.behind)).detached).toBe(false);
  }, 60_000);

  test("refusals: protected and busy people, nobody, nothing looked at, V in a fight, two sources", async () => {
    await reset(api);
    expect(await refused(api, "npc.substitute", { id: ids.vendor })).toBe("npc_protected");
    expect(await refused(api, "npc.substitute", { id: ids.workspot })).toBe("npc_busy");
    expect(await refused(api, "npc.substitute", { id: "EntityID(1)" })).toBe("npc_not_found");
    expect(await refused(api, "npc.substitute", { look_at: true })).toBe("npc_not_found");
    expect(await refused(api, "npc.substitute", {})).toBe("bad_params");
    await bridge(api, "selftest.player", { busy: "in_combat" });
    expect(await refused(api, "npc.substitute", { id: ids.behind })).toBe("in_combat");
    await bridge(api, "selftest.player", { busy: "" });
    expect(await refused(api, "npc.substitute", { id: ids.behind, cast: "fighter_pistol" })).toBe("bad_input");
    const bridgeLevel = await api.callBridge("npc.substitute", { id: ids.behind, cast: "fighter_pistol" }, "t-refuse");
    expect(bridgeLevel.ok).toBe(false);
    expect((bridgeLevel as Any).error.code).toBe("cast_unknown");
    const unmatched = await api.callBridge("npc.substitute", { id: ids.behind, dry_run: true }, "t-dry");
    expect(unmatched.ok).toBe(true);
    // Everything the street held stays as it was.
    expect((await bridge(api, "selftest.npc", {})).detaches).toBe(0);
    expect((await street(api, ids.behind)).removed).toBe(false);
    // A person looked at.
    await bridge(api, "selftest.npc", { looking_at: ids.behind });
    const looked = await ok(api, "npc.substitute", { look_at: true, dry_run: true });
    expect(looked.original.entity).toBe(ids.behind);
    // A pick can be the source.
    const pick = await ok(api, "npc.pick", { id: ids.behind });
    const fromPick = await ok(api, "npc.substitute", { who: pick.who, dry_run: true });
    expect(fromPick.original.entity).toBe(ids.behind);
    // Two actors are never the same person twice.
    await reset(api);
    const first = await ok(api, "npc.substitute", { id: ids.behind });
    expect(await refused(api, "npc.substitute", { id: ids.behind })).toBe("already_substituting");
    await ok(api, "npc.release", { who: first.who });
  }, 30_000);

  test("the five-actor bound counts swaps, and release dissolves a substituted actor with restore leaving a fresh crowd person", async () => {
    await reset(api);
    const first = await ok(api, "npc.substitute", { id: ids.behind, restore: true });
    expect(first.restore).toBe(true);
    await event(api, "npc.substituted", 0, first.who);
    for (let i = 0; i < 4; i++) await ok(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 3 + i });
    expect(await refused(api, "npc.spawn", { cast: "woman_corpo", ahead_m: 8 })).toBe("limit");
    expect(await refused(api, "npc.substitute", { id: ids.community })).toBe("limit");
    const since = await latest(api);
    const released = await ok(api, "npc.release", { who: first.who, how: "despawn" });
    expect(released.how).toBe("despawn");
    const restored = await event(api, "npc.restored", since);
    expect(restored.data.in_crowd).toBe(true); // the simulated crowd takes the join command
    const report = await bridge(api, "selftest.npc", {});
    expect(report.restores).toBe(1);
    expect(report.street.some((n: Any) => n.fresh)).toBe(true);
    await ok(api, "npc.release", { who: "all" });
  }, 30_000);

  test("probe 7/11: the kill switch gives held originals back and leaves no actor (last: it ends the host's bridge)", async () => {
    await reset(api);
    await bridge(api, "selftest.npc", { spawn_never: true });
    await ok(api, "npc.substitute", { id: ids.behind });
    await sleep(500);
    expect((await street(api, ids.behind)).detached).toBe(true);
    await ok(api, "bridge.kill", {});
    for (let i = 0; i < 80 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await sleep(50);
    expect(host.log.some((l) => l.includes("bridge.kill_restored"))).toBe(true);
  }, 30_000);
});
