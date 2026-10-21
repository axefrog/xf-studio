import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claimSingleInstance, INSTANCE_HEADER, INSTANCE_LOCK, instanceActivateRequest, instanceName, type InstancePorts, type ProcessLock } from "../single-instance";

/** A lock owned by whichever process asked first, as the named mutex is. */
const sharedLock = () => { const owners = new Map<string, number>(); return (pid: number): ProcessLock => ({ acquire: name => {
  if (!owners.has(name)) owners.set(name, pid);
  return owners.get(name) === pid;
} }); };
const ports = (pid: number, lock: ProcessLock, activated: number[] = []): InstancePorts => ({
  pid, lock, sleep: async () => {}, publishWaitMs: 400,
  activate: async (port, token) => { activated.push(port); return token.length === 64; },
});

test("the lock decides who runs; the published port only brings the first window forward", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-instance-")), lock = sharedLock();
  try {
    const first = await claimSingleInstance(root, ports(100, lock(100)));
    expect(first.first).toBe(true);
    if (!first.first) return;
    // Before the first publishes (still installing WebView2, say), a second launch waits, then ends without starting.
    expect(await claimSingleInstance(root, ports(200, lock(200)))).toEqual({ first: false, activated: false });
    first.publish(4555);
    expect(JSON.parse(readFileSync(join(root, INSTANCE_LOCK), "utf8"))).toEqual({ pid: 100, port: 4555, token: first.token });
    const activated: number[] = [];
    expect(await claimSingleInstance(root, ports(200, lock(200), activated))).toEqual({ first: false, activated: true });
    expect(activated).toEqual([4555]);
    // A stale or damaged file never lets a second process start while the first holds the lock.
    writeFileSync(join(root, INSTANCE_LOCK), "{");
    expect((await claimSingleInstance(root, ports(300, lock(300)))).first).toBe(false);
    first.release();
    expect(existsSync(join(root, INSTANCE_LOCK))).toBe(true);
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

test.skipIf(process.platform !== "win32")("the Windows named mutex is held for the owner's lifetime and freed when it is killed", async () => {
  const name = `${instanceName(join(tmpdir(), `xfs-mutex-${crypto.randomUUID()}`))}`;
  const module = resolve(import.meta.dir, "../single-instance.ts").replace(/\\/g, "/");
  const holder = (hold: boolean) => Bun.spawn([process.execPath, "-e",
    `const { windowsMutex } = await import(${JSON.stringify(module)}); console.log(windowsMutex().acquire(${JSON.stringify(name)}) ? "owned" : "taken");
     ${hold ? "await new Promise(() => {});" : ""}`], { stdout: "pipe", stderr: "ignore" });
  const firstLine = async (child: ReturnType<typeof holder>) => {
    const reader = child.stdout.getReader(), { value } = await reader.read(); reader.releaseLock();
    return new TextDecoder().decode(value).trim();
  };
  const first = holder(true);
  try {
    expect(await firstLine(first)).toBe("owned");
    const second = holder(false);
    expect(await firstLine(second)).toBe("taken");
    await second.exited;
    first.kill(9);
    await first.exited;
    // The owner ended without letting go: Windows abandons the mutex, and the next launch owns it.
    const third = holder(false);
    expect(await firstLine(third)).toBe("owned");
    await third.exited;
  } finally { if (first.exitCode === null) first.kill(9); }
}, 30_000);
