// Bridge 0.8.21: the engine's declared incidents (incidents.declare / incidents.close, the sight sampler, the spawn link). The core's
// behaviour (joining, sampling bounds, TTL, close, unwitnessed, the link, refusals, kill and load) is the native unit tests
// (UnitTestsIncidents.cpp, UnitTestsNpc.cpp, UnitTestsNpcSubstitute.cpp). These checks keep the tools, the catalogue, the packaging, the
// redscript sampler and the plugin's wiring in step with it, and the catch-up digest.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findCommand } from "../api/catalogue.ts";
import { BRIDGE_MESSAGES } from "../api/errors.ts";
import { validate } from "../api/schema.ts";
import { assertNativeGlobals, packageScripts } from "../redscript-natives.ts";
import { inlineNativeResults } from "../lint-world-objects.ts";
import { witnessedIncidents } from "../testing/timeline.ts";
import { projectDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8").replace(/\r\n/g, "\n");
const taps = read("redscript-probes", "autonomous", "XFRuntimeBridgeIncidents.reds");
const core = read("native", "src", "core", "Incidents.cpp");
const plugin = read("native", "src", "plugin", "HandlersIncidents.cpp");
const natives = read("native", "src", "plugin", "Natives.cpp");

describe("0.8.21 the commands", () => {
  test("incidents.declare is a test-gated read with checked parameters", () => {
    const command = findCommand("incidents.declare")!;
    expect(command.permission).toBe("read");
    expect(command.bridge).toMatchObject({ method: "incidents.declare" });
    for (const code of ["test_hooks_off", "tap_off", "handed_over", "duplicate_id", "incident_limit", "npc_not_found", "no_place"]) expect(command.refusals).toContain(code);
    const ok = { id: "steal-1", kind: "pickpocket", roles: { a1: "thief", a2: "mark" }, at: [1, 2, 3], ttl_s: 30 };
    expect(validate(command.input, ok)).toEqual([]);
    expect(validate(command.input, { id: "x", kind: "stall collection" })).toEqual([]);
    for (const bad of [{ kind: "k" }, { id: "x" }, { id: "has space", kind: "k" }, { id: 'a"b', kind: "k" }, { id: "x".repeat(65), kind: "k" }, { id: "x", kind: "a\nb" }, { id: "x", kind: "<b>" },
      { id: "x", kind: "k", ttl_s: 0.5 }, { id: "x", kind: "k", ttl_s: 301 }, { id: "x", kind: "k", at: [1, 2] }, { id: "x", kind: "k", roles: "a1" }, { id: "x", kind: "k", colour: "red" }])
      expect(validate(command.input, bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    // roles is a typed map: only actor handles as names, only safe role text as values (V and picks never pass the schema)
    for (const bad of [{ v: "thief" }, { p1: "thief" }, { a1: 'th"ief' }, { a1: 5 }, { a1: "" }, { x: "thief" }])
      expect(validate(command.input, { id: "x", kind: "k", roles: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    expect(validate(command.input, { id: "x", kind: "k", roles: { a12: "stall collector" } })).toEqual([]);
    // the description says what the engine needs to know: the report fields, the reasons, the bounds, V and picks refused
    for (const word of ["passive", "witness.report", "declared {id, kind, roles", "witness.unwitnessed", "witness.gap", "no_samples", "occluded", "four declared", "five actors", "picked passers-by", "ttl_s", "incident_role"])
      expect(command.description, word).toContain(word);
  });
  test("incidents.close, and the list filters", () => {
    const close = findCommand("incidents.close")!;
    expect(close.permission).toBe("read");
    expect(close.bridge).toMatchObject({ method: "incidents.close" });
    expect(close.refusals).toContain("incident_unknown");
    expect(validate(close.input, { id: "steal-1" })).toEqual([]);
    expect(validate(close.input, {}).length).toBeGreaterThan(0);
    const list = findCommand("incidents.list")!;
    expect(validate(list.input, { declared: true, id: "steal-1" })).toEqual([]);
    expect(validate(list.input, { declared: "yes" }).length).toBeGreaterThan(0);
  });
  test("npc_spawn and npc_substitute take the incident link", () => {
    const spawn = findCommand("npc.spawn")!, substitute = findCommand("npc.substitute")!;
    expect(validate(spawn.input, { cast: "woman_corpo", ahead_m: 3, incident: "steal-1", incident_role: "lookout" })).toEqual([]);
    expect(validate(substitute.input, { id: "P-1", incident: "steal-1", incident_role: "mark" })).toEqual([]);
    for (const c of [spawn, substitute]) {
      expect(validate(c.input, { ...(c === spawn ? { cast: "woman_corpo" } : { id: "P-1" }), incident: "" }).length).toBeGreaterThan(0);
      for (const code of ["incident_unknown", "incident_limit"]) expect(c.refusals, `${c.name} ${code}`).toContain(code);
    }
    // the bridge's own parameter names are the catalogue's (no translation in between)
    const bridge = (spawn.bridge as { params: (i: Record<string, unknown>) => Record<string, unknown> }).params({ cast: "woman_corpo", ahead_m: 3, incident: "steal-1", incident_role: "lookout" });
    expect(bridge).toMatchObject({ incident: "steal-1", incident_role: "lookout" });
  });
  test("every new refusal has plain words", () => {
    for (const code of ["duplicate_id", "incident_unknown", "incident_limit", "tap_off", "no_place"]) expect(BRIDGE_MESSAGES[code], code).toBeString();
  });
  test("the reasons the core gives are the ones the description lists, and the core's keys are the ones the tools read", () => {
    const description = findCommand("incidents.declare")!.description;
    for (const reason of ["no_samples", "actors_missing", "no_view", "out_of_range", "not_in_view", "occluded", "unchecked"]) {
      expect(core, reason).toContain(`"${reason}"`);
      expect(description, reason).toContain(reason);
    }
    for (const reason of ["engine_close", "ttl", "kill", "load", "handover", "tap_off"]) expect(plugin + core, reason).toContain(`"${reason}"`);
  });
});

describe("0.8.21 the sampler in the autonomous build", () => {
  const autonomous = packageScripts(projectDir, "writes", true);
  test("only the autonomous package carries the sampler and its native", () => {
    for (const variant of ["default", "diagnostic", "writes"]) {
      const text = packageScripts(projectDir, variant, false).map(s => s.text).join("\n");
      expect(text).not.toContain("XFBridge_IncidentSightPlan");
      expect(text).not.toContain("XFIncidentTap");
    }
    const text = autonomous.map(s => s.text).join("\n");
    expect(text).toContain("public static native func XFBridge_IncidentSightPlan() -> String");
    expect(() => assertNativeGlobals(autonomous, natives, true)).not.toThrow();
    const block = natives.slice(natives.indexOf("#ifdef XFB_AUTONOMOUS_TEST_HOOKS\n        RegisterGlobal(rtti, \"XFBridge_TestUiTake\""));
    expect(block.slice(0, block.indexOf("#endif"))).toContain('"XFBridge_IncidentSightPlan"');
  });
  test("the poll is every half second, the clock tick still once a second, and nothing is sampled without a plan", () => {
    const poll = taps.slice(taps.indexOf("public func Poll()"), taps.indexOf("public class XFIncidentPoll"));
    expect(poll.match(/DelayCallback\(this\.m_poll, 0\.5, false\)/g)!.length).toBe(1);
    expect(taps.match(/DelayCallback\(this\.m_poll, 0\.5, false\)/g)!.length).toBe(2); // attach and poll
    expect(poll).toContain("this.m_half >= 2");
    expect(poll.indexOf("this.m_half >= 2")).toBeLessThan(poll.indexOf('\\"tick\\":true'));
    const plan = poll.indexOf("XFBridge_IncidentSightPlan()");
    expect(plan).toBeGreaterThan(0);
    expect(poll.slice(plan)).toContain("if StrLen(plan) > 0 {");
    expect(poll.slice(plan).indexOf("XFIncidentTap.Sight(plan)")).toBeGreaterThan(poll.slice(plan).indexOf("if StrLen(plan) > 0 {"));
    expect(poll).toContain("(XFBridge_ProbeFlags() & 16) != 0 && XFBridge_Live()"); // the same gate as the taps
  });
  test("the sample is the taps' own Fact, bounded to eight actors, found only through the registry, and read only", () => {
    const sight = taps.slice(taps.indexOf("public static func Sight("), taps.indexOf("// The stimulus' own radius"));
    expect(sight).toContain("XFIncidentTap.Fact(view, actor, \"\")");
    expect(sight).toContain("found >= 8");
    expect(sight).toContain("XFIncidentWho.Find(handle)");
    expect(taps).toContain("registry.Entries()"); // by handle through the NPC registry, not by name or position
    expect(sight).not.toMatch(/Spawn|Despawn|Teleport|QueueEvent|SetAttitude|PlayVoiceOver|SendStim|BroadcastStim/);
    expect(inlineNativeResults(taps, "XFRuntimeBridgeIncidents.reds")).toEqual([]);
  });
  test("the wire keys the sampler sends are the keys the core parses", () => {
    const sight = taps.slice(taps.indexOf("public static func Sight("), taps.indexOf("// The stimulus' own radius"));
    for (const key of ["sight", "sim", "game", "dist", "view", "who"]) {
      expect(sight).toContain(`\\"${key}\\":`);
      expect(core).toContain(`"${key}"`);
    }
    expect(sight).toContain('view.photo ? "photo" : "gameplay"');
    expect(core).toContain('s.view != "gameplay" && s.view != "photo"');
    expect(plugin).toContain('wire.contains("sight")');
    expect(natives).toContain("IncidentSightPlan().c_str()");
  });
});

describe("0.8.21 the plugin's wiring", () => {
  test("a declared incident does not outlive the kill switch, a handover, a load or the taps going off", () => {
    expect(plugin).toContain('CloseDeclaredIncidents("kill")'); // TickIncidents
    expect(plugin).toContain('CloseDeclaredIncidents("handover")');
    expect(plugin).toContain('Incidents().CloseAllDeclared("load")');
    expect(plugin).toContain('Incidents().CloseAll("tap_off")'); // the existing close covers declared ones, with the same reason
    expect(read("native", "src", "plugin", "Handlers060.cpp")).toContain('CloseDeclaredIncidents("handover")');
    expect(read("native", "src", "plugin", "Main.cpp")).toContain("TickIncidents();");
  });
  test("the spawn link is only wired in the autonomous test build, and delivery covers all three events", () => {
    expect(plugin).toContain("if (Get().config.allowTestHooks && Available())");
    expect(plugin).toContain("NpcService().SetIncidentLink");
    for (const event of ["witness.report", "witness.gap", "witness.unwitnessed"]) expect(plugin + core, event).toContain(event);
    // the session events keep the engine's id and kind in the short form
    expect(plugin).toContain('brief["declared"] = aReport["declared"]');
  });
});

describe("0.8.21 catch-up", () => {
  const report = (id: string, extra: Record<string, unknown> = {}) => ({ event: "witness.report", incident: id, kind: "other", state: "closed", closed: "engine_close", v_involved: false,
    participants: [{ entity: "1" }, { entity: "2" }], place: { position: [1, 2, 3], district_v: "Watson_Kabuki" }, when: { start_sim_s: 1, end_sim_s: 5 }, confidence: 0.9, perceived: { modes: ["saw"] }, ...extra });
  test("a declared report keeps the engine's id and kind, and an unwitnessed one is listed with its reason", () => {
    const records = [{ channel: "incidents", valid: true, source_s: 10, data: report("inc-1", { declared: { id: "steal-1", kind: "pickpocket", roles: { a1: "thief" } } }) },
      { channel: "incidents", valid: true, source_s: 11, data: { event: "witness.unwitnessed", incident: "inc-2", declared: { id: "steal-2", kind: "pickpocket", roles: { a1: "thief" } }, reason: "not_in_view", closed: "engine_close" } }];
    const events = [{ kind: "witness.unwitnessed", source_s: 11, data: { incident: "inc-2", declared: { id: "steal-2", kind: "pickpocket" }, reason: "not_in_view", closed: "engine_close" } },
      { kind: "witness.unwitnessed", source_s: 12, data: { incident: "inc-3", declared: { id: "steal-3", kind: "chase" }, reason: "no_samples", closed: "ttl" } }];
    const digest = witnessedIncidents(records, events, true, true, true) as any;
    expect(digest.count).toBe(1);
    expect(digest.declared).toBe(1);
    expect(digest.reports[0].declared).toMatchObject({ id: "steal-1", kind: "pickpocket" });
    expect(digest.unwitnessed.map((u: any) => [u.incident, u.declared.id, u.reason])).toEqual([["inc-2", "steal-2", "not_in_view"], ["inc-3", "steal-3", "no_samples"]]);
    expect(digest.message).toContain("2 declared incidents went unwitnessed");
  });
  test("with nothing declared the digest is as it was", () => {
    const digest = witnessedIncidents([], [], false, true, false) as any;
    expect(digest.unwitnessed).toEqual([]);
    expect(digest.declared).toBe(0);
    expect(digest.message).toBe("while you were away: no witnessed incident reported");
  });
});
