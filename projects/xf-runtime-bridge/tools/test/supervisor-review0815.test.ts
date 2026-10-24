import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp/server.ts";
import { findCommand } from "../api/catalogue.ts";
import { validate } from "../api/schema.ts";
import { CommandApi } from "../api/command-api.ts";
import { BridgeClient } from "../bridge-lib.ts";
import { catchUp } from "../testing/timeline.ts";
import type { Json, TestApi } from "../testing/windows.ts";
import { projectDir, startSelftestHost, tempDir } from "./helpers.ts";

const entry = { schema: "xfb/supervisor-entry-1", actor: { kind: "player", ref: "V" }, goal: { kind: "idle_safe" }, invariants: ["alive"], policy: { alive: "pause_world" } };

test("review H1: stationary combat takeover uses the pinned PSM mappings and button values", () => {
  // 2.31 bundle 2119046f…ee86, weaponTransitions.script:223–243,321;
  // coverActionTransitions.script:63 (CameraAim); meleeTransitions.script:171,206–263.
  const script = readFileSync(join(projectDir, "redscript-probes/autonomous/XFRuntimeBridgeSupervisor.reds"), "utf8");
  for (const name of ["RangedAttack", "CameraAim", "Reload", "MeleeAttack", "MeleeLightAttack", "MeleeHeavyAttack", "MeleeStrongAttack", "MeleeBlock", "QuickMelee"])
    expect(script, name).toContain(`n"${name}"`);
  const player = readFileSync(join(projectDir, "redscript/XFRuntimeBridgePlayer.reds"), "utf8");
  const callback = player.split("protected cb func OnAction(action: ListenerAction")[1]!.split("// 0.8 (session 8")[0]!;
  expect(callback).toContain("ListenerAction.IsButtonJustPressed(action)");
  expect(callback).toContain("this.xfSupervisorWatch");
  expect(callback).toMatch(/this\.xfSupervisorWatch\s*\{\s*moved = moved \|\| value >= 0\.3/);
  expect(callback).toContain("this.Touch(NameToString(name))");
});

test("review H2: MCP restricted to player cannot arm world or withdrawal policies", async () => {
  const dir = tempDir("xfb-review-caps-"); let calls = 0;
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "s", pid: process.pid, pipe: "fixture", token: "t", started_at: new Date().toISOString(), allow_writes: true }));
  const api = new CommandApi({ runtimeDir: dir, auditDir: dir, transport: async () => ({ call: async () => { calls++; return { v: 1 as const, id: 1, cid: "test", ok: true, result: { active: true } }; }, close() {} }) });
  const server = createMcpServer(api, { allow: ["read", "write-player", "control"] });
  const client = new Client({ name: "review", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a); await client.connect(b);
    for (const action of ["pause_world", "withdraw_nearby"]) {
      const result = await client.callTool({ name: "supervisor_set", arguments: { ...entry, policy: { alive: action } } });
      expect(result.isError, action).toBe(true);
    }
    expect(calls).toBe(0);
  } finally { await client.close(); await server.close(); api.close(); }
});

test("review H2: native refuses arming with caller player-only capabilities despite broad config", async () => {
  const host = await startSelftestHost(["--allow-writes", "--allow-test-hooks", "--write-classes", "player,world,npc,dm"]);
  const client = new BridgeClient(host.session, 3000);
  try {
    await client.connect();
    for (const policy of ["pause_world", "withdraw_nearby"]) {
      const result = await client.call("supervisor.set", { ...entry, policy: { alive: policy } }, "review-caps", { caller_write_classes: ["player"] });
      expect(result.ok).toBe(false); expect(result.error?.code).toBe("permission_denied");
    }
    const missing = await client.call("supervisor.set", entry, "review-missing-claim");
    expect(missing.error?.code).toBe("permission_denied");
  } finally { client.close(); await host.stop(); }
}, 60000);

