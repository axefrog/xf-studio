/** Minimal Chrome DevTools Protocol client for site QA. Site-local on purpose: nothing is shared with the Studio app. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

export type CdpEvent = { method: string; params: any };
export type Browser = {
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T = any>(expression: string): Promise<T>;
  on(listener: (event: CdpEvent) => void): () => void;
  close(): Promise<void>;
};

export async function launchChrome(): Promise<Browser> {
  const chromePath = CANDIDATES.find(path => existsSync(path));
  if (!chromePath) throw Error("Chrome not found. Set CHROME to a Chrome/Chromium executable.");
  const profile = mkdtempSync(join(tmpdir(), "xfs-site-qa-"));
  const chrome = Bun.spawn([chromePath, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "about:blank"],
    { stdout: "ignore", stderr: "ignore" });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    const file = join(profile, "DevToolsActivePort");
    if (existsSync(file)) port = Number(readFileSync(file, "utf8").split("\n")[0]);
    if (!port) await Bun.sleep(100);
  }
  if (!port) { chrome.kill(); throw Error("Chrome did not report a DevTools port"); }
  let pageTarget: { type: string; webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !pageTarget; i++) {
    try { pageTarget = (await (await fetch(`http://127.0.0.1:${port}/json`)).json() as any[]).find(t => t.type === "page"); } catch { /* booting */ }
    if (!pageTarget) await Bun.sleep(100);
  }
  if (!pageTarget) { chrome.kill(); throw Error("Chrome exposed no page target"); }
  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let nextId = 0;
  const pending = new Map<number, { ok(value: any): void; fail(error: Error): void }>();
  const listeners = new Set<(event: CdpEvent) => void>();
  socket.onmessage = message => {
    const data = JSON.parse(String(message.data));
    if (data.id && pending.has(data.id)) {
      const entry = pending.get(data.id)!; pending.delete(data.id);
      if (data.error) entry.fail(Error(`${data.error.message}`)); else entry.ok(data.result);
    } else if (data.method) for (const listener of listeners) listener(data);
  };
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => {
    const id = ++nextId; pending.set(id, { ok, fail }); socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    async evaluate(expression) {
      const result = await send<any>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async close() {
      try { socket.close(); } catch { /* closed */ }
      chrome.kill(); await chrome.exited;
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may hold files briefly on Windows */ }
    },
  };
}
