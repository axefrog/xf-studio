/**
 * Minimal Chrome DevTools Protocol driver for isolated `?verify=1` UI checks.
 * Launches a throwaway Chrome profile and a disposable-data authoring server.
 * Never points at the active working draft or library.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { localSettingsDirectory } from "../src/setup/host/local-settings-store";

/** Windows will not delete a folder a just-ended process (Chrome and its helpers, the server) still holds, so removal is retried. */
const REMOVAL = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = resolve(import.meta.dir, "..");

const FOLDER_OWNER = ".xfs-ui-owner";
function browserFolder(kind: "chrome" | "data"): string {
  const folder = mkdtempSync(join(tmpdir(), `xfs-ui-${kind}-`));
  writeFileSync(join(folder, FOLDER_OWNER), String(process.pid));
  return folder;
}

/** A killed run misses its exit hooks. Sweep only our old folders whose recorded owner has exited; unknown ownership stays. */
export async function removeStaleBrowserFolders(directory = tmpdir(), now = Date.now(), keep?: string): Promise<void> {
  let folders;
  try { folders = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const folder of folders) {
    if (!folder.isDirectory() || folder.isSymbolicLink() || !/^xfs-ui-(chrome|data)-[a-zA-Z0-9]+$/.test(folder.name)) continue;
    const path = resolve(directory, folder.name);
    if (keep && path === resolve(keep)) continue;
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || now - stat.mtimeMs <= 24 * 60 * 60_000) continue;
      const ownerFile = join(path, FOLDER_OWNER), ownerStat = await lstat(ownerFile);
      if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) continue;
      const owner = readFileSync(ownerFile, "utf8").trim();
      if (!/^[1-9]\d*$/.test(owner) || !Number.isSafeInteger(Number(owner))) continue;
      try { process.kill(Number(owner), 0); continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue; }
      await rm(path, REMOVAL);
    } catch { /* Still held by a process, or already removed by another run. */ }
  }
}

export type Session = {
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T = any>(expression: string): Promise<T>;
  screenshot(path: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void>;
  viewport(width: number, height: number): Promise<void>;
  colorScheme(scheme: "light" | "dark"): Promise<void>;
  mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, options?: { button?: "left" | "right" | "middle" | "none"; modifiers?: number; buttons?: number; clickCount?: number }): Promise<void>;
  drag(from: [number, number], to: [number, number], options?: { steps?: number; button?: "left" | "right"; modifiers?: number; hold?: (x: number, y: number, i: number) => Promise<void> }): Promise<void>;
  key(key: string, options?: { code?: string; modifiers?: number; text?: string }): Promise<void>;
  type(text: string): Promise<void>;
  wait(ms: number): Promise<void>;
  waitFor(expression: string, timeout?: number): Promise<any>;
  console: { type: string; text: string }[];
  /** Subscribe to a CDP event on this page session. */
  on(method: string, handler: (params: any) => void): void;
  /** Answer native file choosers with the next queued path (or cancel when the queue is empty). */
  chooseFiles(paths: string[]): Promise<void>;
  /** Save downloads into a directory. */
  downloadTo(dir: string): Promise<void>;
  close(): Promise<void>;
};

/** Refuse an occupied loopback port before spawning anything. Ownership is checked again after startup (the bind probe can race). */
export async function assertPortAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error(`Invalid capture port: ${port}`);
  await new Promise<void>((ok, fail) => {
    const probe = createServer();
    probe.once("error", error => fail(Error(`Capture port ${port} is unavailable: ${error.message}`)));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => probe.close(error => error ? fail(error) : ok()));
  });
}

/**
 * A disposable-data authoring server. Its settings and install receipts live in that throwaway folder (host-state.ts), so nothing
 * a check does reaches the person's real settings, and it never adds a mod (INSTALL-01). `settings: "copy"` (the default) starts
 * it from a copy of the real settings, read once, so looks that need the game (the 3D head, hair, brows) still load.
 */
