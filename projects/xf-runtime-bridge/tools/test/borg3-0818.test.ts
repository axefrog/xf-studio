// Borg 3 regressions (0.8.18), offline: the recorder's invalid samples (their cause in the script layer, and the catch-up count
// that disagreed with its lists), the weapon-state reader, phone.call ring and auto-answer, the ink panel's avoid zones, the
// subtitle tap's UTF-8 and the call speaker's name. Each describes a finding of the third Borg session
// (bridge 0.8.17); proves nothing about the game.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catchUp } from "../testing/timeline.ts";
import type { Json, TestApi } from "../testing/windows.ts";
import { projectDir } from "./helpers.ts";

const source = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");

// A small recorder fixture: rows as given, read five at a time as the recorder does.
function recorder(rows: Array<{ channel: string; valid: boolean; data: Json }>, counters: { invalid?: number } = {}) {
  const all = rows.map((r, i) => ({ seq: i + 1, run: 1, session: "s", world_generation: 2, source_s: (i + 1) / 10, ...r }));
  const api: TestApi = { run: async (name, raw = {}) => {
    const input = raw as Json;
    let result: Json;
    if (name === "bridge.info") result = { sid: "s" };
    else if (name === "test.record.read") {
      const records = all.filter((r) => r.seq > (input.since ?? 0)).slice(0, 5);
      result = { run: 1, session: "s", world_generation: 2, active: true, latest: all.length, next: records.at(-1)?.seq ?? input.since, lost: 0, file_error: "",
        dropped: 0, invalid: counters.invalid ?? 0, missed_deadlines: 0, start_s: 0, end_s: null, source_now_s: all.length / 10, records };
    } else if (name === "session.events") result = { events: [], next: 0, latest: 0, dropped: 0 };
    else result = { v: { place: "live" } };
    return { ok: true, command: name, cid: "test", result };
  } };
  return api;
}

