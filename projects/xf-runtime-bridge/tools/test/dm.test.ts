// Bridge 0.8.12's live-direction toolkit (research/runtime/runtime-bridge-design.md §3.21), offline: the catalogue's dm
// commands and their tables against the plugin's own (core/Dm080.cpp, core/DmService.cpp, the script layer's source), the
// scripts' safety rules read from the source; and against the self-test host's simulated world (selftest/SimDm080.cpp, the
// plugin's own dm::Service): the dm write class and its gate, props, vehicles, doors, sounds, a radio, a voice line, the phone
// (a toast, a real call answered, declined, missed, ended), the quest tracker, the game's messages, lights and their patterns,
// watchers and the micro-actions they run through the dispatcher's own gates, the digest, save holds, the pause, a handover, a
// load and the kill switch. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { CATALOGUE, findCommand, PERMISSIONS } from "../api/catalogue.ts";
import { DM_LIGHT_PATTERNS, DM_NOTIFY_STYLES, DM_RADIO_STATIONS, DM_REFUSALS, DM_VEHICLE_DOORS, DM_WAIT_KINDS, DM_WATCH_KINDS } from "../api/catalogue080dm.ts";
import { DM_MESSAGES, DM_METHODS } from "../api/errors080dm.ts";
import { plainBridgeError } from "../api/errors.ts";
import { WAIT_KINDS } from "../api/catalogue070.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const ALL = "photo,world,character,save,showroom,player,npc,dm";
const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8").split(String.fromCharCode(13)).join("");
const core = read("native", "src", "core", "Dm080.cpp") + " " + read("native", "src", "core", "Dm080.hpp");
const service = read("native", "src", "core", "DmService.cpp");
const script = read("redscript-dm", "XFRuntimeBridgeDm.reds");
const DM_NAMES = [
  "world.spawn",
  "world.despawn",
  "world.spawned",
  "world.door",
  "vehicle.set",
  "audio.play",
  "audio.stop",
  "audio.radio",
  "audio.voice",
  "phone.text",
  "phone.call",
  "phone.end",
  "phone.state",
  "quest.set",
  "quest.objective",
  "quest.clear",
  "quest.state",
  "notify.show",
  "notify.hide",
  "light.spawn",
  "light.set",
  "light.remove",
  "watch.arm",
  "watch.disarm",
  "watch.list",
  "game.digest",
];
const DM_READS = ["world.spawned", "phone.state", "quest.state", "watch.list", "game.digest"];

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-dm-cap-"), "captures"), auditDir: tempDir("xfb-dm-audit-"), idleCloseMs: 300 });

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

const world = (api: CommandApi, params: Record<string, unknown> = {}) => bridge(api, "selftest.dm", params);

/** Waits for a dm event after `since` that satisfies `match`, up to `ms`. */
async function event(api: CommandApi, kind: string, since: number, match: (e: Any) => boolean = () => true, ms = 8000): Promise<Any> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const events = await bridge(api, "session.events", { since, limit: 200, kinds: [kind] });
    const hit = (events.events as Any[]).find(match);
    if (hit) return hit;
    await sleep(100);
  }
  throw new Error(`no ${kind} within ${ms} ms`);
}

const latest = async (api: CommandApi) => Number((await bridge(api, "session.events", { since: 0, limit: 1 })).latest ?? 0);

async function until(check: () => Promise<boolean>, ms = 6000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error("the condition did not come true in time");
}

async function reset(api: CommandApi) {
  await api.run("watch.disarm", { all: true });
  await api.run("phone.end", {});
  await api.run("quest.clear", { all: true });
  await api.run("light.remove", { all: true });
  await api.run("world.despawn", { all: true });
  await api.run("audio.stop", { all: true });
  await api.run("notify.hide", {});
  await world(api, { codeware: true, hud: true, carrier: false, calling: true, combat: false, weapon: false, mounted: false, look_at: "", contacts: ["test_fixer", "test_friend"], call_fact: 0 });
  await bridge(api, "selftest.player", { busy: "", position: [100, 200, 10], yaw: 0 });
}