export async function startServer(port: number, options: { settings?: "copy" | "empty" } = {}) {
  await assertPortAvailable(port);
  const data = browserFolder("data"), run = randomUUID();
  const cleanup = () => { try { rmSync(data, REMOVAL); } catch { /* still held; stale-folder sweep retries */ } };
  process.once("exit", cleanup);
  let server: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const real = join(localSettingsDirectory(), "settings.json");
    if ((options.settings ?? "copy") === "copy" && existsSync(real)) copyFileSync(real, join(data, "settings.json"));
    server = Bun.spawn([process.execPath, "server.ts"], { cwd: root, env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data,
      XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off", XFS_CAPTURE_RUN: run,
      // Override inherited caches: XFS_PREVIEW_CORE_CACHE, XFS_RESOLVER_CACHE, XFS_CHOICE_PREVIEW_CACHE,
      // XFS_PACKAGE_PLATE_CACHE and XFS_EXPRESSIONS_GAME_CACHE. All are removed with this run's data.
      XFS_PREVIEW_CORE_CACHE: join(data, "preview-cache"), XFS_RESOLVER_CACHE: join(data, "resolver-cache"),
      XFS_CHOICE_PREVIEW_CACHE: join(data, "choice-previews"), XFS_PACKAGE_PLATE_CACHE: join(data, "eye-plate-cache"),
      XFS_EXPRESSIONS_GAME_CACHE: join(data, "expressions-game-cache") }, stdout: "pipe", stderr: "pipe" });
    const child = server;
    void child.exited.then(() => { cleanup(); process.removeListener("exit", cleanup); });
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null || child.killed) throw Error("Authoring server exited before startup");
      let response: Response | undefined;
      try { response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000), redirect: "error" }); }
      catch { /* booting */ }
      if (response) {
        const health = await response.json() as { capture?: { run: string; pid: number } };
        if (!response.ok || health.capture?.run !== run || health.capture.pid !== child.pid)
          throw Error(`Capture server endpoint on port ${port} does not belong to this run`);
        if (child.exitCode !== null || child.killed) throw Error("Authoring server exited during startup");
        return { server: child, data };
      }
      await Bun.sleep(250);
    }
    throw Error("Authoring server did not start");
  } catch (error) {
    if (server) { server.kill(); await server.exited; }
    cleanup(); process.removeListener("exit", cleanup);
    throw error;
  }
}

export type PageTarget = { type: string; webSocketDebuggerUrl: string };
/** How long, in total, one Chrome start may take to expose its page, and how many starts are tried. */
export const PAGE_TARGET_LIMITS = { deadlineMs: 30_000, firstDelayMs: 100, maxDelayMs: 1_000, attempts: 3 };
/**
 * Wait for a started Chrome's page target: ask `targets` with a growing delay (bounded backoff) until it lists a page, the process
 * ends, or the deadline passes. A busy machine (a full test suite beside other heavy work) can take many seconds to start Chrome, so
 * the old fixed 12 s poll failed intermittently. Throws with what was last seen.
 */
export async function waitForPageTarget(targets: () => Promise<PageTarget[] | null>, alive: () => boolean,
  limits: { deadlineMs: number; firstDelayMs: number; maxDelayMs: number } = PAGE_TARGET_LIMITS, sleep = (ms: number) => Bun.sleep(ms)): Promise<PageTarget> {
  const start = Date.now();
  let delay = limits.firstDelayMs, last = "Chrome's debugging port never answered";
  for (;;) {
    if (!alive()) throw Error(`Chrome exited before it exposed a page target (${last})`);
    try {
      const listed = await targets();
      const page = listed?.find(target => target.type === "page");
      if (page && alive()) return page;
      if (listed) last = `Chrome listed ${listed.length} target(s), none a page`;
    } catch (error) { last = `Chrome's debugging port didn't answer (${(error as Error)?.message ?? error})`; }
    if (!alive()) throw Error(`Chrome exited before it exposed a page target (${last})`);
    const left = limits.deadlineMs - (Date.now() - start);
    if (left <= 0) throw Error(`Chrome did not expose a page target within ${Math.round(limits.deadlineMs / 1000)} s (${last})`);
    await sleep(Math.min(delay, left));
    delay = Math.min(limits.maxDelayMs, Math.ceil(delay * 1.5));
  }
}
/** Only loopback endpoints on the expected port may be used, even if a target response supplies another URL. */
export function debugEndpoint(value: string, port: number, kind: "browser" | "page"): string {
  const url = new URL(value);
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || Number(url.port) !== port ||
      !url.pathname.startsWith(`/devtools/${kind}/`) || url.username || url.password)
    throw Error("Chrome supplied an unexpected debugging endpoint");
  return url.href;
}

