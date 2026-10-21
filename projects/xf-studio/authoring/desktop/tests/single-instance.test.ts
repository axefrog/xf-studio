import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimSingleInstance, INSTANCE_HEADER, INSTANCE_LOCK, instanceActivateRequest, type InstancePorts } from "../single-instance";

const ports = (pid: number, running: Set<number>, activated: number[] = []): InstancePorts => ({
  pid, alive: id => running.has(id), sleep: async () => {}, publishWaitMs: 300,
  activate: async (port, token) => { activated.push(port); return token.length === 64; },
});

test("the first process claims the data folder; a second launch brings it forward and doesn't start", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-instance-"));
  try {
    const running = new Set([100, 200]), activated: number[] = [];
    const first = await claimSingleInstance(root, ports(100, running));
    expect(first.first).toBe(true);
    if (!first.first) return;
    first.publish(4555);
    expect(JSON.parse(readFileSync(join(root, INSTANCE_LOCK), "utf8"))).toEqual({ pid: 100, port: 4555, token: first.token });
    expect((await claimSingleInstance(root, ports(200, running, activated))).first).toBe(false);
    expect(activated).toEqual([4555]);
    // The owner's lock stays; releasing it removes it, and the next launch is first.
    first.release();
    expect(existsSync(join(root, INSTANCE_LOCK))).toBe(false);
    expect((await claimSingleInstance(root, ports(200, running))).first).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a stale lock (its process gone, or an owner that never publishes or answers) is taken over", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-instance-"));
  try {
    writeFileSync(join(root, INSTANCE_LOCK), JSON.stringify({ pid: 999, port: 1, token: "x".repeat(64) }));
    expect((await claimSingleInstance(root, ports(300, new Set([300])))).first).toBe(true);
    // A live process that never publishes a port (a reused process ID): waited for, then taken over.
    writeFileSync(join(root, INSTANCE_LOCK), JSON.stringify({ pid: 400 }));
    expect((await claimSingleInstance(root, ports(301, new Set([301, 400])))).first).toBe(true);
    // A damaged lock file.
    writeFileSync(join(root, INSTANCE_LOCK), "{");
    expect((await claimSingleInstance(root, ports(302, new Set([302])))).first).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("only the instance's own token brings its window forward", () => {
  let focused = 0;
  const ask = (token?: string, method = "POST") => instanceActivateRequest(new Request("http://127.0.0.1/api/desktop/instance/activate",
    { method, headers: token ? { [INSTANCE_HEADER]: token } : {} }), "a".repeat(64), () => focused++).status;
  expect(ask()).toBe(403);
  expect(ask("b".repeat(64))).toBe(403);
  expect(ask("a".repeat(64), "GET")).toBe(403);
  expect(ask("a".repeat(64))).toBe(204);
  expect(focused).toBe(1);
});