describe("0.8.12 dm offline: the catalogue, its tables against the plugin's, the scripts' safety rules", () => {
  test("all 26 commands are in the catalogue with the dm class (the five reads stay read), and the class has plain text", () => {
    const dm = CATALOGUE.filter((c) => DM_NAMES.includes(c.name));
    expect(dm.map((c) => c.name).sort()).toEqual([...DM_NAMES].sort());
    for (const c of dm) expect(c.permission, c.name).toBe(DM_READS.includes(c.name) ? "read" : "write-dm");
    expect(PERMISSIONS["write-dm"].label).toBe("Direct the scene");
    expect(new Set(DM_METHODS)).toEqual(new Set(DM_NAMES));
    for (const c of dm) expect(c.refusals, c.name).toBeDefined();
  });

  test("every refusal code a dm command names is raised by the plugin's source, the script layer or the tools' own wording", () => {
    const sources = core + service + script + read("native", "src", "core", "Params.cpp");
    const universal = new Set(["not_in_world", "not_v"]);
    for (const [name, codes] of Object.entries(DM_REFUSALS)) {
      expect(DM_NAMES, name).toContain(name);
      for (const code of codes) {
        if (universal.has(code) || code === "script_layer_missing") continue;
        expect(sources.includes(`"${code}"`), `${name}: ${code}`).toBe(true);
      }
    }
    for (const code of new Set(Object.values(DM_REFUSALS).flat())) {
      const plain = plainBridgeError(code, undefined, "world.spawn");
      expect(plain.message, code).not.toContain("didn't explain");
    }
    expect(plainBridgeError("limit", undefined, "world.spawn").message).toBe(DM_MESSAGES.limit);
    expect(plainBridgeError("limit", undefined, "npc.spawn").message).not.toBe(DM_MESSAGES.limit);
  });

  test("the tools' lists equal the plugin's own (notify styles, radio stations, vehicle doors, patterns, watcher kinds)", () => {
    for (const style of DM_NOTIFY_STYLES) expect(core).toContain(`"${style}"`);
    expect((core.match(/static const std::vector<std::string> styles\{([^}]*)\}/)![1]!.match(/"/g) ?? []).length / 2).toBe(DM_NOTIFY_STYLES.length);
    const stations = core.match(/static const std::vector<std::string> stations\{([^}]*)\}/s)![1]!.match(/"[a-z_]+"/g)!.map((s) => s.slice(1, -1));
    expect(stations).toEqual([...DM_RADIO_STATIONS]);
    for (const door of DM_VEHICLE_DOORS) expect(core).toContain(`"${door}"`);
    for (const pattern of DM_LIGHT_PATTERNS) expect(core).toContain(`"${pattern}"`);
    const kinds = core.match(/static const std::vector<std::string> names\{([^}]*)\}/)![1]!.match(/"[a-z]+"/g)!.map((s) => s.slice(1, -1));
    expect(kinds).toEqual([...DM_WATCH_KINDS]);
    for (const kind of DM_WAIT_KINDS) expect(WAIT_KINDS).toContain(kind);
    expect(findCommand("session.wait")).toBeDefined();
  });

  test("the toolkit's methods are the ones the service registers, with the catalogue's access classes", () => {
    for (const name of DM_NAMES) expect(service, name).toContain(`{"${name}", Access::${DM_READS.includes(name) ? "Read" : "WriteDm"},`);
  });

  test("the script layer never touches the journal or a save: no journal write, no quest fact write, no shard popup", () => {
    for (const forbidden of ["ChangeEntryState", "TrackEntry", "UntrackEntry", "SetEntryVisited", "SetFactStr", "SetFact(", "NotifyShardRead", "CreateScriptedQuest", "GameInstance.GetSaveSystem", "RequestSave"]) {
      expect(script.includes(forbidden), forbidden).toBe(false);
    }
  });

  test("the phone refuses a caller the journal lacks (the session-7 null-call family) and lists only active contacts", () => {
    expect(script).toContain('XFJson.Fail("contact_unknown"');
    expect(script).toContain("context.stateFilter.active = true;");
    expect(script).not.toContain("stateFilter.inactive");
    expect(script.indexOf("XFDmPhone.HasContact(contact)")).toBeLessThan(script.indexOf("phone.QueueRequest(XFDmPhone.Request(contact, questPhoneCallPhase.IncomingCall"));
    expect(script).toContain("phone.IsCallingEnabled()");
  });

  test("every hook that fires from the game's own UI checks the live guard before it reads anything, and listeners are taken down at detach", () => {
    expect(script).toContain("private func OnDetach() -> Void {\n    this.Listen(false);");
    const attempt = script.slice(script.indexOf("protected cb func OnXFDmAttempt"), script.indexOf("protected cb func OnXFDmIndex"));
    expect(attempt.indexOf("XFBridge_Live()")).toBeGreaterThan(0);
    expect(attempt.indexOf("XFBridge_Live()")).toBeLessThan(attempt.indexOf("FromVariant"));
    const wrap = script.slice(script.indexOf("@wrapMethod(QuestTrackerGameController)\nprotected cb func OnTrackedMappinUpdated"));
    expect(wrap.indexOf("XFBridge_Live()")).toBeGreaterThan(0);
    expect(wrap.indexOf("XFBridge_Live()")).toBeLessThan(wrap.indexOf("return wrappedMethod(value);")); // ownership suppresses vanilla's async spawn
  });

  test("a spawned thing is never saved and everything is taken down by the registry and by tag", () => {
    expect(script).toContain("spec.persistState = false;");
    expect(script).toContain("spec.persistSpawn = false;");
    expect(script).toContain('ArrayPush(spec.tags, n"xfs_dm");');
    expect(script).toContain('system.DeleteTagged(n"xfs_dm");');
    // Every changing step takes the bridge's save lock first.
    for (const fn of ["Spawn", "Door", "Vehicle", "Radio", "Ring", "Text", "Tracker"]) {
      const body = script.slice(script.indexOf(`public static func ${fn}(`));
      expect(body.slice(0, 2600), fn).toContain("XFBridgeActions.EnsureSaveLock(cid)");
    }
  });

  test("review 1: mutable session reads are marshalled to the game thread", () => {
    for (const name of ["quest.state", "watch.list"]) expect(service).toContain(`{"${name}", Access::Read, true,`);
  });

  test("review 2/11: journal-free phone data bypasses vanilla's unsafe lookups and owned queues are removable", () => {
    const draw = script.slice(script.indexOf("@wrapMethod(MessengerNotification)"), script.indexOf("@addMethod(NewHudPhoneGameController)\npublic func XFDmRemove"));
    expect(draw).toContain("as XFDmMessageData");
    expect(draw).toContain("if !IsDefined(owned) { wrappedMethod(notificationData); return; }");
    expect(draw).not.toContain("GetAvatarID");
    expect(draw).not.toContain("GetAttachmentPathHash");
    expect(draw).toContain("super.SetNotificationData(notificationData)");
    expect(script).toContain("if IsDefined(data as XFDmNotificationRemove) { return false; }");
    expect(script).toContain("new XFDmMessageData()");
    expect(script).toContain("new XFDmQuestData()");
    expect(script.match(/this.RemoveNotification\(request\)/g)?.length).toBe(2);
    expect(script).toContain("phone.XFDmRemove(style)");
    expect(script).toContain("quests.XFDmRemove(style)");
  });

  test("review 6: external phone completion revokes ownership and a queued end checks contact and phase again", () => {
    const phone = script.slice(script.indexOf("@wrapMethod(PhoneSystem)"), script.indexOf("// --- messages and the quest tracker"));
    expect(phone).toContain('!owned { registry.SetCallContact(""); }');
    expect(script).toContain("@addField(questTriggerCallRequest)");
    expect(phone).toContain("let owned = request.xfsDmOwned;");
    expect(phone).toContain("NotEquals(this.m_LastCallInformation.contactName, request.caller)");
    expect(phone).toContain("this.m_LastCallInformation.callPhase, questPhoneCallPhase.StartCall");
    expect(phone).toContain('Equals(callPhase, questPhoneCallPhase.EndCall)');
    expect(phone).toContain("NotEquals(current.contactName, StringToName(contact))");
    expect(phone).toContain("private final func SetPhoneFact");
    expect(phone).toContain("questPhoneTalkingState.Rejected");
  });

  test("call-end queue acceptance cannot acknowledge aggregate cleanup (source contract)", () => {
    const end = script.slice(script.indexOf("public static func End(cid: String, contact:"), script.indexOf("// Our message view data"));
    expect(end).toContain('"ended\\":false');
    const release = script.slice(script.indexOf("public static func ReleaseAll(cid:"));
    expect(release).toContain('if !IsDefined(registry) { return XFJson.Fail("not_ready"');
    expect(release).toContain('StrContains(ended, "\\"ended\\":false")');
    expect(release.indexOf("XFDmHud.NotifyHide")).toBeLessThan(release.indexOf('if StrContains(ended,'));
  });

  test("radio idempotence is checked at event consumption, with vanilla events passed through (source contract)", () => {
    const consume = script.slice(script.indexOf("@wrapMethod(VehicleComponent)"), script.indexOf("public abstract class XFDmWorld"));
    expect(consume).toContain("if !evt.xfsDmSetOn { return wrappedMethod(evt); }");
    expect(consume.indexOf("XFBridge_Live()")).toBeLessThan(consume.indexOf("this.m_radioState"));
    expect(consume).toContain("if Equals(evt.toggle, this.m_radioState) { return false; }");
    expect(consume.trim().endsWith("return wrappedMethod(evt);\n}")).toBe(true);
    const queue = script.slice(script.indexOf("public static func Radio("), script.indexOf("public static func AudioTarget("));
    expect(queue).not.toContain("&& !Equals(on == 1, wasOn)");
    expect(queue).toContain("if on >= 0 {");
    expect(queue).toContain("evt.xfsDmSetOn = true");
    expect(queue).toContain("off.xfsDmSetOn = true");
  });

  test("review 12/13/14: tracker completions honour ownership, radio-on is idempotent, completed registry entries are erased", () => {
    expect(script).toContain("OnTrackedMappinSpawned(newItem: ref<inkWidget>, userData: ref<IScriptable>)");
    expect(script).toContain("this.m_trackedMappinSpawnRequest.Cancel()");
    expect(script).toContain("if Equals(evt.toggle, this.m_radioState) { return false; }");
    expect(script).toContain("registry.ForgetEntry(entry.id)");
    expect(script).toContain("registry.ForgetLine(n)");
    expect(script).toContain("ArrayErase(this.m_entries, i)");
    expect(script).toContain("ArrayErase(this.m_lines, i)");
    expect(script).toContain("!system.IsManaged(entry.id) || system.DeleteEntity(entry.id)");
  });

  test("the toolkit's scripts are a separate folder (the -writes package only) and the plugin's calls name functions the script defines", () => {
    expect(readdirSync(join(projectDir, "redscript-dm"))).toEqual(["XFRuntimeBridgeDm.reds"]);
    const handlers = read("native", "src", "plugin", "HandlersDm080.cpp");
    const called = [...handlers.matchAll(/ScriptCall\("(XFDm\w+|XFNpcV)", "(\w+)"/g)].map((m) => [m[1]!, m[2]!]);
    expect(called.length).toBeGreaterThan(20);
    for (const [cls, fn] of called) {
      if (cls === "XFNpcV") continue;
      const classBody = script.slice(script.indexOf(`public abstract class ${cls}`));
      expect(classBody.includes(`public static func ${fn}(`), `${cls}.${fn}`).toBe(true);
    }
  });
});

describe("0.8.12 dm: the write class and its gate", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character"], 120);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await host?.stop();
  }, 30_000);

  test("every dm write is refused write_class_disabled without dm in the list; the reads still answer", async () => {
    const minimal: Record<string, Record<string, unknown>> = {
      "world.spawn": { template: "base\\gameplay\\x\\prop.ent" },
      "world.despawn": { all: true },
      "world.door": { target: "look_at", open: true },
      "vehicle.set": { target: "mounted", engine: true },
      "audio.play": { event: "ui_test" },
      "audio.stop": { all: true },
      "audio.radio": { target: "mounted", on: true },
      "audio.voice": { target: "look_at", context: "greeting" },
      "phone.text": { contact: "Test", text: "hello" },
      "phone.call": { contact: "test_fixer", lines: [{ text: "hello" }] },
      "phone.end": {},
      "quest.set": { id: "q", title: "t" },
      "quest.objective": { quest: "q", objective: "a", state: "done" },
      "quest.clear": { all: true },
      "notify.show": { style: "warning", text: "hello" },
      "notify.hide": {},
      "light.spawn": {},
      "light.set": { id: 1, on: true },
      "light.remove": { all: true },
      "watch.arm": { kind: "weapon" },
      "watch.disarm": { all: true },
    };
    for (const name of DM_NAMES.filter((n) => !DM_READS.includes(n))) {
      expect(minimal[name], `${name} has a minimal input`).toBeDefined();
      expect(await refused(api, name, minimal[name]!), name).toBe("write_class_disabled");
    }
    expect((await ok(api, "world.spawned")).count).toBe(0);
    expect((await ok(api, "watch.list")).count).toBe(0);
    expect((await ok(api, "quest.state")).quests).toEqual([]);
    expect((await ok(api, "phone.state")).call).toBeNull();
    const info = await bridge(api, "bridge.info");
    expect(JSON.stringify(info.write_classes ?? [])).not.toContain("dm");
  }, 30_000);
});