/** Ask the browser endpoint for its OS process ID before using any page target; a port alone proves no ownership. */
export async function verifyBrowserProcess(endpoint: string, pid: number): Promise<void> {
  const socket = new WebSocket(endpoint);
  try {
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(Error("Chrome process identity timed out")), 2000);
      const finish = (error?: Error) => { clearTimeout(timer); error ? fail(error) : ok(); };
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }));
      socket.onerror = () => finish(Error("Chrome process identity connection failed"));
      socket.onclose = () => finish(Error("Chrome closed before reporting its process identity"));
      socket.onmessage = event => {
        try {
          const result = JSON.parse(String(event.data));
          if (result.id !== 1) return;
          if (result.error || !result.result?.processInfo?.some((info: { type: string; id: number }) => info.type === "browser" && info.id === pid))
            finish(Error("Chrome debugging endpoint does not belong to the spawned process"));
          else finish();
        } catch { finish(Error("Chrome returned an invalid process identity")); }
      };
    });
  } finally { socket.close(); }
}

/** The debugging port a Chrome started with `--remote-debugging-port=0` chose (its profile's `DevToolsActivePort`), or null yet. */
function activePort(profile: string): number | null {
  const file = join(profile, "DevToolsActivePort");
  if (!existsSync(file)) return null;
  const port = Number(readFileSync(file, "utf8").split(/\s+/)[0]);
  return Number.isInteger(port) && port > 0 ? port : null;
}
/** Stop a Chrome and wait (briefly) until it has exited, so the next start never meets its port or profile. */
async function stopChrome(chrome: Subprocess, profile: string, keep = false): Promise<void> {
  chrome.kill();
  await Promise.race([chrome.exited, Bun.sleep(5_000)]);
  if (keep) return;
  try { await rm(profile, REMOVAL); } catch { /* A file Chrome still holds after the retries. */ }
}
/**
 * Start a throwaway headless Chrome and connect to its page. Without `debugPort`, Chrome picks a free debugging port itself (read from
 * its profile), so concurrent or back-to-back starts never collide on one. A start that exposes no page within its deadline, or exits,
 * is stopped and tried again with a fresh profile, a bounded number of times, then fails with a clear message. Requested occupied
 * ports are refused before spawning; the browser endpoint must report this child's PID before any page target is used.
 */