test("B3-1. the recorder's tap, face and UI coverage samples are enveloped, so the script-call layer does not reject them", () => {
  // The plugin's script call treats an answer without "ok":true as a failed call (GameHandlers.cpp CallScript), which recorded every
  // heartbeat of the subtitles, voice, face and ui channels as {"error":"failed"}: 15 to 25 percent of a run's records.
  const callScript = source("native", "src", "plugin", "GameHandlers.cpp");
  expect(callScript).toMatch(/if \(!parsed\.value\("ok", false\)\)/);
  const reds = source("redscript", "XFRuntimeBridgeRecording.reds");
  const sample = reds.slice(reds.indexOf("public static func Sample(cid: String, channel: String"), reds.indexOf("public abstract class XFRecordingActors"));
  for (const [channel, call] of [["subtitles", "XFRecordingTap.Status(channel)"], ["face", "XFRecordingFace.Status()"], ["ui", "XFRecordingUi.Sample()"]] as const) {
    expect(sample, channel).toContain(`XFRecording.Enveloped(${call})`);
    expect(sample, `${channel} must not return the bare sample`).not.toMatch(new RegExp(`return ${call.replace(/[().]/g, "\\$&")};`));
  }
  // Every branch of Sample answers through an envelope: the other sources spell "ok":true themselves or fail properly.
  const returns = sample.match(/return [^;]+;/g) ?? [];
  for (const r of returns) expect(/"ok\\":|Enveloped\(|XFJson\.Fail\(|XFRecordingActors\.Sample\(|XFRecordingTap\.Status\(|XFRecordingFace\.Status\(|XFRecordingUi\.Sample\(/.test(r), r).toBe(true);
  expect(reds).toContain('if StrBeginsWith(body, "{\\"ok\\":") { return body; }');
  expect(reds).toContain('return "{\\"ok\\":true," + StrMid(body, 1);');
  // A failed sample says why in its record, not only the bare code.
  expect(source("native", "src", "core", "Recording.cpp")).toContain('{"message", std::string(e.what()).substr(0, 200)}');
});

test("B3-7. a catch-up channel count reconciles with its list: invalid, coalesced and listed records are told apart", async () => {
  const rows: Array<{ channel: string; valid: boolean; data: Json }> = [];
  for (let i = 0; i < 40; i++) rows.push({ channel: "ui", valid: false, data: { error: "failed" } });
  for (let i = 0; i < 6; i++) rows.push({ channel: "ui", valid: true, data: { reason: i === 0 ? "change" : "heartbeat", hud: {} } });
  for (let i = 0; i < 30; i++) rows.push({ channel: "ui", valid: true, data: { event: "ui.consumer", consumer: `c${i}` } });
  for (let i = 0; i < 10; i++) rows.push({ channel: "v", valid: true, data: { position: [i, 0, 0], vitals: { health: 100, in_combat: false }, heat: "0", vehicle: { mounted: false }, busy: "" } });
  const page = await catchUp(recorder(rows, { invalid: 40 }), { run: 1 });
  // The count is every record read (as before) ...
  expect(page.counts.ui).toBe(76);
  // ... and the detail says where each went.
  expect(page.count_detail.ui).toEqual({ records: 76, invalid: 40, coalesced: 6, listed: 30, omitted: 6, shown: 24, valid: 36 });
  expect(page.count_detail.ui.invalid + page.count_detail.ui.coalesced + page.count_detail.ui.listed).toBe(page.counts.ui);
  expect(page.channels.ui.length + page.omitted.ui).toBe(page.count_detail.ui.listed);
  expect(page.channels.ui_latest.reason).toBe("heartbeat");
  expect(page.count_detail.v).toMatchObject({ records: 10, invalid: 0, listed: 0, coalesced: 0 });
  // Detail mode lists everything: nothing omitted.
  const detailed = await catchUp(recorder(rows, { invalid: 40 }), { run: 1, detail: true });
  expect(detailed.count_detail.ui).toMatchObject({ omitted: 0, shown: 30 });
  expect(detailed.invalid_channels).toEqual(["ui"]);
});

test("B3-2. the weapon-state reader names a drawn weapon's state instead of 'unknown', for ranged and melee weapons", () => {
  const reds = source("redscript", "XFRuntimeBridgePlayer.reds");
  const reader = reds.slice(reds.indexOf("public static func WeaponState("), reds.indexOf("// Why the bridge won't move V now"));
  // The active weapon object decides the kind; both PSM values are read and reported.
  expect(reader).toContain("ScriptedPuppet.GetActiveWeapon(player)");
  expect(reader).toContain("XFPlayer.Psm(player, defs.MeleeWeapon)");
  expect(reader).toContain('\\"kind\\":');
  expect(reader).toContain('\\"drawn\\":');
  expect(reader).toContain('\\"melee_raw\\":');
  expect(reader).toContain('\\"not_ready_blockers\\":');
  // A drawn weapon's 0 is NotReady (the game writes it on purpose), never "unknown"; "none" only without a weapon.
  expect(reds).toMatch(/case 0: return "NotReady";/);
  expect(reader).toContain('name = weapon == 0 ? "none" : XFPlayer.RangedStateName(weapon);');
  // The ranged names are the 2.31 script writers' (Ready 5, Safe 6, Reload 2, Shoot 8), the melee names gamePSMMeleeWeapon's.
  const ranged = reds.slice(reds.indexOf("func RangedStateName"), reds.indexOf("func MeleeStateName"));
  for (const [n, name] of [[1, "Charging"], [2, "Reload"], [3, "QuickMelee"], [4, "NoAmmo"], [5, "Ready"], [6, "Safe"], [7, "Overheat"], [8, "Shoot"]] as const)
    expect(ranged, name).toContain(`case ${n}: return "${name}";`);
  const melee = reds.slice(reds.indexOf("func MeleeStateName"), reds.indexOf("func WeaponBlockers"));
  for (const [n, name] of [[0, "NotReady"], [1, "Equipping"], [2, "Idle"], [3, "Safe"], [22, "Default"]] as const) expect(melee, name).toContain(`case ${n}: return "${name}";`);
  expect((melee.match(/case \d+: return/g) ?? []).length).toBe(23);
  // The readiness blockers are the ones IsWeaponReadyToShoot can be seen to hold (status effects and the scene tier).
  const blockers = reds.slice(reds.indexOf("func WeaponBlockers"), reds.indexOf("public static func WeaponState("));
  for (const tag of ["NoCombat", "VehicleScene", "Stunned", "Jam", "no_combat_status", "scene_tier", "takedown"]) expect(blockers, tag).toContain(tag);
});

test("B3-3. phone.call: ring_s reaches the game's HUD ring timer, auto_answer is in the catalogue, and the bridge answers with the phone's own pickup", async () => {
  const { findCommand } = await import("../api/catalogue.ts");
  const { validate } = await import("../api/schema.ts");
  const call = findCommand("phone_call")!;
  expect(validate(call.input, { contact: "coach", lines: [{ text: "Hi" }], ring_s: 30, auto_answer: true })).toEqual([]);
  expect(JSON.stringify(call.input)).toContain("auto_answer");
  const dm = source("redscript-dm", "XFRuntimeBridgeDm.reds");
  // The HUD phone arms its own ring timeout; for the bridge's call it is lent ring_s and then put back.
  const wrap = dm.slice(dm.indexOf("@wrapMethod(NewHudPhoneGameController)\npublic final func StartTimeoutFailsafe"));
  expect(wrap).toContain("this.m_TimeoutPeroid = ring;");
  expect(wrap.indexOf("wrappedMethod();")).toBeGreaterThan(wrap.indexOf("this.m_TimeoutPeroid = ring;"));
  expect(wrap.indexOf("this.m_TimeoutPeroid = kept;")).toBeGreaterThan(wrap.indexOf("wrappedMethod();"));
  expect(dm).toContain("registry.SetCallRing(ringS);");
  expect(dm).toContain("public static func Ring(cid: String, contact: String, mode: String, rejectable: Bool, ringS: Float)");
  // Answering is the HUD's own PickupPhoneRequest for the owned, ringing call; nothing is pressed.
  const answer = dm.slice(dm.indexOf("public static func Answer("), dm.indexOf("public static func Start("));
  expect(answer).toContain("new PickupPhoneRequest()");
  expect(answer).toContain("pickup.shouldBeRejected = false;");
  expect(answer).toContain("questPhoneCallPhase.IncomingCall");
  expect(answer).toContain("registry.CallContact(), contact");
  const plugin = source("native", "src", "plugin", "HandlersDm080.cpp");
  expect(plugin).toContain('{"String", "String", "Bool", "Float"}');
  expect(plugin).toContain('ScriptCall("XFDmPhone", "Answer"');
});

test("B3-4. the ink panel steps aside for the incoming-call widget as it does for the phone's messenger", () => {
  const ink = source("redscript", "XFRuntimeBridgeInk.reds");
  const widget = ink.slice(ink.indexOf("public static func CallWidgetUp()"), ink.indexOf("public static func PhoneOpen()"));
  expect(widget).toContain("defs.PhoneCallInformation");
  expect(widget).toContain("questPhoneCallPhase.IncomingCall");
  expect(widget).toContain("questPhoneCallPhase.StartCall");
  const open = ink.slice(ink.indexOf("public static func PhoneOpen()"), ink.indexOf("public static func Font()"));
  expect(open).toContain("contacts || messenger || reading || XFInkStyle.CallWidgetUp()");
  // The step-aside itself is the panel's existing rule.
  expect(ink).toContain("this.m_view.canvas.SetVisible(frame.show && !this.m_phoneOpen);");
});

test("B3-5. the CLI prints results as ASCII JSON, so no console code page can garble a subtitle's ellipsis; the data is UTF-8 end to end", async () => {
  const { asciiJson } = await import("../api/json-ascii.ts");
  const line = { display_text: "I need a nap\u2026 just a short one.", text: "<kiroshi o=\"\u00a1Pide ayuda!\"/>", emoji: "\u{1F600}" };
  const printed = asciiJson(line);
  expect(/^[\x00-\x7f]*$/.test(printed)).toBe(true);
  expect(printed).toContain("nap\\u2026 just");
  expect(JSON.parse(printed)).toEqual(line);
  expect(asciiJson({ a: [1, "\u00e9"] }, 2)).toBe('{\n  "a": [\n    1,\n    "\\u00e9"\n  ]\n}');
  expect(asciiJson(undefined)).toBe("null");
  const cli = source("tools", "bridge-client.ts");
  expect(cli).toContain("printJson(outcome.result, 2)");
  expect(cli).toContain("--raw-utf8");
  // The recorder's native unit tests prove the ring and the wire carry the text byte for byte (UnitTestsRecording.cpp, "utf-8 line").
  expect(source("native", "src", "selftest", "UnitTestsRecording.cpp")).toContain("the wire text keeps the ellipsis and has no replacement character");
});

test("B3-6. a call line with no speaker is spoken by the contact's localised name (the id only as a fallback)", () => {
  const dm = source("redscript-dm", "XFRuntimeBridgeDm.reds");
  const name = dm.slice(dm.indexOf("public static func ContactName("), dm.indexOf("public static func Ring("));
  expect(name).toContain("GetLocalizedText(found.GetLocalizedName(journal))");
  const core = source("native", "src", "core", "Dm080.cpp");
  expect(core).toContain("m_ops.contactName(aRequest.contact)");
  expect(core).not.toMatch(/out\.speaker = request\.contact;/);
  const catalogue = source("tools", "api", "catalogue080dm.ts");
  expect(catalogue).toContain("default the contact's name as the phone shows it");
});
