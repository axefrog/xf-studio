// The headless Chrome launcher's wait for its page target (tools/cdp.ts): a slow start on a busy machine is waited for with a bounded
// backoff, a Chrome that exits is reported at once, and a start that never exposes a page ends with a clear message. No Chrome runs here.
import { describe, expect, spyOn, test } from "bun:test";
import { type PageTarget, assertPortAvailable, debugEndpoint, launch, removeStaleBrowserFolders, startServer, verifyBrowserProcess, waitForPageTarget } from "../tools/cdp";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./temp-dir";

test("stale cleanup removes only our old throwaway folders, keeping fresh, explicit profiles and unrelated temp", async () => {
  const root = tempDir("xfs-cdp-cleanup-");
  const now = Date.now(), old = new Date(now - 25 * 3600_000);
  const owner = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" });
  await owner.exited;
  for (const name of ["xfs-ui-chrome-old", "xfs-ui-data-old", "xfs-ui-chrome-kept", "xfs-ui-chrome-young", "xfs-ui-data-unowned", "xfs-ui-data-invalid", "scoped_dir123", "other-old"]) {
    const path = join(root, name);
    mkdirSync(path); writeFileSync(join(path, "child"), "scratch");
    if (!name.endsWith("unowned")) writeFileSync(join(path, ".xfs-ui-owner"), name.endsWith("invalid") ? "not a PID" : String(owner.pid));
    if (!name.endsWith("young")) utimesSync(path, old, old);
  }
  writeFileSync(join(root, "xfs-ui-data-file"), "not a folder");
  await removeStaleBrowserFolders(root, now, join(root, "xfs-ui-chrome-kept"));
  for (const name of ["xfs-ui-chrome-old", "xfs-ui-data-old"]) expect(existsSync(join(root, name))).toBe(false);
  for (const name of ["xfs-ui-chrome-kept", "xfs-ui-chrome-young", "xfs-ui-data-unowned", "xfs-ui-data-invalid", "scoped_dir123", "other-old", "xfs-ui-data-file"]) expect(existsSync(join(root, name))).toBe(true);
});

test("another capture's sweep keeps an overnight run's live profile and data, then removes them once their owner exits", async () => {
  const root = tempDir("xfs-cdp-concurrent-");
  const owner = Bun.spawn([process.execPath, "-e", "console.log('ready'); setInterval(() => {}, 1000)"], { stdout: "pipe", stderr: "ignore" });
  try {
    const reader = owner.stdout.getReader();
    await reader.read(); reader.releaseLock();
    const now = Date.now(), old = new Date(now - 25 * 3600_000);
    const folders = ["xfs-ui-chrome-active", "xfs-ui-data-active"].map(name => join(root, name));
    for (const path of folders) {
      mkdirSync(join(path, "nested"), { recursive: true });
      writeFileSync(join(path, ".xfs-ui-owner"), String(owner.pid));
      utimesSync(path, old, old);
      // Updating a nested database doesn't refresh the folder's age.
      writeFileSync(join(path, "nested", "database"), "current work");
    }
    await removeStaleBrowserFolders(root, now);
    for (const path of folders) expect(existsSync(join(path, "nested", "database"))).toBe(true);
    owner.kill(); await owner.exited;
    await removeStaleBrowserFolders(root, now);
    for (const path of folders) expect(existsSync(path)).toBe(false);
  } finally { owner.kill(); await owner.exited; }
});