async function startChrome(options: { width?: number; height?: number; debugPort?: number; args?: readonly string[]; profile?: string }) {
  const failures: string[] = [];
  if (options.debugPort) await assertPortAvailable(options.debugPort);
  for (let attempt = 1; attempt <= PAGE_TARGET_LIMITS.attempts; attempt++) {
    if (options.debugPort && attempt > 1) await assertPortAvailable(options.debugPort);
    const profile = options.profile ? (mkdirSync(options.profile, { recursive: true }), options.profile) : browserFolder("chrome");
    // Chrome's scoped_dir* scratch belongs to this profile too, so removing the profile also removes it after a crash or killed run.
    const temp = join(resolve(profile), "temp");
    mkdirSync(temp, { recursive: true });
    if (options.profile) rmSync(join(profile, "DevToolsActivePort"), { force: true });
    // Chrome's nested sandbox can stall inside a restricted test host. This opt-in is for isolated loopback probe pages.
    const chrome: Subprocess = Bun.spawn([CHROME, "--headless=new", `--remote-debugging-port=${options.debugPort ?? 0}`, `--user-data-dir=${profile}`,
      `--window-size=${options.width ?? 1600},${options.height ?? 1000}`, "--no-first-run", "--no-default-browser-check",
      "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11", "--hide-scrollbars",
      ...(process.env.XFS_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []), ...(options.args ?? []), "about:blank"],
      { env: { ...process.env, TEMP: temp, TMP: temp }, stdout: "ignore", stderr: "ignore" });
    try {
      const page = await waitForPageTarget(async () => {
        const port = options.debugPort ?? activePort(profile);
        if (!port) return null;
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000), redirect: "error" })).json() as { webSocketDebuggerUrl: string };
        await verifyBrowserProcess(debugEndpoint(version.webSocketDebuggerUrl, port, "browser"), chrome.pid);
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000), redirect: "error" })).json() as PageTarget[];
        for (const target of targets) if (target.type === "page") debugEndpoint(target.webSocketDebuggerUrl, port, "page");
        return targets;
      }, () => chrome.exitCode === null && !chrome.killed);
      return { chrome, profile, page };
    } catch (error) {
      failures.push(`attempt ${attempt}: ${(error as Error).message}`);
      await stopChrome(chrome, profile, !!options.profile);
    }
  }
  throw Error(`Chrome did not expose a page target after ${PAGE_TARGET_LIMITS.attempts} attempts (${CHROME}): ${failures.join("; ")}`);
}

/**
 * `args`: extra Chrome switches (for example a fake camera: `--use-fake-device-for-media-stream`). `scheme` and `motion` pin the page's
 * `prefers-color-scheme` and `prefers-reduced-motion` instead of taking the machine's settings. `init`: a script run in the page before its
 * own (instrumentation for a measurement, for example). `profile`: a Chrome profile folder kept between launches (its GPU program cache and
 * page storage survive, as an installed app's do); by default each launch gets a throwaway one.
 */
