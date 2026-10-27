import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BridgeClient } from "../bridge-lib.ts";
import { packageScripts } from "../redscript-natives.ts";
import { CommandApi } from "../api/command-api.ts";
import { recordingClock, replayRecording } from "../testing/recording-replay.ts";
import { requireAutonomousSelftest, startSelftestHost, sleep } from "./helpers.ts";
const kinds = ["session", "death", "combat", "heat", "dialogue", "journal", "fact", "call"];
const bodies: Record<string, any> = {
  session: { phase: "start", codeware: true, restored: true, pre_game: false },
  death: { what: "death", victim: "18446744073709551615", record: "Character.fixture", crowd: false, civilian: false, by_v: true, instigator: "42", pos: [1, 2, 3], incident_id: "inc-7" },
  combat: { state: 1 }, heat: { fact: "wanted_level", value: 2 },
  dialogue: { what: "hubs", partner: null, partner_available: false, count: 1, hubs: [{ id: 7, state: 1, count: 1, choices: [{ index: 0, text: "Fixture choice", truncated: false }], truncated: false }], truncated: false },
  journal: { what: "counter", hash: 17, path: "xf/quest/objective", path_complete: true, state: 1, counter: 2 },
  fact: { fact: "q000_street_kid_background", value: 1 },
  call: { phase: "IncomingCall", contact: "judy", mode: 1, player_calling: false, player_triggered: true },
};
test("passive event families reach a read-only client, catchup and native replay", async () => {
  requireAutonomousSelftest();
  const host = await startSelftestHost(["--allow-test-hooks", "--allow-writes"]);
  const writer = new BridgeClient(host.session, 5000), reader = new BridgeClient(host.session, 5000);
  const api = new CommandApi({ runtimeDir: host.dir, readOnly: true, auditDir: join(host.dir, "audit") });
  try {
    await writer.connect(); await reader.connect({ readOnly: true });
    const start = await writer.call("test.record.start", { channels: ["events"], duration_s: 5 });
    expect(start.ok).toBe(true);
    const run = (start.result as any).run, source: any[] = [];
    for (const kind of kinds) {
      const r = await writer.call("selftest.world.event", { kind, data: { ...bodies[kind], game_time_s: kind === "session" ? null : 120 } });
      expect(r.ok).toBe(true); source.push(r.result);
    }
    const page = await reader.call("world.events", { limit: 100 });
    expect(page.ok).toBe(true);
    const rows = (page.result as any).events;
    expect(rows.map((r: any) => r.kind)).toEqual(kinds);
    expect(rows.every((r: any) => Number.isFinite(r.s) && r.world_generation >= 0 && r.session_counter === 1)).toBe(true);
    expect(rows[0].game_time_s).toBeNull();
    const filtered = await api.run("world.events", { kinds: ["call"], since: 1 });
    expect(filtered.ok).toBe(true); if (!filtered.ok) throw new Error(filtered.error.message);
    expect((filtered.result as any).events.map((r: any) => r.kind)).toEqual(["call"]);
    expect((await reader.call("selftest.world.event", { kind: "death" })).ok).toBe(false);
    const caught = await api.run("game.catchup", { run, detail: true });
    expect(caught.ok).toBe(true); if (!caught.ok) throw new Error(caught.error.message);
    expect((caught.result as any).channels.events.filter((r: any) => r.event !== "world.coverage").map((r: any) => r.kind)).toEqual(kinds);
    expect((await writer.call("test.record.stop")).ok).toBe(true);
    let status: any;
    for (let i = 0; i < 100; ++i) {
      const r = await reader.call("test.record.read", { run }); expect(r.ok).toBe(true); status = r.result;
      if (!status.writer_pending) break;
      await sleep(20);
    }
    expect(status.writer_pending).toBe(false);
    const manifest = JSON.parse(readFileSync(join(status.output, "manifest.json"), "utf8"));
    const replay = replayRecording(status, 0, status.latest, {});
    expect(replay.gap).toBe(false);
    const events = replay.rows.filter((r: any) => r.channel === "events" && r.data.kind);
    expect(events.map((r: any) => r.data.kind)).toEqual(kinds);
    expect(events.map((r: any) => r.data.s)).toEqual(source.map((r: any) => r.s));
    expect(events.map((r: any) => r.data.data)).toEqual(kinds.map(kind => ({ ...bodies[kind], simulated: true })));
    const clock = recordingClock(manifest);
    expect(clock.fromWallTime(clock.toWallTime(events[0]!.source_s))).toBeCloseTo(events[0]!.source_s, 3);
  } finally { api.close(); writer.close(); reader.close(); await host.stop(); }
}, 15000);
test("shared producer signatures and fact subscriptions match the source contract", () => {
  const root = resolve(import.meta.dir, "../..");
  const source = readFileSync(join(root, "redscript/XFRuntimeBridgeWorldEvents.reds"), "utf8");
  const facts = JSON.parse(readFileSync(resolve(root, "../../research/story-engine/main-story-facts.json"), "utf8")).facts;
  for (const fact of facts) {
    expect(source).toContain(`RegisterListener(n"${fact.name}"`);
    expect(source).toContain(`UnregisterListener(n"${fact.name}"`);
  }
  expect(source).toContain("protected func UpdateDialogsData(const data: script_ref<DialogChoiceHubs>) -> Void");
  expect(source).not.toContain("DelayCallback");
  expect(source).toContain("private func Hub(const hub: script_ref<ListChoiceHubData>) -> String");
  expect(source).toContain("this.Hub(Deref(data).choiceHubs[i])");
  expect(source).not.toMatch(/let\s+\w+\s*=\s*Deref\(data\)\.choiceHubs\[i\];/);
  expect(source).not.toMatch(/let\s+\w+\s*=\s*Deref\(hub\)\.choices(?:;|\[j\];)/);
  expect(source).toContain("while j < count && j < 4");
  const files = ["redscript/XFRuntimeBridgeWorldHooks.reds", "redscript-probes/XFRuntimeBridgeProbeEvents.reds", "redscript-probes/autonomous/XFRuntimeBridgeIncidents.reds"].map(f => readFileSync(join(root, f), "utf8")).join("\n");
  expect(files.match(/cb func OnDeath\(/g)).toHaveLength(1);
  expect(files.match(/cb func OnDefeated\(/g)).toHaveLength(1);
});

test("journal commissioning action is gated, act-only, and produces a tracked receipt", async () => {
  requireAutonomousSelftest();
  for (const scenario of [
    { args: ["--allow-writes", "--write-classes", "act"], allowed: false },
    { args: ["--allow-test-hooks", "--allow-writes", "--write-classes", "dm"], allowed: false },
    { args: ["--allow-test-hooks", "--allow-writes", "--write-classes", "act"], allowed: true },
  ]) {
    const host = await startSelftestHost(scenario.args);
    const writer = new BridgeClient(host.session, 5000), reader = new BridgeClient(host.session, 5000);
    const api = new CommandApi({ runtimeDir: host.dir, auditDir: join(host.dir, "audit"), transport: async () => ({ call: (method, params, cid, timeoutMs, claims) => writer.call(method, params, cid, claims, timeoutMs), close: () => {} }) });
    try {
      await writer.connect(); await reader.connect({ readOnly: true });
      if (!scenario.allowed) {
        const result = await writer.call("test.journal.track", { entry: "quests/fixture/quest_a" });
        expect(result.ok).toBe(false);
        if (!scenario.args.includes("--allow-test-hooks")) expect(result.error?.code).toBe("test_hooks_off");
        continue;
      }
      const result = await api.run("test.journal.track", { entry: "quests/fixture/quest_a" }, { allow: ["act-player"] });
      expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(result.error.message);
      expect((result.result as any).tracked_hash).toBe(1001);
      expect((await writer.call("test.journal.track", { entry: 1001 })).ok).toBe(false);
      expect((await reader.call("test.journal.track", { entry: 1002 })).ok).toBe(false);
      for (const entry of [null, "", [], -1, 4294967296, 1.5, "missing/path"])
        expect((await writer.call("test.journal.track", { entry })).ok).toBe(false);
      expect((await writer.call("test.journal.track", { entry: 1002 })).ok).toBe(true);
      const page = await reader.call("world.events", { kinds: ["journal"] });
      expect(page.ok).toBe(true);
      expect((page.result as any).events.map((r: any) => [r.data.what, r.data.hash])).toEqual([["tracked", 1001], ["tracked", 1002]]);
      const tracked = (page.result as any).events[0].data;
      expect(tracked.path).toBe("quests/fixture/quest_a");
      expect(tracked.path_complete).toBe(true);
    } finally { api.close(); writer.close(); reader.close(); await host.stop(); }
  }
  const root = resolve(import.meta.dir, "../..");
  const normal = packageScripts(root, "writes", false).map(f => f.text).join("\n");
  const autonomous = packageScripts(root, "writes", true).map(f => f.text).join("\n");
  expect(normal).not.toContain("class XFJournalTest");
  expect(autonomous).toContain("journal.TrackEntry(entry)");
  expect(autonomous).toContain("entry as JournalQuest");
}, 20000);