const page: PageTarget = { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/1" };
const limits = { deadlineMs: 2_000, firstDelayMs: 1, maxDelayMs: 8 };

describe("waiting for Chrome's page target", () => {
  test("a slow start is waited for: refused connections and an empty target list are retried, with a growing delay", async () => {
    let asked = 0;
    const delays: number[] = [];
    const found = await waitForPageTarget(async () => {
      asked++;
      if (asked <= 3) throw Error("connection refused");
      if (asked <= 5) return asked === 4 ? null : [{ type: "service_worker", webSocketDebuggerUrl: "" }];
      return [page];
    }, () => true, limits, async ms => { delays.push(ms); });
    expect(found).toBe(page);
    expect(asked).toBe(6);
    expect(delays).toEqual([1, 2, 3, 5, 8]);
  });

  test("a Chrome that exits is reported at once with what was seen", async () => {
    let asked = 0;
    await expect(waitForPageTarget(async () => { asked++; throw Error("connection refused"); }, () => asked < 2, limits, async () => {}))
      .rejects.toThrow("Chrome exited before it exposed a page target (Chrome's debugging port didn't answer (connection refused))");
    expect(asked).toBe(2);
  });

  test("a start that never exposes a page ends at the deadline with a clear message", async () => {
    await expect(waitForPageTarget(async () => [], () => true, { deadlineMs: 30, firstDelayMs: 5, maxDelayMs: 10 }))
      .rejects.toThrow(/did not expose a page target within 0 s \(Chrome listed 0 target\(s\), none a page\)/);
  });
});


describe("capture endpoint ownership (no Chrome)", () => {
  test("occupied ports refuse both launches before spawning or contacting the unrelated listener", async () => {
    let requests = 0;
    const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { requests++; return Response.json({ app: "xf-studio" }); } });
    const spawn = spyOn(Bun, "spawn").mockImplementation((() => { throw Error("Must not spawn"); }) as typeof Bun.spawn);
    try {
      await expect(assertPortAvailable(other.port!)).rejects.toThrow("unavailable");
      await expect(startServer(other.port!, { settings: "empty" })).rejects.toThrow("unavailable");
      await expect(launch("about:blank", { debugPort: other.port! })).rejects.toThrow("unavailable");
      expect(spawn).not.toHaveBeenCalled();
      expect(requests).toBe(0);
    } finally { spawn.mockRestore(); other.stop(true); }
  });

  test("a page from a process that has already exited is never accepted", async () => {
    let called = false;
    await expect(waitForPageTarget(async () => { called = true; return [page]; }, () => false)).rejects.toThrow("Chrome exited");
    expect(called).toBe(false);
    let alive = true;
    await expect(waitForPageTarget(async () => { alive = false; return [page]; }, () => alive)).rejects.toThrow("Chrome exited");
  });

  test("the browser must report the spawned PID before its page can be selected", async () => {
    const methods: string[] = [];
    const browser = Bun.serve({ hostname: "127.0.0.1", port: 0,
      fetch(request, server) { if (server.upgrade(request)) return; return new Response("Not found", { status: 404 }); },
      websocket: { message(socket, text) {
        const request = JSON.parse(String(text)); methods.push(request.method);
        socket.send(JSON.stringify({ id: request.id, result: { processInfo: [{ type: "browser", id: 1234 }] } }));
      } } });
    const url = `ws://127.0.0.1:${browser.port}/devtools/browser/test`;
    try {
      await verifyBrowserProcess(debugEndpoint(url, browser.port!, "browser"), 1234);
      await expect(verifyBrowserProcess(url, 4321)).rejects.toThrow("does not belong");
      expect(methods).toEqual(["SystemInfo.getProcessInfo", "SystemInfo.getProcessInfo"]);
      for (const wrong of [url.replace("127.0.0.1", "example.com"), url.replace("ws:", "wss:"), url.replace("/browser/", "/page/")])
        expect(() => debugEndpoint(wrong, browser.port!, "browser")).toThrow("unexpected");
      expect(() => debugEndpoint(url, browser.port! + 1, "browser")).toThrow("unexpected");
    } finally { browser.stop(true); }
  });

  test("server startup rejects another run's healthy response and cleans its data; cache overrides stay run-owned", async () => {
    // A fake child exposes the spawn environment without running a server, game preparation, or GPU.
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = probe.port!; probe.stop(true);
    const cacheKeys = ["XFS_PREVIEW_CORE_CACHE", "XFS_RESOLVER_CACHE", "XFS_CHOICE_PREVIEW_CACHE", "XFS_PACKAGE_PLATE_CACHE", "XFS_EXPRESSIONS_GAME_CACHE"];
    const inherited = Object.fromEntries(cacheKeys.map(key => [key, process.env[key]]));
    for (const key of cacheKeys) process.env[key] = "unrelated-cache-must-not-be-used";
    let env: Record<string, string> = {}, finish!: (code: number) => void;
    let child: { pid: number; exitCode: number | null; killed: boolean; exited: Promise<number>; kill(): void };
    const spawn = spyOn(Bun, "spawn").mockImplementation(((_command: unknown, options: { env: Record<string, string> }) => {
      env = options.env;
      child = { pid: 9999, exitCode: null, killed: false, exited: new Promise(resolve => { finish = resolve; }),
        kill() { this.killed = true; this.exitCode = 0; finish(0); } };
      return child;
    }) as typeof Bun.spawn);
    let owned = false;
    const fetchHealth = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ app: "xf-studio",
      capture: { run: owned ? env.XFS_CAPTURE_RUN : "another-run", pid: child.pid } }), { preconnect: fetch.preconnect }));
    try {
      await expect(startServer(port, { settings: "empty" })).rejects.toThrow("does not belong");
      expect(child!.killed).toBe(true);
      expect(existsSync(env.XFAS_DATA_DIR!)).toBe(false);
      owned = true;
      const run = await startServer(port, { settings: "empty" });
      expect(existsSync(run.data)).toBe(true);
      for (const key of cacheKeys) {
        expect(env[key]!.startsWith(run.data + (process.platform === "win32" ? "\\" : "/"))).toBe(true);
        mkdirSync(env[key]!, { recursive: true }); writeFileSync(join(env[key]!, "run-cache"), "fixture");
      }
      run.server.kill(); await run.server.exited; await Bun.sleep(0);
      expect(existsSync(run.data)).toBe(false);
    } finally {
      child!?.kill(); fetchHealth.mockRestore(); spawn.mockRestore();
      for (const [key, value] of Object.entries(inherited)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});


test("a real disposable server reports this child's identity and removes its data on exit", async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port!; probe.stop(true);
  const run = await startServer(port, { settings: "empty" });
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    expect(health.capture.pid).toBe(run.server.pid);
    expect(health.capture.run).toMatch(/^[0-9a-f-]{36}$/);
    expect(existsSync(run.data)).toBe(true);
  } finally { run.server.kill(); await run.server.exited; }
  for (let i = 0; i < 20 && existsSync(run.data); i++) await Bun.sleep(50);
  expect(existsSync(run.data)).toBe(false);
}, 40_000);
