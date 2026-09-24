/**
 * Minimal Chrome DevTools Protocol driver for isolated `?verify=1` UI checks.
 * Launches a throwaway Chrome profile and a disposable-data authoring server.
 * Never points at the active working draft or library.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Subprocess } from "bun";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = resolve(import.meta.dir, "..");

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

export async function startServer(port: number) {
  const data = mkdtempSync(join(tmpdir(), "xfs-ui-data-"));
  const server = Bun.spawn(["bun", "server.ts"], { cwd: root, env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data },
    stdout: "pipe", stderr: "pipe" });
  for (let i = 0; i < 120; i++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) return { server, data }; } catch { /* booting */ }
    await Bun.sleep(250);
  }
  server.kill();
  throw Error("Authoring server did not start");
}

export async function launch(url: string, options: { width?: number; height?: number; debugPort?: number; scheme?: "light" | "dark" } = {}) {
  const debugPort = options.debugPort ?? 9333;
  const profile = mkdtempSync(join(tmpdir(), "xfs-ui-chrome-"));
  const chrome: Subprocess = Bun.spawn([CHROME, "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `--window-size=${options.width ?? 1600},${options.height ?? 1000}`, "--no-first-run", "--no-default-browser-check",
    "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11", "--hide-scrollbars", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 80; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); if (targets.some(t => t.type === "page")) break; } catch { /* booting */ }
    await Bun.sleep(150);
  }
  const page = targets.find(t => t.type === "page");
  if (!page) { chrome.kill(); throw Error("Chrome did not expose a page target"); }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0;
  const pending = new Map<number, { ok(value: any): void; fail(error: Error): void }>();
  const consoleLog: { type: string; text: string }[] = [];
  const handlers = new Map<string, ((params: any) => void)[]>();
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
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
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
    async close() { socket.close(); chrome.kill(); },
  };
  if (options.width) await session.viewport(options.width, options.height ?? 1000);
  if (options.scheme) await session.colorScheme(options.scheme);
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