export async function launch(url: string, options: { width?: number; height?: number; debugPort?: number; scheme?: "light" | "dark";
  motion?: "reduce" | "no-preference"; args?: readonly string[]; init?: string; profile?: string } = {}) {
  await removeStaleBrowserFolders(tmpdir(), Date.now(), options.profile);
  const { chrome, profile, page } = await startChrome(options);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0;
  const pending = new Map<number, { ok(value: any): void; fail(error: Error): void }>();
  const consoleLog: { type: string; text: string }[] = [];
  const handlers = new Map<string, ((params: any) => void)[]>();
  /** The emulated media features, kept together: each Emulation.setEmulatedMedia call replaces the whole list. */
  const media = new Map<string, string>();
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method) for (const handler of handlers.get(message.method) ?? []) handler(message.params);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id)!; pending.delete(message.id);
      if (message.error) entry.fail(Error(message.error.message)); else entry.ok(message.result);
    } else if (message.method === "Runtime.consoleAPICalled") {
      consoleLog.push({ type: message.params.type, text: message.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ") });
    } else if (message.method === "Runtime.exceptionThrown") {
      consoleLog.push({ type: "exception", text: message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text });
    } else if (message.method === "Log.entryAdded") {
      consoleLog.push({ type: `log:${message.params.entry.level}`, text: message.params.entry.text });
    }
  };
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => {
    const next = ++id; pending.set(next, { ok, fail }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  const emulateMedia = () => send("Emulation.setEmulatedMedia", { features: [...media].map(([name, value]) => ({ name, value })) });
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  const chooserQueue: string[] = [];
  let chooserArmed = false;
  const session: Session = {
    send, console: consoleLog,
    on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); },
    async chooseFiles(paths) {
      chooserQueue.push(...paths);
      if (chooserArmed) return;
      chooserArmed = true;
      await send("DOM.enable");
      await send("Page.setInterceptFileChooserDialog", { enabled: true });
      session.on("Page.fileChooserOpened", params => {
        const next = chooserQueue.shift();
        void send("DOM.setFileInputFiles", { files: next ? [next] : [], backendNodeId: params.backendNodeId });
      });
    },
    async downloadTo(dir) {
      mkdirSync(dir, { recursive: true });
      try { await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true }); }
      catch { await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir }); }
    },
    async evaluate(expression) {
      const result = await send<any>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async screenshot(path, clip) {
      const result = await send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(result.data, "base64"));
    },
    async viewport(width, height) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    },
    async colorScheme(scheme) {
      media.set("prefers-color-scheme", scheme);
      await emulateMedia();
    },
    async mouse(type, x, y, opts = {}) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: opts.button ?? "left", modifiers: opts.modifiers ?? 0,
        buttons: opts.buttons ?? (type === "mouseReleased" ? 0 : opts.button === "right" ? 2 : 1), clickCount: opts.clickCount ?? (type === "mouseMoved" ? 0 : 1) });
    },
    async drag(from, to, opts = {}) {
      const button = opts.button ?? "left", steps = opts.steps ?? 12, buttons = button === "right" ? 2 : 1;
      await session.mouse("mouseMoved", from[0], from[1], { button: "none", buttons: 0 });
      await session.mouse("mousePressed", from[0], from[1], { button, modifiers: opts.modifiers, buttons });
      for (let i = 1; i <= steps; i++) {
        const x = from[0] + (to[0] - from[0]) * i / steps, y = from[1] + (to[1] - from[1]) * i / steps;
        await session.mouse("mouseMoved", x, y, { button, modifiers: opts.modifiers, buttons });
        await opts.hold?.(x, y, i);
        await Bun.sleep(16);
      }
      await session.mouse("mouseReleased", to[0], to[1], { button, modifiers: opts.modifiers, buttons: 0 });
    },
    async key(key, opts = {}) {
      const code = opts.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
      const vk: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, F6: 117, F10: 121, F2: 113, Delete: 46, Home: 36, End: 35, " ": 32 };
      const windowsVirtualKeyCode = vk[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      await send("Input.dispatchKeyEvent", { type: opts.text ? "keyDown" : "rawKeyDown", key, code, modifiers: opts.modifiers ?? 0, windowsVirtualKeyCode, text: opts.text });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers: opts.modifiers ?? 0, windowsVirtualKeyCode });
    },
    async type(text) { await send("Input.insertText", { text }); },
    wait: ms => Bun.sleep(ms),
    async waitFor(expression, timeout = 30000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try { const value = await session.evaluate(expression); if (value) return value; } catch { /* page loading */ }
        await Bun.sleep(150);
      }
      throw Error(`Timed out waiting for ${expression}`);
    },
    async close() { socket.close(); await stopChrome(chrome, profile, !!options.profile); },
  };
  if (options.width) await session.viewport(options.width, options.height ?? 1000);
  if (options.motion) media.set("prefers-reduced-motion", options.motion);
  if (options.scheme) await session.colorScheme(options.scheme);
  else if (media.size) await emulateMedia();
  if (options.init) await send("Page.addScriptToEvaluateOnNewDocument", { source: options.init });
  await send("Page.navigate", { url });
  return session;
}

export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
/** Hide device-rendered viewport content so a screenshot contains no game-derived imagery. */
export const MASK_VIEWPORTS = `(() => { const s = document.createElement('style'); s.id = 'evidence-mask';
  s.textContent = '.viewport-slot canvas{visibility:hidden!important} .viewport-slot{background:repeating-linear-gradient(135deg,#2a3038 0 10px,#252a31 10px 20px)!important} .viewport-slot::after{content:"viewport content masked for asset-free evidence";position:absolute;left:50%;top:50%;translate:-50% -50%;font:12px system-ui;color:#c7ccd2;background:#0008;padding:6px 10px;white-space:nowrap}';
  document.head.append(s); return true; })()`;
export const UNMASK_VIEWPORTS = `document.getElementById('evidence-mask')?.remove()`;
export function saveJson(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2)); }
