import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { validate } from "../api/schema.ts";
import { packageScripts } from "../redscript-natives.ts";
import { projectDir, tempDir } from "./helpers.ts";

const entry = { schema: "xfb/supervisor-entry-1", actor: { kind: "player", ref: "V" }, goal: { kind: "idle_safe" },
  invariants: ["alive"], policy: { alive: "handover" } };
function session() {
  const dir = tempDir("xfb-supervisor-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "test", pid: process.pid, pipe: "fixture", control_pipe: "control", token: "t", started_at: new Date().toISOString(), plugin_version: "test", allow_writes: true }));
  return dir;
}
const ok = (result: unknown = {}) => ({ v: 1 as const, id: 1, cid: "t", ok: true as const, result });

test("supervisor schema carries actor identities and closed fixed policies", () => {
  const schema = findCommand("supervisor.set")!.input;
  for (const actor of [entry.actor, { kind: "npc", ref: "a1" }, { kind: "spawn", ref: "12" }]) expect(validate(schema, { ...entry, actor })).toEqual([]);
  expect(validate(schema, { ...entry, policy: { alive: "player.teleport" } })).not.toEqual([]);
  expect(validate(schema, { ...entry, goal: { kind: "eval", source: "anything" } })).not.toEqual([]);
  expect(validate(schema, { ...entry, tick_hz: 60 })).not.toEqual([]);
});

test("supervisor module and immediate input seam stay in autonomous packaging", () => {
  const normal = packageScripts(projectDir, "writes", false).map(s => s.text).join("\n");
  const candidate = packageScripts(projectDir, "writes", true).map(s => s.text).join("\n");
  expect(normal).not.toContain("xfSupervisorWatch"); expect(normal).not.toContain("class XFSupervisorSystem");
  expect(candidate).toContain("xfSupervisorWatch"); expect(candidate).toContain("class XFSupervisorSystem");
  expect(candidate).toContain('XFBridge_Record("supervisor"');
  const cpp = readFileSync(join(projectDir, "native/src/plugin/Supervisor.cpp"), "utf8");
  expect(cpp).toContain("HandleGuarded("); expect(cpp).toContain("#ifdef XFB_AUTONOMOUS_TEST_HOOKS");
  const script = readFileSync(join(projectDir, "redscript-probes/autonomous/XFRuntimeBridgeSupervisor.reds"), "utf8");
  const positions = script.split("func SpawnPositions(")[1]!.split("public static func Watch")[0]!;
  expect(positions).not.toMatch(/Listen\(|DrainEvents\(/);
  expect(positions).toContain("object.GetWorldPosition()");
});

test("supervision keeps its connection after recorder stop and releases after observed native takeover", async () => {
  const dir = session(); let closes = 0, active = true, probes = 0;
  const api = new CommandApi({ runtimeDir: dir, auditDir: dir, idleCloseMs: 10,
    transport: async () => ({ call: async method => { if (method === "supervisor.state") probes++; return ok(method.startsWith("supervisor.") ? { active } : { run: 1 }); }, close: () => { closes++; } }),
    controlTransport: async () => ({ call: async () => ok({ active: false }), close: () => {} }) });
  try {
    expect((await api.run("supervisor.set", entry)).ok).toBe(true);
    await api.run("test.record.start", { duration_s: 1 }); await api.run("test.record.stop");
    api.release(); await Bun.sleep(40); expect(closes).toBe(0);
    active = false; await Bun.sleep(2200); expect(probes).toBeGreaterThan(0); expect(closes).toBe(1);
  } finally { api.close(); }
});

test("emergency clear overtakes a pending set and a late reply cannot restore its connection lease", async () => {
  const dir = session(); let finish!: () => void, entered!: () => void, closes = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const api = new CommandApi({ runtimeDir: dir, auditDir: dir, idleCloseMs: 10,
    transport: async () => ({ call: async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return ok({ active: true }); }, close: () => { closes++; } }),
    controlTransport: async () => ({ call: async method => { expect(method).toBe("supervisor.clear"); return ok({ active: false }); }, close: () => {} }) });
  try {
    const pending = api.run("supervisor.set", entry); await started;
    const cleared = await Promise.race([api.run("supervisor.clear"), Bun.sleep(500).then(() => undefined)]);
    expect(cleared?.ok).toBe(true); finish(); await pending;
    api.release(); expect(closes).toBe(1);
  } finally { api.close(); }
});
