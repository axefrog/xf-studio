import { afterAll, describe, expect, test } from "bun:test";
import { ensureWebView2, WEBVIEW2_FAILED, WEBVIEW2_PROMPT } from "../webview2-install";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { detectWebView2, parseRegVersion, WEBVIEW2_KEYS } from "../webview2";
import { blankWindowNotice } from "../startup-watchdog";
import { createHostLog } from "../host-log";
import { DesktopWorkspaceClose } from "../workspace-close";
import { createDesktopServer } from "../server";
import { USER_FACING_JARGON } from "../../src/alpha-availability";

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-startup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const regOutput = (pv: string) => `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\r\n    pv    REG_SZ    ${pv}\r\n\r\n`;

test("WebView2 detection follows the documented pv check across machine and user keys", () => {
  expect(parseRegVersion(regOutput("140.0.3485.54"))).toBe("140.0.3485.54");
  expect(parseRegVersion(regOutput("0.0.0.0"))).toBeNull();
  expect(parseRegVersion("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
  const queried: string[] = [];
  expect(detectWebView2({}, key => { queried.push(key); return key.startsWith("HKCU") ? regOutput("141.0.1.2") : ""; }))
    .toEqual({ installed: true, version: "141.0.1.2", source: "HKCU" });
  expect(queried).toEqual([...WEBVIEW2_KEYS]);
  expect(detectWebView2({}, () => "")).toEqual({ installed: false, version: null, source: null });
  expect(detectWebView2({ WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: root }, () => "")).toMatchObject({ installed: true });
});

test("a window that never loads gets plain words and one next step", () => {
  const missing = blankWindowNotice({ installed: false, version: null, source: null }, "C:\\data\\desktop.log", () => "line");
  expect(missing).toMatchObject({ action: "download-webview2", buttons: ["Open the Microsoft download page", "Close"] });
  expect(missing.message).toContain("WebView2 Runtime");
  const other = blankWindowNotice({ installed: true, version: "140.0", source: "HKLM" }, "C:\\data\\desktop.log", () => "a\nb");
  expect(other).toMatchObject({ action: "copy-diagnostics", buttons: ["Copy diagnostics", "Close"] });
  expect(other.diagnostics).toContain("WebView2: 140.0");
  for (const notice of [missing, other]) expect(USER_FACING_JARGON.test(`${notice.message} ${notice.detail}`)).toBe(false);
});

test("the host log is bounded and never throws", () => {
  const log = createHostLog(resolve(root, "log"));
  log.write("first\nline");
  expect(readFileSync(log.path, "utf8")).toMatch(/Z first line\n$/);
  createHostLog(resolve(root, "missing", "\0bad")).write("ignored");
});

test("closing before any Studio page loaded closes at once instead of waiting for a save", () => {
  let ready = false, flushes = 0;
  const gate = new DesktopWorkspaceClose({ requestFlush: () => { flushes++; }, close: () => {}, report: () => {},
    rendererReady: () => ready });
  const blank: { response?: { allow: boolean } } = {};
  gate.request(blank);
  expect(blank.response).toBeUndefined();
  expect(flushes).toBe(0);
  ready = true;
  const loaded: { response?: { allow: boolean } } = {};
  gate.request(loaded);
  expect(loaded.response).toEqual({ allow: false });
  expect(flushes).toBe(1);
});

test("the host records when the WebView loads the page and the bootstrap reaches the workspace", async () => {
  const staticRoot = resolve(root, "static");
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(resolve(staticRoot, "index.html"), "<!doctype html><title>Studio</title>");
  const app = createDesktopServer(staticRoot, resolve(root, "data"), { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  const reports: string[] = [];
  app.onReport(message => reports.push(message));
  try {
    expect(app.renderer()).toEqual({ pageServed: false, bootstrapped: false, smoke: null });
    const page = await fetch(app.url);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    expect(app.renderer().pageServed).toBe(true);
    await fetch(`http://127.0.0.1:${app.port}/api/desktop/workspace`, { headers: { Cookie: cookie } });
    expect(app.renderer()).toMatchObject({ pageServed: true, bootstrapped: true });
    expect(reports).toEqual(["WebView requested the Studio page.", "Renderer bootstrap loaded the workspace."]);
  } finally { app.stop(); }
});

describe("missing WebView2 is installed with one consent click", () => {
  const port = (options: { installedAfter: boolean; choose: number[]; bootstrapper?: boolean; initially?: boolean }) => {
    const calls: string[] = [];
    let ran = false;
    const choices = [...options.choose];
    return { calls, port: {
      detect: () => (options.initially || (ran && options.installedAfter))
        ? { installed: true, version: "141.0.1.2", source: "HKCU" } : { installed: false, version: null, source: null },
      ask: async (prompt: { message: string; buttons: string[] }) => { calls.push(`ask:${prompt.buttons[0]}`); return choices.shift() ?? 1; },
      notify: (title: string) => { calls.push(`notify:${title}`); },
      bootstrapperAvailable: () => options.bootstrapper !== false,
      runBootstrapper: async () => { ran = true; calls.push("run"); return 0; },
      openDownloadPage: () => { calls.push("download"); },
      log: () => {},
    } };
  };

  test("an installed runtime asks nothing", async () => {
    const { calls, port: p } = port({ installedAfter: true, choose: [], initially: true });
    expect(await ensureWebView2(p)).toMatchObject({ ready: true, installed: false });
    expect(calls).toEqual([]);
  });
  test("consent runs Microsoft's bootstrapper and continues when the runtime appears", async () => {
    const { calls, port: p } = port({ installedAfter: true, choose: [0] });
    expect(await ensureWebView2(p)).toMatchObject({ ready: true, installed: true, status: { version: "141.0.1.2" } });
    expect(calls).toEqual(["ask:Install it now", "notify:Installing WebView2", "run"]);
  });
  test("declining quits without installing anything", async () => {
    const { calls, port: p } = port({ installedAfter: true, choose: [1] });
    expect(await ensureWebView2(p)).toEqual({ ready: false, reason: "declined" });
    expect(calls).toEqual(["ask:Install it now"]);
  });
  test("a failed install explains it and offers Microsoft's page", async () => {
    const { calls, port: p } = port({ installedAfter: false, choose: [0, 0] });
    expect(await ensureWebView2(p)).toEqual({ ready: false, reason: "failed" });
    expect(calls).toEqual(["ask:Install it now", "notify:Installing WebView2", "run", "ask:Open the Microsoft download page", "download"]);
  });
  test("prompts follow the wording policy", () => {
    for (const text of [WEBVIEW2_PROMPT, WEBVIEW2_FAILED]) expect(USER_FACING_JARGON.test(`${text.message} ${text.detail}`)).toBe(false);
  });
});