describe("0.8.12 dm against the self-test host's world", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 360);
    api = apiFor(host);
    await reset(api);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    if (process.env.XFB_DM_DEBUG) console.log(host.log.slice(-60).join("\n"), "exit", host.child.exitCode);
    await host?.stop();
  }, 30_000);

  test("props and vehicles: placed from V's facing, handled by spawn:<n>, never saved, undone, limited to 24", async () => {
    const since = await latest(api);
    const box = await ok(api, "world.spawn", { template: "base\\gameplay\\x\\prop.ent", offset: { forward: 3, right: 1 }, label: "box" });
    expect(box).toMatchObject({ handle: 1, target: "spawn:1", kind: "prop", label: "box", grounded: true });
    expect(box.position[0]).toBeCloseTo(101, 3);
    expect(box.position[1]).toBeCloseTo(203, 3);
    const car = await ok(api, "world.spawn", { kind: "vehicle", record: "Vehicle.v_test", at: [110, 210, 10], face_v: true });
    expect(car.handle).toBe(2);
    expect(car.yaw).toBeCloseTo(135, 3);
    const list = await ok(api, "world.spawned");
    expect(list.spawned.map((s: Any) => s.target)).toEqual(["spawn:1", "spawn:2"]);
    expect(list.spawned.every((s: Any) => s.present)).toBe(true);
    // Never saved: a save waits until they are gone, even with the bridge's lock overridden.
    const save = await api.run("game.save", { override_lock: true });
    expect(save.ok ? "" : `${save.error.code} ${save.error.message}`).toContain("bridge_effects_active");
    await event(api, "dm.world", since, (e) => e.data?.what === "spawned" && e.data?.handle === 2);
    expect(await refused(api, "world.spawn", { template: "base\\x_missing.ent" })).toBe("template_missing");
    expect(await refused(api, "world.spawn", { record: "Nope.thing" })).toBe("record_missing");
    expect(await refused(api, "world.spawn", { template: "base\\x.ent", at: [500, 500, 10] })).toBe("too_far");
    await world(api, { codeware: false });
    expect(await refused(api, "world.spawn", { template: "base\\x.ent" })).toBe("codeware_missing");
    await world(api, { codeware: true });
    const gone = await ok(api, "world.despawn", { id: 1 });
    expect(gone.undo.method).toBe("world.spawn");
    expect(await refused(api, "world.despawn", { id: 1 })).toBe("target_unknown");
    const back = await ok(api, gone.undo.method, gone.undo.params);
    expect(back.kind).toBe("prop");
    const all = await ok(api, "world.despawn", { all: true });
    expect(all.removed).toBe(2);
    expect((await ok(api, "world.spawned")).count).toBe(0);
    expect((await ok(api, "game.save", { override_lock: true })).saved).toBe(true);
    for (let i = 0; i < 24; i++) await ok(api, "world.spawn", { template: "base\\x.ent" });
    expect(await refused(api, "world.spawn", { template: "base\\x.ent" })).toBe("limit");
    await ok(api, "world.despawn", { all: true });
  }, 60_000);

  test("the world's phase and the player gate every spawn", async () => {
    await bridge(api, "selftest.phase", { phase: "main_menu" });
    expect(await refused(api, "world.spawn", { template: "base\\x.ent" })).toBe("not_in_world");
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    await bridge(api, "selftest.player", { busy: "not_v" });
    expect(await refused(api, "world.spawn", { template: "base\\x.ent" })).toBe("not_v");
    await bridge(api, "selftest.player", { busy: "in_combat" });
    expect((await ok(api, "world.spawn", { template: "base\\x.ent" })).handle).toBeGreaterThan(0);
    await ok(api, "world.despawn", { all: true });
    await bridge(api, "selftest.player", { busy: "" });
  }, 30_000);

  test("doors: opened, locked, sealed and put back, by look_at, entity id or spawn handle; held until put back", async () => {
    expect(await refused(api, "world.door", { target: "look_at", open: true })).toBe("target_missing");
    await world(api, { look_at: "EntityID(8102)" });
    const opened = await ok(api, "world.door", { target: "look_at", open: true });
    expect(opened).toMatchObject({ target_id: "EntityID(8102)", before: { open: false, locked: true }, after: { open: true, locked: false } });
    expect(opened.undo.params).toMatchObject({ open: false, locked: true });
    expect(((await world(api)).doors as Any)["EntityID(8102)"]).toMatchObject({ open: true, locked: false });
    const save = await api.run("game.save", { override_lock: true });
    expect(save.ok ? "" : save.error.code).toBe("bridge_effects_active");
    const undone = await ok(api, opened.undo.method, opened.undo.params);
    expect(undone.after).toMatchObject({ open: false, locked: true });
    expect(await refused(api, "world.door", { target: "EntityID(777)", open: true })).toBe("not_a_door");
    expect(await refused(api, "world.door", { target: "look_at", open: true, locked: true })).toBe("bad_params");
    // Undone by hand it holds nothing: the bridge knows the door is as it was, and the save goes ahead.
    expect((await ok(api, "game.save", { override_lock: true })).saved).toBe(true);
    await ok(api, "world.door", { target: "EntityID(8101)", sealed: true });
    const heldAgain = await api.run("game.save", { override_lock: true });
    expect(heldAgain.ok ? "" : heldAgain.error.code).toBe("bridge_effects_active");
    await ok(api, "world.door", { target: "EntityID(8101)", sealed: false });
    expect((await ok(api, "game.save", { override_lock: true })).saved).toBe(true);
    await world(api, { look_at: "" });
  }, 30_000);

  test("vehicles and radios: engine, lights, doors and a station by name, with undos", async () => {
    expect(await refused(api, "vehicle.set", { target: "mounted", engine: true })).toBe("target_missing");
    await world(api, { mounted: true });
    const set = await ok(api, "vehicle.set", { target: "mounted", engine: true, lights: true, door: "trunk", door_state: "open" });
    expect(set.target_id).toBe("EntityID(8201)");
    expect(set.undo.params).toMatchObject({ engine: false, lights: false, door: "trunk", door_state: "closed" });
    expect(((await world(api)).vehicles as Any)["EntityID(8201)"]).toMatchObject({ engine: true, lights: true, doors: { trunk: "open" } });
    await ok(api, set.undo.method, set.undo.params);
    expect(((await world(api)).vehicles as Any)["EntityID(8201)"]).toMatchObject({ engine: false, lights: false, doors: { trunk: "closed" } });
    const radio = await ok(api, "audio.radio", { target: "mounted", station: "jazz" });
    expect(radio.before).toMatchObject({ station: 4, on: false });
    expect(((await world(api)).vehicles as Any)["EntityID(8201)"]).toMatchObject({ radio_on: true, station: 10 });
    await ok(api, radio.undo.method, radio.undo.params);
    expect(((await world(api)).vehicles as Any)["EntityID(8201)"]).toMatchObject({ radio_on: false, station: 4 });
    expect(await refused(api, "audio.radio", { target: "mounted", station: 14 })).toBe("bad_input");
    expect(await refused(api, "audio.radio", { target: "EntityID(8101)", on: true })).toBe("no_radio");
    expect(await refused(api, "vehicle.set", { target: "EntityID(8101)", engine: true })).toBe("not_a_vehicle");
    await world(api, { mounted: false });
    // Everything undone by hand: nothing is held, and a save goes ahead.
    expect((await ok(api, "game.save", { override_lock: true })).saved).toBe(true);
  }, 30_000);

  test("sound and voice: tracked ids, a looped sound until stopped, a voice line only from someone with a voice", async () => {
    const a = await ok(api, "audio.play", { event: "ui_test_sound", loop: true });
    const b = await ok(api, "audio.play", { event: "ui_test_other", on: "global" });
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(a.undo.method).toBe("audio.stop");
    expect(((await world(api)).sounds as Any[]).map((s) => s.event)).toEqual(["ui_test_sound", "ui_test_other"]);
    expect((await ok(api, "audio.stop", { id: 1 })).stopped).toBe(1);
    expect(((await world(api)).sounds as Any[])[0].stopped).toBe(true);
    expect(await refused(api, "audio.stop", { id: 1 })).toBe("not_found");
    expect((await ok(api, "audio.stop", { all: true })).tracked).toBe(1);
    expect(await refused(api, "audio.voice", { target: "look_at", context: "greeting" })).toBe("target_missing");
    await world(api, { look_at: "EntityID(9001)" });
    expect(await ok(api, "audio.voice", { target: "look_at", context: "greeting" })).toMatchObject({ target_id: "EntityID(9001)", context: "greeting" });
    await world(api, { look_at: "EntityID(8101)" });
    expect(await refused(api, "audio.voice", { target: "look_at", context: "greeting" })).toBe("not_an_npc");
    await world(api, { look_at: "" });
  }, 30_000);

  test("the phone: a toast, the contacts the player has, and a real call from one of them answered, with its lines", async () => {
    await ok(api, "phone.text", { contact: "Test Sender", text: "Meet me at the usual place." });
    expect(((await world(api)).toasts as string[])[0]).toBe("Test Sender: Meet me at the usual place.");
    const state = await ok(api, "phone.state", { contacts: true });
    expect(state.contacts.contacts.map((c: Any) => c.id)).toEqual(["test_fixer", "test_friend"]);
    expect(state.messages[0].text).toBe("Meet me at the usual place.");
    expect(await refused(api, "phone.call", { contact: "stranger", lines: [{ text: "Hello." }] })).toBe("contact_unknown");
    await world(api, { calling: false });
    expect(await refused(api, "phone.call", { contact: "test_fixer", lines: [{ text: "Hello." }] })).toBe("phone_blocked");
    await world(api, { calling: true });
    const since = await latest(api);
    const call = await ok(api, "phone.call", { contact: "test_fixer", ring_s: 30, lines: [{ text: "First line.", seconds: 1.5 }, { text: "Second line.", speaker: "Fixer", seconds: 1.5 }] });
    expect(call).toMatchObject({ state: "ringing", contact: "test_fixer", mode: "audio" });
    expect(await refused(api, "phone.call", { contact: "test_friend", lines: [{ text: "x" }] })).toBe("busy");
    expect(((await world(api)).call as Any)).toMatchObject({ state: "ringing", fact: 1, rings: 1 });
    // The player answers: the game's fact reads talking.
    await world(api, { call_fact: 2 });
    await event(api, "dm.phone", since, (e) => e.data?.what === "answered");
    expect(((await world(api)).call as Any).starts).toBe(1);
    await until(async () => Object.keys(((await world(api)).lines as Any)).length > 0);
    const lines = Object.values((await world(api)).lines as Any) as string[];
    expect(lines[0]).toMatch(/^2\|test_fixer\|First line\.$/); // the holocall style, the contact's id as the speaker
    await event(api, "dm.phone", since, (e) => e.data?.what === "ended", 12000);
    expect(((await world(api)).call as Any).state).toBe("ended");
    expect((await ok(api, "phone.state")).call.state).toBe("ended");
  }, 40_000);

  test("a call declined, missed by the game's own timeout and ended by phone_end", async () => {
    let since = await latest(api);
    await ok(api, "phone.call", { contact: "test_friend", ring_s: 30, lines: [{ text: "Pick up." }] });
    await sleep(500); // the session sees the ring (fact 1) first
    await world(api, { call_fact: 3 });
    await event(api, "dm.phone", since, (e) => e.data?.what === "declined");
    since = await latest(api);
    await ok(api, "phone.call", { contact: "test_friend", ring_s: 30, lines: [{ text: "Pick up." }] });
    await sleep(500);
    await world(api, { call_fact: 0 });
    const missed = await event(api, "dm.phone", since, (e) => e.data?.what === "missed");
    expect(missed.data.by).toContain("timeout");
    since = await latest(api);
    const call = await ok(api, "phone.call", { contact: "test_fixer", lines: [{ text: "Hello." }] });
    const ended = await ok(api, call.undo.method, call.undo.params);
    expect(ended).toMatchObject({ ended: true, was: "ringing" });
    expect((await ok(api, "phone.end")).ended).toBe(false);
    expect(((await world(api)).call as Any).state).toBe("ended");
    expect(await refused(api, "phone.call", { contact: "test_fixer", lines: [] })).toBe("bad_input");
  }, 30_000);

  test("the quest tracker: an XF quest, its objectives, the toasts, a HUD that isn't up, an area that completes an objective", async () => {
    await world(api, { hud: true });
    const set = await ok(api, "quest.set", {
      id: "q1",
      title: "Find the box",
      notify: "new",
      objectives: [{ id: "a", text: "Look for the box" }, { id: "b", text: "Open it", optional: true }],
    });
    expect(set.tracker.drawn).toBe(true);
    expect(set.notified).toBe("quest_new");
    expect(((await world(api)).tracker as string).split("\n")).toEqual(["Find the box", "active\t-\tLook for the box", "active\to\tOpen it"]);
    expect(((await world(api)).banners as Any[]).at(-1)).toMatchObject({ style: "quest_new", text: "Find the box" });
    const done = await ok(api, "quest.objective", { quest: "q1", objective: "a", state: "done" });
    expect(done).toMatchObject({ state: "done", quest_complete: true, notified: "quest_done" });
    // A finished objective is drawn once with its tick; the next drawing leaves it out.
    expect(((await world(api)).tracker as string).split("\n")).toEqual(["Find the box", "done\t-\tLook for the box", "active\to\tOpen it"]);
    await ok(api, "quest.objective", { quest: "q1", objective: "b", text: "Open the box", notify: false });
    expect(((await world(api)).tracker as string).split("\n")).toEqual(["Find the box", "active\to\tOpen the box"]);
    expect((await ok(api, "quest.state")).quests[0].objectives.map((o: Any) => o.state)).toEqual(["done", "active"]);
    expect(await refused(api, "quest.objective", { quest: "nope", objective: "a", state: "done" })).toBe("not_found");
    const undo = await ok(api, "quest.objective", { quest: "q1", objective: "a", state: "active", notify: false });
    expect(undo.before.state).toBe("done");
    // The HUD not up: the quest is kept and the answer says it wasn't drawn.
    await world(api, { hud: false });
    const hidden = await ok(api, "quest.set", { id: "q2", title: "Second quest" });
    expect(hidden.tracker).toMatchObject({ drawn: false });
    expect(hidden.tracker.why).toContain("HUD");
    await world(api, { hud: true });
    const cleared = await ok(api, "quest.clear", { id: "q2" });
    expect(cleared.undo.method).toBe("quest.set");
    expect(await refused(api, "quest.clear", {})).toBe("bad_params");
    // An area with complete_on_enter: V walks in and the watcher's micro-action completes the objective, through the dispatcher.
    await ok(api, "quest.clear", { all: true });
    const since = await latest(api);
    await ok(api, "quest.set", {
      id: "q3",
      title: "Reach the spot",
      objectives: [{ id: "spot", text: "Go to the marked place", area: { at: [140, 200, 10], radius_m: 4, complete_on_enter: true } }],
    });
    expect((await ok(api, "watch.list")).watchers[0].id).toBe("quest.q3.spot");
    await bridge(api, "selftest.player", { position: [140, 201, 10] });
    await event(api, "dm.watch", since, (e) => e.data?.watch === "quest.q3.spot" && e.data?.actions !== undefined);
    await until(async () => (await ok(api, "quest.state")).quests[0].objectives[0].state === "done");
    const micro = await event(api, "dm.micro", since, (e) => e.data?.method === "quest.objective");
    expect(micro.data.ok).toBe(true);
    await bridge(api, "selftest.player", { position: [100, 200, 10] });
    await ok(api, "quest.clear", { all: true });
    expect(((await world(api)).tracker as string)).toBe("");
  }, 60_000);

  test("messages the game's way: banners, centred messages, quest toasts, timed subtitle lines, taken down", async () => {
    const warn = await ok(api, "notify.show", { style: "warning", text: "Check the street." });
    expect(warn.undo.method).toBe("notify.hide");
    await ok(api, "notify.show", { style: "onscreen", text: "Later that night", seconds: 3 });
    const toast = await ok(api, "notify.show", { style: "quest_update", text: "Updated", title: "News" });
    expect(toast.undo).toBeNull();
    expect(((await world(api)).banners as Any[]).slice(-3).map((b) => b.style)).toEqual(["warning", "onscreen", "quest_update"]);
    const sub = await ok(api, "notify.show", { style: "subtitle", speaker: "Narrator", text: "It begins.", seconds: 1.5 });
    expect(sub.line).toBeGreaterThan(0);
    await until(async () => Object.values((await world(api)).lines as Any).some((l) => String(l).includes("Narrator|It begins.")));
    await until(async () => Object.keys((await world(api)).lines as Any).length === 0, 6000);
    expect(await refused(api, "notify.show", { style: "subtitle", text: "x" })).toBe("bad_params");
    expect(await refused(api, "notify.show", { style: "popup", text: "x" })).toBe("bad_input");
    await world(api, { hud: false });
    expect(await refused(api, "notify.show", { style: "warning", text: "x" })).toBe("hud_missing");
    await world(api, { hud: true });
    await ok(api, "notify.show", { style: "subtitle", speaker: "S", text: "Staying", seconds: 20 });
    await until(async () => Object.keys((await world(api)).lines as Any).length === 1);
    await ok(api, "notify.hide", {});
    await until(async () => Object.keys((await world(api)).lines as Any).length === 0);
    expect((await world(api)).banners_hidden).toBeGreaterThan(0);
  }, 40_000);

  test("lights: no carrier yet, a template with a light component, steering, the engine's flicker, a pattern the tick drives, removal", async () => {
    expect(await refused(api, "light.spawn", {})).toBe("carrier_missing");
    expect(await refused(api, "light.spawn", { template: "base\\x_missing.ent" })).toBe("template_missing");
    await world(api, { carrier: true });
    const carrier = await ok(api, "light.spawn", { colour: "#ff8800", intensity: 40, radius: 6, offset: { forward: 2, up: 2 } });
    expect(carrier.pending).toBe(true);
    await ok(api, "light.remove", { id: carrier.handle });
    await world(api, { carrier: false });
    const lamp = await ok(api, "light.spawn", { template: "base\\gameplay\\devices\\lamp_01.ent", colour: [255, 200, 120], intensity: 50, inner: 15, outer: 40, pattern: { kind: "flicker", strength: 0.3 }, label: "lamp" });
    expect(lamp).toMatchObject({ kind: "light", pending: true, label: "lamp" });
    await until(async () => (await ok(api, "world.spawned")).spawned.find((e: Any) => e.handle === lamp.handle)?.pending === false);
    let entity = ((await world(api)).entities as Any[]).find((e) => e.id === lamp.entity);
    expect(entity.light).toMatchObject({ colour: [255, 200, 120], intensity: 50, radius: 8, inner: 15, outer: 40, flicker: 0.3 });
    const set = await ok(api, "light.set", { id: lamp.handle, intensity: 20, colour: "#00ff00", pattern: "pulse" });
    expect(set.before).toMatchObject({ intensity: 50 });
    expect(set.undo.params).toMatchObject({ intensity: 50 });
    await until(async () => (((await world(api)).entities as Any[]).find((e) => e.id === lamp.entity).light.intensity_calls ?? 0) >= 5);
    entity = ((await world(api)).entities as Any[]).find((e) => e.id === lamp.entity);
    expect(entity.light.colour).toEqual([0, 255, 0]);
    expect(entity.light.flicker).toBe(0); // the engine's flicker went out when the pulse took over
    expect(entity.light.last_intensity).toBeLessThanOrEqual(20 + 1e-6);
    await ok(api, set.undo.method, set.undo.params);
    const off = await ok(api, "light.set", { id: lamp.handle, on: false });
    expect(off.light.on).toBe(false);
    // A lamp from world_spawn is steered the same way; a prop without a light component is refused.
    const prop = await ok(api, "world.spawn", { template: "base\\gameplay\\devices\\lamp_prop.ent" });
    await ok(api, "light.set", { id: prop.handle, intensity: 10 });
    const plain = await ok(api, "world.spawn", { template: "base\\gameplay\\x\\crate.ent" });
    expect(await refused(api, "light.set", { id: plain.handle, intensity: 10 })).toBe("no_light_component");
    expect(await refused(api, "light.set", { id: 99, intensity: 10 })).toBe("target_unknown");
    expect(await refused(api, "world.despawn", { id: lamp.handle })).toBe("use_light_remove");
    const removed = await ok(api, "light.remove", { id: lamp.handle });
    expect(removed.undo.method).toBe("light.spawn");
    expect(removed.undo.params).toMatchObject({ template: "base\\gameplay\\devices\\lamp_01.ent", inner: 15, outer: 40 });
    expect(await refused(api, "light.remove", { id: lamp.handle })).toBe("target_unknown");
    await ok(api, "world.despawn", { all: true });
    for (let i = 0; i < 8; i++) await ok(api, "light.spawn", { template: "base\\gameplay\\devices\\lamp_01.ent" });
    expect(await refused(api, "light.spawn", { template: "base\\gameplay\\devices\\lamp_01.ent" })).toBe("limit");
    await ok(api, "light.remove", { all: true });
  }, 40_000);

  test("watchers: edges, their micro-actions through the dispatcher's own gates, cooldown, disarm, limits", async () => {
    let since = await latest(api);
    await ok(api, "watch.arm", {
      id: "armed",
      kind: "weapon",
      edge: "on",
      now: false,
      actions: [{ method: "notify.show", params: { style: "warning", text: "Weapon out" } }, { method: "audio.play", params: { event: "ui_weapon_alert" }, delay_s: 0.2 }],
    });
    expect((await ok(api, "watch.list")).count).toBe(1);
    await world(api, { weapon: true });
    const fired = await event(api, "dm.watch", since, (e) => e.data?.watch === "armed" && e.data?.actions !== undefined);
    expect(fired.data.actions).toBe(2);
    const first = await event(api, "dm.micro", since, (e) => e.data?.method === "notify.show");
    expect(first.data).toMatchObject({ ok: true, watch: "armed", index: 0 });
    const second = await event(api, "dm.micro", since, (e) => e.data?.method === "audio.play");
    expect(second.data).toMatchObject({ ok: true, index: 1 });
    expect(((await world(api)).banners as Any[]).at(-1)).toMatchObject({ style: "warning", text: "Weapon out" });
    expect(((await world(api)).sounds as Any[]).some((s) => s.event === "ui_weapon_alert")).toBe(true);
    expect((await ok(api, "watch.list")).count).toBe(0); // not repeating: gone after it fired
    await ok(api, "audio.stop", { all: true });
    await world(api, { weapon: false });

    // Refusals: a method the watcher may not run, an unknown one, a class a watcher may not use.
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "game.save" }] })).toBe("bad_params");
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "Notify.Show" }] })).toBe("bad_input");
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "no.such.method" }] })).toBe("bad_params");
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "game.digest" }, { method: "watch.arm", params: { kind: "weapon", actions: [{ method: "notify.hide" }] } }] })).toBe("bad_params");
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "inventory.equip" }] })).toBe("bad_params");
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "game.load" }] })).toBe("bad_params");
    expect(await refused(api, "watch.arm", { kind: "weapon", actions: [{ method: "bridge.kill" }] })).toBe("bad_params");

    // A micro-action refused at run time (a spawn that fails) is reported and does not stop the next one.
    since = await latest(api);
    await ok(api, "watch.arm", {
      id: "mixed",
      kind: "combat",
      edge: "on",
      now: false,
      actions: [{ method: "world.spawn", params: { template: "base\\x_missing.ent" } }, { method: "notify.show", params: { style: "onscreen", text: "Still ran" } }],
    });
    await world(api, { combat: true });
    const refusedRun = await event(api, "dm.micro", since, (e) => e.data?.method === "world.spawn");
    expect(refusedRun.data).toMatchObject({ ok: false, code: "template_missing" });
    await event(api, "dm.micro", since, (e) => e.data?.method === "notify.show" && e.data?.ok === true);
    await world(api, { combat: false });

    // A repeating enter watcher keeps its cooldown; disarm drops it.
    since = await latest(api);
    await ok(api, "watch.arm", { id: "near", kind: "enter", at: [100, 202, 10], radius_m: 3, repeat: true, cooldown_s: 0.5, now: true, actions: [{ method: "notify.show", params: { style: "onscreen", text: "Near" } }] });
    await event(api, "dm.watch", since, (e) => e.data?.watch === "near" && e.data?.actions !== undefined);
    expect((await ok(api, "watch.list")).watchers[0]).toMatchObject({ id: "near", repeat: true });
    const gone = await ok(api, "watch.disarm", { id: "near" });
    expect(gone.disarmed).toBe(1);
    expect((await ok(api, "watch.disarm", { id: "near" })).disarmed).toBe(0);
    for (let i = 0; i < 16; i++) await ok(api, "watch.arm", { id: `w${i}`, kind: "weapon" });
    expect(await refused(api, "watch.arm", { id: "extra", kind: "weapon" })).toBe("too_many");
    expect((await ok(api, "watch.disarm", { all: true })).disarmed).toBe(16);
  }, 60_000);

  test("watchers on events and on what V looks at: gaze, interact and choice", async () => {
    const since = await latest(api);
    const crate = await ok(api, "world.spawn", { template: "base\\x.ent", at: [100, 210, 10] });
    await ok(api, "watch.arm", { id: "gaze", kind: "gaze", target: crate.target, look_at: true, seconds: 0.4 });
    await ok(api, "watch.arm", { id: "use", kind: "interact", caption: "open" });
    await ok(api, "watch.arm", { id: "pick", kind: "choice", index: 1 });
    await world(api, { look_at: crate.entity });
    const gaze = await event(api, "dm.watch", since, (e) => e.data?.watch === "gaze" && e.data?.actions !== undefined);
    expect(gaze.data.detail.dwell_s).toBeGreaterThanOrEqual(0.4);
    await world(api, { event: { type: "interact", caption: "Open door", target: "EntityID(8101)", success: true } });
    await event(api, "dm.watch", since, (e) => e.data?.watch === "use" && e.data?.actions !== undefined);
    await world(api, { event: { type: "choice", index: 0, caption: "No" } });
    await sleep(400);
    expect((await ok(api, "watch.list")).watchers.map((w: Any) => w.id)).toEqual(["pick"]);
    await world(api, { event: { type: "choice", index: 1, caption: "Yes" } });
    await event(api, "dm.watch", since, (e) => e.data?.watch === "pick" && e.data?.actions !== undefined);
    await world(api, { look_at: "" });
    await ok(api, "world.despawn", { all: true });
  }, 30_000);

  test("the digest: V, the world, what the bridge placed and changed, the watchers, the quests, the phone, the recent events", async () => {
    await ok(api, "world.spawn", { template: "base\\x.ent", label: "marker" });
    await ok(api, "world.door", { target: "EntityID(8101)", open: true });
    await ok(api, "quest.set", { id: "qd", title: "Digest quest", objectives: [{ id: "x", text: "Do x" }] });
    await ok(api, "watch.arm", { id: "dw", kind: "timer", seconds: 30 });
    const digest = await ok(api, "game.digest", { events: 6, kinds: ["dm.world", "dm.quest"] });
    expect(digest.v.vitals.health_percent).toBe(62);
    expect(digest.v.hp_band).toBeUndefined(); // the band is the agent's to read from the percentage
    expect(digest.placed.map((p: Any) => p.label)).toEqual(["marker"]);
    expect(digest.changed).toEqual([{ kind: "door", target: "EntityID(8101)" }]);
    expect(digest.quests[0]).toMatchObject({ id: "qd", objectives: { x: "active" } });
    expect(digest.watchers[0]).toMatchObject({ id: "dw", kind: "timer" });
    expect(digest.events.length).toBeGreaterThanOrEqual(2);
    expect(digest.events.every((e: Any) => ["dm.world", "dm.quest"].includes(e.kind))).toBe(true);
    expect((await ok(api, "game.digest", { events: 0, sky: false })).events).toEqual([]);
    expect(await refused(api, "game.digest", { events: 40 })).toBe("bad_input");
    await ok(api, "world.door", { target: "EntityID(8101)", open: false });
    await reset(api);
  }, 30_000);

  test("the pause releases everything the toolkit holds: doors back, props gone, the call ended, lines and the tracker down", async () => {
    const since = await latest(api);
    await ok(api, "world.spawn", { template: "base\\x.ent" });
    await ok(api, "world.door", { target: "EntityID(8102)", open: true });
    await ok(api, "quest.set", { id: "qp", title: "Paused quest" });
    await ok(api, "phone.call", { contact: "test_fixer", lines: [{ text: "x" }] });
    await ok(api, "audio.play", { event: "pause_loop", loop: true });
    await ok(api, "phone.text", { contact: "XF", text: "queued" });
    await ok(api, "notify.show", { style: "quest_new", text: "queued" });
    await bridge(api, "selftest.pause_writes", { paused: true });
    const released = await event(api, "dm.released", since, (e) => e.data?.reason === "paused");
    expect(released.data.auto).toBe(true);
    const snapshot = await world(api);
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.doors["EntityID(8102)"]).toMatchObject({ open: false, locked: true });
    expect(snapshot.tracker).toBe("");
    expect(snapshot.call.state).toBe("ended");
    expect(snapshot.sounds.find((s: Any) => s.event === "pause_loop").stopped).toBe(true);
    expect(snapshot.banners).toEqual([]);
    expect(snapshot.toasts).toEqual([]);
    expect(snapshot.released_all).toBeGreaterThan(0);
    expect(await refused(api, "world.spawn", { template: "base\\x.ent" })).toBe("writes_paused");
    await bridge(api, "selftest.pause_writes", { paused: false });
    expect((await ok(api, "world.spawned")).count).toBe(0);
    await reset(api);
  }, 30_000);

  test("a handover releases everything in its own request and says so", async () => {
    const since = await latest(api);
    await ok(api, "world.spawn", { template: "base\\x.ent" });
    await ok(api, "world.door", { target: "EntityID(8102)", open: true });
    const handed = await ok(api, "session.handover", { note: "the player takes over" });
    const step = (handed.steps as Any[]).find((s) => s.step.includes("live-direction toolkit"));
    // The game thread's own safety net may get there first (it also releases when the gate closes); either way it is released at once.
    expect(step).toMatchObject({ ok: true });
    expect((await world(api)).entities).toEqual([]);
    const read = await bridge(api, "session.events", { since, limit: 100, kinds: ["dm.released"] });
    expect((read.events as Any[]).some((e) => e.data?.reason === "handover")).toBe(true);
    expect((await world(api)).doors["EntityID(8102)"]).toMatchObject({ open: false, locked: true });
    expect(await refused(api, "world.spawn", { template: "base\\x.ent" })).toBe("handed_over");
    await ok(api, "session.resume", {});
    expect((await ok(api, "world.spawned")).count).toBe(0);
  }, 30_000);

  test("a load forgets everything without a game call", async () => {
    const since = await latest(api);
    await ok(api, "world.spawn", { template: "base\\x.ent" });
    await ok(api, "quest.set", { id: "ql", title: "Loaded quest" });
    const before = (await world(api)).released_all;
    await ok(api, "game.load", { latest: true, discard_unsaved: true });
    const dropped = await event(api, "dm.released", since, (e) => e.data?.reason === "session_detached", 10000);
    expect(dropped.level).toBe("info");
    for (let i = 0; i < 100; i++) {
      const status = await api.run("game.status", {});
      if (status.ok && (status.result as Any).phase === "gameplay") break;
      await sleep(100);
    }
    expect((await ok(api, "world.spawned")).count).toBe(0);
    expect((await ok(api, "quest.state")).quests).toEqual([]);
    expect((await world(api)).released_all).toBe(before); // forgotten, not released through the game
  }, 30_000);

  test("the kill switch releases everything in one step (last: it ends the host's bridge)", async () => {
    await reset(api);
    await ok(api, "world.spawn", { template: "base\\x.ent" });
    await ok(api, "world.door", { target: "EntityID(8102)", open: true });
    await ok(api, "bridge.kill", {});
    for (let i = 0; i < 80 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await sleep(50);
    const line = host.log.find((l) => l.includes("bridge.kill_restored")) ?? "";
    expect(line).toContain("dm_released");
    expect(line).toContain("spawned_removed");
  }, 30_000);
});