function timeline() {
  const records: Json[] = [], events: Json[] = []; let start = 10, end: number | null = null;
  const api: TestApi = { run: async (name, input: Json = {}) => ({ ok: true, command: name, cid: "test", result:
    name === "bridge.info" ? { sid: "s" } : name === "test.record.read" ? { run: 1, session: "s", world_generation: 2, active: end === null,
      start_s: start, end_s: end, source_now_s: 30, latest: records.length, next: records.length, lost: 0, records: records.filter(r => r.seq > (input.since ?? 0)).slice(0, 5) } :
    { events: events.filter(e => e.seq > (input.since ?? 0)).slice(0, 500), latest: events.length,
      next: events.filter(e => e.seq > (input.since ?? 0)).slice(0, 500).at(-1)?.seq ?? input.since, dropped: 0 } }) };
  return { api, records, events, stop: () => { end = 20; } };
}
const receipt = { event: "supervisor.action", receipt_seq: 100, generation: 1, world_generation: 2, source_s: 12, method: "world.pause", response: { ok: true } };
test("review M4: either feed may arrive first across catch-up calls without repeating an intervention", async () => {
  for (const sessionFirst of [true, false]) {
    const f = timeline();
    const record = { seq: 1, run: 1, session: "s", world_generation: 2, valid: true, source_s: 12, channel: "supervisor", data: receipt };
    const event = { seq: 1, kind: receipt.event, source_s: 12, data: receipt };
    if (sessionFirst) f.events.push(event); else f.records.push(record);
    const first = await catchUp(f.api, { run: 1, digest: false }); expect(first.supervisor_summary.counts.actions).toBe(1);
    if (sessionFirst) f.records.push(record); else f.events.push(event);
    const second = await catchUp(f.api, { cursor: first.cursor, digest: false });
    expect(second.supervisor_summary.counts.actions).toBe(0);
    expect(second.alerts.filter((v: Json) => v.kind === "supervisor")).toHaveLength(0);
  }
});
test("review M5: old-world, pre-run and post-stop contact receipts cannot latch a new run", async () => {
  const f = timeline(); f.stop();
  for (const [world, time] of [[1, 15], [2, 9], [2, 21]]) f.events.push({ seq: f.events.length + 1, kind: "supervisor.contact", source_s: 15,
    data: { ...receipt, event: "supervisor.contact", receipt_seq: f.events.length + 1, world_generation: world, source_s: time, receipt: { vehicle_hit_observed: true } } });
  const page = await catchUp(f.api, { run: 1, digest: false });
  expect(page.contact_summary.observed_in_run).toBe(false);
  expect(page.supervisor_summary.receipts).toHaveLength(0);
  f.events.push({ seq: 4, kind: "supervisor.contact", source_s: 15, data: { ...receipt, event: "supervisor.contact", receipt_seq: 4, source_s: 15, receipt: { vehicle_hit_observed: true } } });
  const valid = await catchUp(f.api, { cursor: page.cursor, digest: false }); expect(valid.contact_summary.observed_in_run).toBe(true);
});

test("review M4: reconciliation storage stays bounded and retirement cannot silently repeat a late copy", async () => {
  const f = timeline();
  for (let i = 1; i <= 513; ++i) f.events.push({ seq: i, kind: receipt.event, source_s: 12, data: { ...receipt, receipt_seq: i } });
  const first = await catchUp(f.api, { run: 1, digest: false });
  expect(first.supervisor_summary.counts.actions).toBe(513);
  expect(first.cursor.supervisor_seen).toHaveLength(512);
  expect(validate(findCommand("game.catchup")!.input, { cursor: first.cursor })).toEqual([]);
  expect(first.gaps).toContain("supervisor_reconciliation_history_lost");
  f.records.push({ seq: 1, run: 1, session: "s", world_generation: 2, valid: true, source_s: 12, channel: "supervisor", data: { ...receipt, receipt_seq: 1 } });
  const second = await catchUp(f.api, { cursor: first.cursor, digest: false });
  expect(second.supervisor_summary.counts.actions).toBe(0); expect(second.complete).toBe(false);
});

test("review H2: an allowed policy carries only the frontend grant, outside untrusted entry data", async () => {
  const dir = tempDir("xfb-review-granted-"); let claims: Json = {};
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "s", pid: process.pid, pipe: "fixture", token: "t", started_at: new Date().toISOString(), allow_writes: true }));
  const api = new CommandApi({ runtimeDir: dir, auditDir: dir, transport: async () => ({ call: async (_method, _params, _cid, _timeout, grant) => {
    claims = grant ?? {}; return { v: 1 as const, id: 1, cid: "grant", ok: true, result: { active: true } };
  }, close() {} }) });
  try {
    const allowed = ["read", "write-player", "write-world"] as const;
    expect((await api.run("supervisor.set", entry, { allow: allowed })).ok).toBe(true);
    expect(claims.caller_write_classes).toEqual(["player", "world"]);
    expect((await api.run("supervisor.set", { ...entry, caller_write_classes: ["player", "world", "npc", "dm"] }, { allow: allowed })).ok).toBe(false);
  } finally { api.close(); }
});
