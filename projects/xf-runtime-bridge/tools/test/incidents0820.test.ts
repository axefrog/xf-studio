// Bridge 0.8.20: what V witnessed (research/story-engine/runtime-requirements.md S7). The grouping, perception gating and bounds are the
// native core's unit tests (UnitTestsIncidents.cpp). These checks keep the tools, the catalogue, the packaging and the redscript taps in
// step with it: the command, the recorder channel, the catch-up summary, the wire contract between the taps and the core, and that the
// taps stay passive and autonomous-only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findCommand } from "../api/catalogue.ts";
import { validate } from "../api/schema.ts";
import { assertNativeGlobals, packageScripts } from "../redscript-natives.ts";
import { inlineNativeResults } from "../lint-world-objects.ts";
import { catchUp, witnessedIncidents } from "../testing/timeline.ts";
import type { Json, TestApi } from "../testing/windows.ts";
import { projectDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8").replace(/\r\n/g, "\n");
const taps = read("redscript-probes", "autonomous", "XFRuntimeBridgeIncidents.reds");
const core = read("native", "src", "core", "Incidents.cpp");
const natives = read("native", "src", "plugin", "Natives.cpp");

describe("0.8.20 the command and the recorder channel", () => {
  test("incidents.list is a test-gated read with checked parameters", () => {
    const command = findCommand("incidents.list")!;
    expect(command.permission).toBe("read");
    expect(command.bridge).toMatchObject({ method: "incidents.list" });
    expect(command.refusals).toContain("test_hooks_off");
    for (const ok of [{}, { state: "open" }, { witnessed: true, v_involved: false, limit: 64, tap: false }]) expect(validate(command.input, ok)).toEqual([]);
    for (const bad of [{ state: "later" }, { limit: 0 }, { limit: 65 }, { witnessed: "yes" }, { colour: "red" }]) expect(validate(command.input, bad).length).toBeGreaterThan(0);
    expect(command.description).toContain("passive");
    expect(command.description).toContain("was told");
  });
  test("the recorder takes incidents as a tenth, optional channel and the capture arm can wait for it", () => {
    const start = findCommand("test.record.start")!.input;
    const all = ["v", "actors", "camera", "subtitles", "voice", "face", "ui", "contacts", "supervisor", "incidents", "events"];
    expect(validate(start, { channels: all })).toEqual([]);
    expect(validate(start, { channels: [...all, "v"] }).length).toBeGreaterThan(0);
    expect(validate(findCommand("capture.arm")!.input, { run: 1, event: "witness.report", channel: "incidents", capture: "screenshot" })).toEqual([]);
    const recording = read("native", "src", "core", "Recording.cpp");
    expect(recording).toContain('c != "incidents"');
    expect(recording).toContain("channel == \"incidents\" ? 64");
    expect(recording).toContain("channels.size() > 11");
    // never a default channel: the default run is unchanged
    expect(recording).toContain('json::array({"v", "actors", "camera", "contacts", "supervisor"})');
  });
  test("the build and the tools carry the 0.8.20 incident work (0.8.21 and 0.8.22 added to it)", () => {
    expect(read("native", "CMakeLists.txt")).toMatch(/VERSION 0\.8\.25/);
    expect(JSON.parse(read("package.json")).version).toBe("0.8.25");
    expect(natives).toContain("natives=37");
  });
});

describe("0.8.20 review fixes in the taps", () => {
  test("fix 3: a ray that hit with an invalid result is Unchecked, not clear", () => {
    const ray = taps.slice(taps.indexOf("public func Ray(point: Vector4)"), taps.indexOf("// An XF actor's handle"));
    const noHit = ray.indexOf("if !hit {"), invalid = ray.indexOf("if !TraceResult.IsValid(result) {");
    expect(noHit).toBeGreaterThan(0);
    expect(invalid).toBeGreaterThan(noHit);
    expect(ray.slice(noHit, invalid)).toContain("return 0;");
    expect(ray.slice(invalid, invalid + 60)).toContain("return 2;");
    expect(ray).not.toContain("!hit || !TraceResult.IsValid(result)");
    // and the core treats an unchecked ray as no sight (UnitTestsIncidents: "a ray that wasn't cast proves nothing")
    expect(core).toContain("f.los != Los::Clear");
  });
  test("fix 2: every tap asks the plugin's admission before building anything, with its evidence and the entity", () => {
    const begins = [...taps.matchAll(/XFIncidentTap\.Begin\(at, (\w+|"\w+"), (\w+)\)/g)].map(m => m[1]);
    expect(begins.sort()).toEqual(['"combat"', '"death"', '"reprimand"', '"theft"', '"voice"', "evidence"].sort());
    const begin = taps.slice(taps.indexOf("public static func Begin("), taps.indexOf("// One person or vehicle with V's samples"));
    expect(begin.indexOf("Vector4.Distance(view.vPos, at) > 160.0")).toBeLessThan(begin.indexOf("XFBridge_IncidentAdmit"));
    expect(begin.indexOf("XFBridge_IncidentAdmit")).toBeLessThan(begin.indexOf("return view;"));
    // the plugin's side: registered, counted, and bounded by evidence and key
    expect(natives).toContain('"XFBridge_IncidentAdmit"');
    expect(core).toContain("++m_stats.tapDroppedRepeat");
    expect(core).toContain("++m_stats.tapDroppedWeak");
    expect(core).toContain("++m_stats.tapDroppedCap");
  });
});

describe("0.8.20 the taps: autonomous only, wired to a registered native, passive", () => {
  const writes = packageScripts(projectDir, "writes", false).map(s => s.text).join("\n");
  const autonomous = packageScripts(projectDir, "writes", true);
  test("only the autonomous package carries the taps and their native", () => {
    for (const variant of ["default", "diagnostic", "writes"]) {
      const text = packageScripts(projectDir, variant, false).map(s => s.text).join("\n");
      expect(text).not.toContain("public abstract class XFIncidentTap");
      expect(text).toContain('@if(ModuleExists("XFRuntimeBridge.Autonomous"))');
      expect(text).not.toContain("XFBridge_IncidentSeen");
    }
    expect(writes).not.toContain("XFIncidentSystem");
    const text = autonomous.map(s => s.text).join("\n");
    expect(text).toContain("XFIncidentTap");
    expect(text).toContain("public static native func XFBridge_IncidentSeen(payload: String) -> Bool");
    expect(text).toContain("public static native func XFBridge_IncidentAdmit(evidence: String, key: String) -> Bool");
    expect(() => assertNativeGlobals(autonomous, natives, true)).not.toThrow();
    // registered inside the autonomous-only block, so a normal DLL has no such native
    const block = natives.slice(natives.indexOf("#ifdef XFB_AUTONOMOUS_TEST_HOOKS\n        RegisterGlobal(rtti, \"XFBridge_TestUiTake\""));
    expect(block.slice(0, block.indexOf("#endif"))).toContain('"XFBridge_IncidentSeen"');
  });
  test("every wrap calls the game's own method first, then reads", () => {
    const wraps = [...taps.matchAll(/@wrapMethod\((\w+)\)\n[^\n]*\n([\s\S]*?)\n}\n/g)];
    expect(wraps.map(w => w[1]).sort()).toEqual(["AICombatTargetHelper", "GameObject", "ReactionManagerComponent", "StimBroadcasterComponent"]);
    for (const wrap of wraps) {
      const body = wrap[2]!;
      expect(body.indexOf("wrappedMethod("), wrap[1]).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("wrappedMethod("), wrap[1]).toBeLessThan(body.indexOf("XFIncidentTap."));
    }
    // 0.8.25: vehicle theft is one shared wrap that feeds the incidents and the world feed; the game's method still runs
    // first, and the incidents' call keeps its gate.
    const hooks = read("redscript", "XFRuntimeBridgeWorldHooks.reds");
    const steal = hooks.slice(hooks.indexOf("@wrapMethod(VehicleObject)\nprivate final func StealVehicle("));
    expect(steal.indexOf("wrappedMethod(thief);")).toBeGreaterThan(0);
    expect(steal.indexOf("wrappedMethod(thief);")).toBeLessThan(steal.indexOf("XFWorldHooks.Theft(this, thief as GameObject);"));
    expect(hooks).toContain("if XFIncidentTap.On() { XFIncidentTap.Theft(vehicle, thief); }");
    expect(taps).not.toContain("@wrapMethod(VehicleObject)");
  });
  test("nothing in the taps writes to the game or sends anything into it", () => {
    const code = taps.replace(/\/\/[^\n]*/g, "");
    for (const forbidden of ["QueueEvent", "DelayEvent", "SetAttitude", "SetFact", "BroadcastStim", "BroadcastActiveStim", "SendDrirectStimuli", "SendStimDirectly", "GiveItem", "RemoveItem",
      "Teleport", "InjectThreat", "SetThreatPersistence", "TryChangingAttitude", "TryStartCombat", "Despawn", "SetHealth", "ChangeStatPoolValue", "ApplyStatusEffect", "StartCooldown",
      "SetPaused", "SetTimeDilation", "GameObject.PlayVoiceOver", "PlaySound", "SetGlobalThreat", "SpawnEntity", "SetWantedLevel", "QueueRequest", "RegisterListener", "RegisterCallback"])
      expect(code.includes(forbidden), forbidden).toBe(false);
    // the one thing it does register is a delay callback that sends the simulation clock
    expect(code.match(/DelayCallback\(/g)!.length).toBe(2);
    // the only native it calls with data is the incident one, and reads are gated and bounded
    expect(code.match(/XFBridge_\w+\(/g)!.filter(n => !["XFBridge_ProbeFlags(", "XFBridge_Live(", "XFBridge_IncidentSeen(", "XFBridge_IncidentAdmit(", "XFBridge_IncidentSightPlan("].includes(n))).toEqual([]);
  });
  test("the world-object rule holds in the taps: every native's answer in a local before text is built", () => {
    expect(inlineNativeResults(taps, "XFRuntimeBridgeIncidents.reds")).toEqual([]);
  });
  test("the allow-lists and bounds are what the knowledge page says", () => {
    for (const stim of ["Gunshot", "SilencedGunshot", "Explosion", "MeleeHit", "CrimeWitness", "CrowdIllegalAction", "VehicleHit", "Scream", "Terror", "DeadBody"])
      expect(taps).toContain(`case gamedataStimType.${stim}:`);
    for (const never of ["FootStepRegular", "Bump", "Reload", "Combat:", "SpreadFear"]) expect(taps.replace(/\/\/[^\n]*/g, "")).not.toContain(`gamedataStimType.${never}`);
    for (const bark of ["vo_any_damage_hit", "grenade_throw", "reloading", "fear_beg", "fear_run", "battlecry_single_enemy", "battlecry_curse", "battlecry_morale", "combat_target_hit"])
      expect(taps).toContain(`n"${bark}"`);
    expect(taps).not.toContain('n"fear_foll"'); // a stalking line, not a fright
    expect(taps).toContain("> 160.0"); // the distance gate
    expect(taps).toContain("XFBridge_IncidentAdmit(evidence, key)"); // the per-second admission is the plugin's, counted
    expect(taps).not.toContain("m_windowStart"); // no uncounted allowance of the script's own
    expect(taps).toContain("distance <= 80.0"); // rays only within the see range
  });
  test("the wire keys the taps send are the keys the core parses, and the evidence names agree", () => {
    for (const key of ["ev", "type", "radius", "pos", "vd", "sim", "game", "dist", "view", "who"]) {
      expect(taps).toContain(`\\"${key}\\":`);
      expect(core).toContain(`"${key}"`);
    }
    for (const key of ["id", "role", "pos", "v", "d", "w", "rec", "crowd", "aff", "in", "los"]) {
      expect(taps).toContain(`\\"${key}\\":`);
      expect(core).toContain(`"${key}"`);
    }
    expect(taps).toContain('\\"tick\\":true,\\"sim\\":');
    expect(read("native", "src", "plugin", "HandlersIncidents.cpp")).toContain('wire.contains("tick")');
    const sent = new Set([...taps.matchAll(/(?:evidence = ([^;]+);|Send\(view, ("\w+"))/g)].flatMap(m => [...(m[1] ?? m[2]!).matchAll(/"(\w+)"/g)].map(q => q[1]!)).filter(name => name.length > 0));
    for (const name of ["gunshot", "explosion", "melee", "crime", "collision", "vehicle_hit", "fear", "body", "death", "combat", "reprimand", "theft", "voice"]) {
      expect(sent.has(name), name).toBe(true);
      expect(core).toContain(`{"${name}", `);
    }
    for (const name of sent) expect(core.includes(`{"${name}", `), name).toBe(true);
    const roles = new Set([...taps.matchAll(/Fact\(view, [^,]+, (?:IsDefined\(vehicle\) \? "(\w+)" : )?"(\w+)"\)/g)].flatMap(m => [m[1], m[2]]).filter(Boolean));
    for (const role of roles) expect(read("native", "src", "core", "Incidents.hpp").includes(`"${role}"`), String(role)).toBe(true);
  });
});

function fixture() {
  const rows: Json[] = [], events: Json[] = [];
  const api: TestApi = { run: async (name, input: Json = {}) => {
    if (name === "bridge.info") return { ok: true, command: name, cid: "t", result: { sid: "s" } };
    if (name === "session.events") {
      const mine = events.filter(e => e.seq > (input.since ?? 0));
      return { ok: true, command: name, cid: "t", result: { events: mine, latest: events.length, next: events.length, dropped: 0 } };
    }
    const mine = rows.filter(r => r.seq > (input.since ?? 0));
    return { ok: true, command: name, cid: "t", result: { run: 1, session: "s", world_generation: 1, channels: ["v", "incidents"], active: true, records: mine, latest: rows.length, next: mine.at(-1)?.seq ?? input.since ?? 0, lost: 0 } };
  } };
  const report = (id: string, kind: string, modes: string[], extra: Json = {}) => ({ event: "witness.report", incident: id, kind, state: "closed", closed: "quiet", v_involved: false,
    participants: [{ entity: "1" }, { entity: "2" }], place: { position: [1, 2, 3], district_v: "Watson_Kabuki" }, when: { start_sim_s: 1, end_sim_s: 5 }, confidence: 0.8, perceived: { modes }, ...extra });
  const record = (data: Json, channel = "incidents") => rows.push({ seq: rows.length + 1, run: 1, session: "s", world_generation: 1, valid: true, source_s: 10 + rows.length, channel, data });
  const session = (data: Json, kind = "witness.report") => events.push({ seq: events.length + 1, kind, source_s: 10 + events.length, data });
  return { api, report, record, session };
}

describe("0.8.20 review fixes: catch-up counts what the incident tap could not show", () => {
  const cover = (over: Json) => ({ event: "incident.coverage", valid: true, dropped_rate: 0, dropped_invalid: 0, tap_dropped_cap: 0, tap_dropped_weak: 0, tap_dropped_repeat: 0, report_gaps: 0, pending_reports: 0, ...over });
  test("fix 2: evidence the plugin or the taps' admission refused makes the page incomplete, once, against the cursor's baseline", async () => {
    const f = fixture();
    f.record(cover({}));
    f.record(cover({ tap_dropped_cap: 3, tap_dropped_repeat: 40 }));
    const first = await catchUp(f.api, { run: 1, digest: false });
    expect(first.gaps).toContain("incident_evidence_dropped");
    expect(first.complete).toBe(false);
    expect(first.incident_summary.coverage).toMatchObject({ evidence_dropped_by_tap: 3, evidence_dropped_by_plugin: 0, coalesced_repeats_total: 40 });
    expect(first.cursor.incident_counters).toEqual({ dropped: 0, tap_dropped: 3, report_gaps: 0 });
    f.record(cover({ tap_dropped_cap: 3, tap_dropped_repeat: 80 }));
    const quiet = await catchUp(f.api, { cursor: first.cursor, digest: false });
    expect(quiet.gaps).not.toContain("incident_evidence_dropped"); // repeats are coalesced, not lost; nothing new was refused
    f.record(cover({ tap_dropped_cap: 3, dropped_rate: 2 }));
    const again = await catchUp(f.api, { cursor: quiet.cursor, digest: false });
    expect(again.gaps).toContain("incident_evidence_dropped");
    expect(again.incident_summary.coverage.evidence_dropped_by_plugin).toBe(2);
    expect(validate(findCommand("game.catchup")!.input, { cursor: again.cursor })).toEqual([]);
    expect(validate(findCommand("game.catchup")!.input, { cursor: { ...again.cursor, incident_counters: { dropped: -1, tap_dropped: 0, report_gaps: 0 } } }).length).toBeGreaterThan(0);
  });
  test("fix 1: a witness.gap, or a growing report_gaps counter, is a visible gap with the incident named", async () => {
    const f = fixture();
    f.record(cover({}));
    f.record({ event: "witness.gap", incident: "inc-9", kind: "street_fight", modes: ["saw"], reason: "report_queue_full" });
    f.session({ incident: "inc-9", kind: "street_fight", reason: "report_queue_full" }, "witness.gap");
    f.record(cover({ report_gaps: 1, pending_reports: 4 }));
    const page = await catchUp(f.api, { run: 1, digest: false });
    expect(page.gaps).toContain("incident_report_gap");
    expect(page.incident_summary.coverage).toMatchObject({ report_gaps: 1, report_gap_incidents: ["inc-9"], reports_pending: 4 });
    expect(page.complete).toBe(false);
  });
  test("a page with no incident channel adds no gaps and no baseline", async () => {
    const f = fixture();
    const page = await catchUp(f.api, { run: 1, digest: false });
    expect(page.gaps).toEqual([]);
    expect(page.cursor.incident_counters).toBeUndefined();
  });
});

describe("0.8.20 catch-up mentions the witnessed incidents", () => {
  test("the recorder's whole report and the session event's short form are one incident each", async () => {
    const f = fixture();
    f.record({ event: "incident.coverage", valid: true });
    f.record(f.report("inc-3", "street_fight", ["saw", "heard"]));
    f.record(f.report("inc-4", "assault", ["heard"], { v_involved: true }));
    f.session({ incident: "inc-3", world: 1, kind: "street_fight", modes: ["saw", "heard"], confidence: 0.8, v_involved: false, participants: 2, place: [1, 2, 3], district_v: "Watson_Kabuki", when: {}, closed: "quiet" });
    f.session({ incident: "inc-5", world: 1, kind: "gunfire", modes: ["heard"], confidence: 0.6, v_involved: false, participants: 1, place: [9, 9, 9], district_v: "Watson_Kabuki", when: {}, closed: "quiet" });
    const page = await catchUp(f.api, { run: 1, digest: false });
    const s = page.incident_summary;
    expect(s.count).toBe(3);
    expect(s.message).toBe("while you were away: V witnessed 3 incidents (1 street_fight, 1 assault, 1 gunfire)");
    expect(s.by_mode).toEqual({ saw: 1, heard: 3, told: 0 });
    expect(s.v_involved).toBe(1);
    expect(s.recorder_channel).toBe(true);
    const three = s.reports.find((r: Json) => r.incident === "inc-3");
    expect(three.sources).toEqual(["recorder", "session_events"]);
    expect(three).toMatchObject({ kind: "street_fight", participants: 2, district_v: "Watson_Kabuki", place: [1, 2, 3] });
    expect(s.reports.find((r: Json) => r.incident === "inc-5").sources).toEqual(["session_events"]);
    // the coverage heartbeat is listed with the channel but is not a report
    expect(page.channels.incidents.length).toBe(3);
  });
  test("with nothing witnessed it says so, and the other tools' summaries are untouched", async () => {
    const f = fixture();
    f.record({ event: "incident.coverage", valid: true });
    const page = await catchUp(f.api, { run: 1, digest: false });
    expect(page.incident_summary).toMatchObject({ count: 0, message: "while you were away: no witnessed incident reported", reports: [] });
    expect(page.supervisor_summary.message).toContain("no supervisor receipts");
    expect(page.contact_summary.message).toContain("no contact observed");
  });
  test("the summary is bounded and singular for one", () => {
    const rows: Json[] = Array.from({ length: 40 }, (_, i) => ({ channel: "incidents", valid: true, source_s: i, data: { event: "witness.report", incident: `inc-${i}`, kind: "other", perceived: { modes: ["heard"] }, participants: [], place: { position: [0, 0, 0] } } }));
    const s = witnessedIncidents(rows, [], false, true, false);
    expect(s.count).toBe(40);
    expect(s.reports.length).toBe(24);
    expect(s.omitted).toBe(16);
    expect(s.recorder_channel).toBe(false);
    expect(witnessedIncidents(rows.slice(0, 1), [], true, true, false).message).toBe("while you were away: V witnessed 1 incident (1 other)");
    expect(witnessedIncidents(rows, [], true, true, true).reports.length).toBe(40);
  });
});
