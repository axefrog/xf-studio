// "Get the desktop app" (localhost only): the catalogue entry, the application actions, the read-only detection over a fake host
// (no registry, file system or process is touched) and the endpoint that starts only a confirmed setup or the installed app.
import { describe, expect, test } from "bun:test";
import { join, win32 } from "node:path";
import { DesktopAppActions, type DesktopAppStatus, type DesktopAppTransport } from "../src/desktop-app";
import { createDesktopAppHandler, detectDesktopApp, launchCommand, parseRegQuery, UNINSTALL_ROOT, type DesktopAppHostPort } from "../src/desktop-app-host";
import { DESKTOP_APP_DESCRIPTORS } from "../src/studio-action-descriptors";
import { desktopAppEntry, installerSummary } from "../src/studio-ui/guidance/desktop-app-sheet";
import { USER_FACING_JARGON } from "../src/alpha-availability";

const LOCAL = "C:\\Users\\someone\\AppData\\Local";
const APP = win32.join(LOCAL, "dev.axefrog.xf-studio", "canary", "app");
const LAUNCHER = win32.join(APP, "bin", "launcher.exe");
const KEY = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\dev.axefrog.xf-studio-canary";
const DESKTOP = join("checkout", "desktop");
const SITE = join("checkout", "site", "site.config.json");

type Fake = { platform?: string; registry?: Record<string, string>; files?: Record<string, string>; folders?: Record<string, { name: string; bytes: number; mtimeMs: number }[]> };
function fakeHost(fake: Fake): DesktopAppHostPort & { queries: string[][] } {
  const queries: string[][] = [];
  return { queries, platform: fake.platform ?? "win32", env: name => name === "LOCALAPPDATA" ? LOCAL : undefined,
    regQuery: async args => { queries.push([...args]); return fake.registry?.[args.join(" ")] ?? null; },
    isFile: path => Object.hasOwn(fake.files ?? {}, path), readText: path => fake.files?.[path] ?? null,
    listFiles: folder => fake.folders?.[folder] ?? null };
}
const search = [UNINSTALL_ROOT, "/s", "/f", "dev.axefrog.xf-studio", "/d"].join(" ");
const entry = (values: Record<string, string>) => `\r\n${KEY}\r\n${Object.entries(values).map(([name, value]) => `    ${name}    REG_SZ    ${value}`).join("\r\n")}\r\n\r\n`;
const installedFake: Fake = {
  registry: { [search]: entry({ InstallLocation: APP }) + "End of search: 1 match(es) found.\r\n",
    [KEY]: entry({ DisplayName: "XF Studio", DisplayVersion: "0.1.0-alpha.1", InstallLocation: APP, UninstallString: `"${win32.join(LOCAL, "dev.axefrog.xf-studio", "canary", "uninstall.exe")}"` }) },
  files: { [LAUNCHER]: "", [win32.join(APP, "Resources", "version.json")]: JSON.stringify({ version: "0.1.0-alpha.2" }) },
};
const setupAt = (name: string, mtimeMs: number, bytes = 43_932_863) => ({ name, bytes, mtimeMs });

describe("catalogue and actions", () => {
  test("the three actions are catalogued host requests: one read, two launches, the install naming the setup it confirms", () => {
    expect(DESKTOP_APP_DESCRIPTORS).toEqual({
      "desktopApp.refresh": { scope: ["host"], effect: "read", payload: {}, async: true, cancellable: false },
      "desktopApp.install": { scope: ["host"], effect: "launch", payload: { installer: { type: "string", required: true, from: "target" } }, async: true, cancellable: false },
      "desktopApp.open": { scope: ["host"], effect: "launch", payload: {}, async: true, cancellable: false },
    });
    expect(new DesktopAppActions(null).descriptors()).toEqual(DESKTOP_APP_DESCRIPTORS);
  });

  test("without a host offer (the desktop app itself) nothing is offered and every action explains itself", async () => {
    const actions = new DesktopAppActions(null);
    expect(actions.offered()).toBe(false);
    for (const action of [{ kind: "desktopApp.refresh" }, { kind: "desktopApp.open" }, { kind: "desktopApp.install", installer: "x" }] as const)
      expect(actions.capability(action)).toEqual({ available: false, code: "unavailable", reason: "You're already in the XF Studio desktop app." });
    expect(await actions.dispatch({ kind: "desktopApp.open" })).toMatchObject({ ok: false, code: "unavailable" });
  });

  test("refresh publishes the host's status; install sends exactly the setup ID shown; a changed setup is refused and looked up again", async () => {
    const status = async (patch: Partial<DesktopAppStatus> = {}) => (await detectDesktopApp(fakeHost({
      folders: { [join(DESKTOP, "artifacts")]: [setupAt("canary-win-x64-XFStudio-Setup-canary.exe", Date.UTC(2026, 8, 27, 10))] } }), { desktopRoot: DESKTOP, siteConfig: SITE })).status;
    const current = await status();
    const sent: unknown[] = [];
    let answer: { ok: boolean; status: number; data: unknown } = { ok: true, status: 200, data: { message: "The XF Studio setup is open." } };
    const transport: DesktopAppTransport = { status: async () => ({ ok: true, status: 200, data: current }), launch: async body => { sent.push(body); return answer; } };
    const actions = new DesktopAppActions(transport);
    let notified = 0; actions.subscribe(() => notified++);
    expect(actions.capability({ kind: "desktopApp.install", installer: current.installer!.id })).toMatchObject({ available: false, code: "needs_input" });
    expect(await actions.dispatch({ kind: "desktopApp.refresh" })).toEqual({ ok: true, message: "" });
    expect(actions.snapshot().status).toEqual(current);
    (actions.snapshot().status as DesktopAppStatus).installer = null;
    expect(actions.snapshot().status?.installer).not.toBeNull();
    expect(actions.capability({ kind: "desktopApp.open" })).toMatchObject({ available: false, reason: "The desktop app isn't installed yet." });
    expect(actions.capability({ kind: "desktopApp.install", installer: "other" })).toMatchObject({ available: false, code: "stale" });
    expect(await actions.dispatch({ kind: "desktopApp.install", installer: current.installer!.id })).toEqual({ ok: true, message: "The XF Studio setup is open." });
    expect(sent).toEqual([{ action: "install", installer: current.installer!.id }]);
    expect(actions.snapshot().outcome).toEqual({ kind: "desktopApp.install", ok: true, message: "The XF Studio setup is open." });
    answer = { ok: false, status: 409, data: { code: "stale", error: "The setup changed since it was shown. Check it again before you run it." } };
    expect(await actions.dispatch({ kind: "desktopApp.install", installer: current.installer!.id })).toMatchObject({ ok: false, code: "stale" });
    expect(actions.snapshot().busy).toBeNull();
    expect(notified).toBeGreaterThan(4);
  });

  test("a test workspace or test copy reports why it won't start anything, before any click", async () => {
    const found = (await detectDesktopApp(fakeHost(installedFake), { desktopRoot: DESKTOP, siteConfig: SITE })).status;
    const reason = "This is a test workspace, so XF Studio doesn't start setups or apps from it. Open XF Studio normally to do this.";
    const actions = new DesktopAppActions({ status: async () => ({ ok: true, status: 200, data: { ...found, launch: { allowed: false, reason } } }),
      launch: async () => { throw Error("never"); } });
    await actions.dispatch({ kind: "desktopApp.refresh" });
    expect(actions.capability({ kind: "desktopApp.open" })).toEqual({ available: false, code: "unavailable", reason });
    expect(USER_FACING_JARGON.test(reason)).toBe(false);
  });

  test("an unreachable host or an unexpected answer says so plainly and keeps the last status", async () => {
    const actions = new DesktopAppActions({ status: async () => ({ ok: true, status: 200, data: { schema: "other" } }), launch: async () => { throw Error("offline"); } });
    expect(await actions.dispatch({ kind: "desktopApp.refresh" })).toMatchObject({ ok: false, code: "transport" });
    expect(actions.snapshot()).toMatchObject({ busy: null, status: null, error: "XF Studio couldn't check for the desktop app just now. Try again in a moment." });
  });
});

describe("detection (read-only, over a fake host)", () => {
  test("reg query output parses into keys and values, value names with spaces included", () => {
    const parsed = parseRegQuery(`\r\n${KEY}\r\n    DisplayName    REG_SZ    XF Studio\r\n    Quiet Uninstall String    REG_SZ    "x.exe" --quiet\r\n    NoModify    REG_DWORD    0x1\r\n\r\nEnd of search: 3 match(es) found.\r\n`);
    expect([...parsed.get(KEY)!]).toEqual([["DisplayName", "XF Studio"], ["Quiet Uninstall String", `"x.exe" --quiet`], ["NoModify", "0x1"]]);
  });

  test("the uninstall entry under the pinned identity: installed, its channel, the packaged version and its program", async () => {
    const host = fakeHost(installedFake);
    const found = await detectDesktopApp(host, { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(found.status.installed).toEqual({ version: "0.1.0-alpha.2", channel: "canary", registered: true, canOpen: true });
    expect(found.launcher).toBe(LAUNCHER);
    // Only `reg query` with fixed arguments: the search, then the key it found.
    expect(host.queries).toEqual([[UNINSTALL_ROOT, "/s", "/f", "dev.axefrog.xf-studio", "/d"], [KEY]]);
  });

  test("trial and development identities (and paths outside the identity) are not the app; the folder alone still counts", async () => {
    const trial = win32.join(LOCAL, "dev.axefrog.xf-studio-ui-trial-sep25", "canary", "app");
    const trialKey = KEY.replace(/[^\\]+$/, "trial");
    const host = fakeHost({ registry: { [search]: `\r\n${trialKey}\r\n    InstallLocation    REG_SZ    ${trial}\r\n`, [trialKey]: `\r\n${trialKey}\r\n    InstallLocation    REG_SZ    ${trial}\r\n` },
      files: { [win32.join(trial, "bin", "launcher.exe")]: "" } });
    expect((await detectDesktopApp(host, { desktopRoot: DESKTOP, siteConfig: SITE })).status.installed).toBeNull();
    const folderOnly = fakeHost({ files: { [LAUNCHER]: "" } });
    const found = await detectDesktopApp(folderOnly, { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(found.status.installed).toEqual({ version: null, channel: "canary", registered: false, canOpen: true });
  });

  test("an entry whose program is gone is installed but can't be opened", async () => {
    const found = await detectDesktopApp(fakeHost({ ...installedFake, files: {} }), { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(found.status.installed).toEqual({ version: "0.1.0-alpha.1", channel: "canary", registered: true, canOpen: false });
    expect(found.launcher).toBeNull();
  });

  test("an install that lives only in a Microsoft Store app's private storage is not installed for Windows", async () => {
    // A setup started from inside such an app (27 September: a development server started by one) lands in its LocalCache.
    const packaged = win32.join(LOCAL, "Packages", "SomeApp_abc123", "LocalCache", "Local", "dev.axefrog.xf-studio", "canary", "app", "bin", "launcher.exe");
    const folderOnly: Fake = { files: installedFake.files };
    const withPhysical = (fake: Fake, where: (path: string) => string | null) => ({ ...fakeHost(fake), physicalPath: where });
    const privateCopy = await detectDesktopApp(withPhysical(folderOnly, path => path === LAUNCHER ? packaged : path), { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(privateCopy.status.installed).toBeNull();
    expect(privateCopy.launcher).toBeNull();
    // The same folder on disk (letter case aside), or no answer from the file system: installed as before.
    const real = await detectDesktopApp(withPhysical(folderOnly, path => path.toUpperCase()), { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(real.launcher).toBe(LAUNCHER);
    const unknown = await detectDesktopApp(withPhysical(folderOnly, () => null), { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(unknown.launcher).toBe(LAUNCHER);
  });

  test("setups and the app start through File Explorer on Windows, as a double-click would (outside any app's private storage)", () => {
    const setup = "D:\\checkout\\desktop\\artifacts\\canary-win-x64-XFStudio-Setup-canary.exe";
    expect(launchCommand(setup, "win32", { SystemRoot: "C:\\Windows" }))
      .toEqual({ command: "C:\\Windows\\explorer.exe", args: [setup], cwd: "D:\\checkout\\desktop\\artifacts" });
    // Explorer splits a path at commas: such a path is started directly.
    expect(launchCommand("D:\\a, b\\setup.exe", "win32", { SystemRoot: "C:\\Windows" })).toEqual({ command: "D:\\a, b\\setup.exe", args: [], cwd: "D:\\a, b" });
    expect(launchCommand("/opt/xf/setup", "linux", {})).toEqual({ command: "/opt/xf/setup", args: [], cwd: "/opt/xf" });
  });

  test("the newest setup built in this checkout (the canary build or a staged release asset); other files are ignored", async () => {
    const found = await detectDesktopApp(fakeHost({ folders: {
      [join(DESKTOP, "artifacts")]: [setupAt("canary-win-x64-XFStudio-Setup-canary.exe", 100), setupAt("canary-win-x64-XFStudioUITrial-Setup-canary.zip", 900),
        setupAt("canary-win-x64-XFStudio-Setup-canary.zip", 800), setupAt("notes.exe", 950)],
      [join(DESKTOP, "artifacts", "release")]: [setupAt("XFStudio-0.1.0-alpha.1-win-x64-setup.exe", 200, 40_275_876)] } }), { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(found.status.installer).toEqual({ id: "XFStudio-0.1.0-alpha.1-win-x64-setup.exe:40275876:200", name: "XFStudio-0.1.0-alpha.1-win-x64-setup.exe",
      bytes: 40_275_876, builtAt: new Date(200).toISOString() });
    expect(found.installerPath).toBe(join(DESKTOP, "artifacts", "release", "XFStudio-0.1.0-alpha.1-win-x64-setup.exe"));
    expect(found.status.build).toEqual({ command: "bun run build:installer", folder: "projects/xf-studio/authoring/desktop", output: "projects/xf-studio/authoring/desktop/artifacts" });
  });

  test("the releases page is offered only once the site says a release is published", async () => {
    const release = (config: unknown) => detectDesktopApp(fakeHost({ files: { [SITE]: JSON.stringify(config) } }), { desktopRoot: DESKTOP, siteConfig: SITE }).then(found => found.status.release);
    expect(await release({ releaseStatus: "unreleased", release: null })).toBeNull();
    expect(await release({ releaseStatus: "prerelease", release: { tag: "v0.1.0-alpha.1", title: "XF Studio 0.1.0 alpha 1" } })).toEqual({ tag: "v0.1.0-alpha.1", title: "XF Studio 0.1.0 alpha 1" });
    expect(await detectDesktopApp(fakeHost({ files: { [SITE]: "{" } }), { desktopRoot: DESKTOP, siteConfig: SITE }).then(found => found.status.release)).toBeNull();
  });

  test("off Windows: build instructions only, nothing looked up", async () => {
    const host = fakeHost({ ...installedFake, platform: "linux", folders: { [join(DESKTOP, "artifacts")]: [setupAt("canary-win-x64-XFStudio-Setup-canary.exe", 1)] } });
    const found = await detectDesktopApp(host, { desktopRoot: DESKTOP, siteConfig: SITE });
    expect(found.status).toMatchObject({ platform: "other", installed: null, installer: null });
    expect(host.queries).toEqual([]);
    const actions = new DesktopAppActions({ status: async () => ({ ok: true, status: 200, data: found.status }), launch: async () => { throw Error("never"); } });
    await actions.dispatch({ kind: "desktopApp.refresh" });
    expect(actions.capability({ kind: "desktopApp.open" })).toMatchObject({ available: false, reason: "The XF Studio desktop app is for Windows." });
    expect(desktopAppEntry(actions.snapshot())).toEqual({ label: "Get the desktop app…", opens: false, detail: "The desktop app is for Windows: how to build it." });
  });
});

describe("endpoint", () => {
  const url = "http://127.0.0.1:4400/api/desktop-app";
  const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST",
    headers: { Origin: "http://127.0.0.1:4400", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const setup = setupAt("canary-win-x64-XFStudio-Setup-canary.exe", 5000);
  const detect = () => detectDesktopApp(fakeHost({ ...installedFake, folders: { [join(DESKTOP, "artifacts")]: [setup] } }), { desktopRoot: DESKTOP, siteConfig: SITE });
  const id = `${setup.name}:${setup.bytes}:5000`;

  test("GET answers the status; other origins, hosts and query strings are refused", async () => {
    const handler = createDesktopAppHandler({ detect, launch: () => { throw Error("never"); } });
    const status = await (await handler(new Request(url))).json() as DesktopAppStatus;
    expect(status).toMatchObject({ schema: "xfs/desktop-app-status-1", platform: "windows", installer: { id }, launch: { allowed: true } });
    expect((await handler(new Request(url, { headers: { Origin: "https://example.com" } }))).status).toBe(403);
    expect((await handler(new Request("http://localhost:4400/api/desktop-app"))).status).toBe(403);
    expect((await handler(new Request(`${url}?path=C:\\x.exe`))).status).toBe(400);
  });

  test("POST starts only the confirmed setup or the installed app, never a path from the request", async () => {
    const launched: string[] = [];
    const handler = createDesktopAppHandler({ detect, launch: path => { launched.push(path); return true; } });
    const ok = await handler(post({ action: "install", installer: id }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ message: "The XF Studio setup is open. Choose Install in its window; XF Studio opens by itself when it's done." });
    expect((await handler(post({ action: "open" }))).status).toBe(200);
    expect(launched).toEqual([join(DESKTOP, "artifacts", setup.name), LAUNCHER]);
    // A setup that isn't the one shown, extra fields, a path, a missing origin or a non-JSON body: nothing starts.
    expect((await handler(post({ action: "install", installer: "other:1:1" }))).status).toBe(409);
    for (const body of [{ action: "install" }, { action: "open", path: "C:\\x.exe" }, { action: "run", installer: id }, [], "open"])
      expect((await handler(post(body))).status).toBe(400);
    expect((await handler(post({ action: "open" }, { Origin: "" }))).status).toBe(403);
    expect((await handler(post({ action: "open" }, { "Content-Type": "text/plain" }))).status).toBe(403);
    expect((await handler(new Request(url, { method: "DELETE", headers: { Origin: "http://127.0.0.1:4400" } }))).status).toBe(405);
    expect(launched).toHaveLength(2);
  });

  test("a read-only Studio (verification workspace, test copy) reports it in the status and starts nothing", async () => {
    const reason = "This copy of XF Studio runs with its own test settings, so it doesn't start setups or apps. Open XF Studio normally to do this.";
    const handler = createDesktopAppHandler({ detect, readOnly: reason, launch: () => { throw Error("never"); } });
    expect(await (await handler(new Request(url))).json()).toMatchObject({ launch: { allowed: false, reason } });
    const refused = await handler(post({ action: "open" }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "read_only", error: reason });
  });

  test("nothing to start: a plain reason with the one next step", async () => {
    const handler = createDesktopAppHandler({ detect: () => detectDesktopApp(fakeHost({}), { desktopRoot: DESKTOP, siteConfig: SITE }), launch: () => true });
    const missing = await handler(post({ action: "install", installer: id }));
    expect(missing.status).toBe(404);
    expect((await missing.json() as { error: string }).error).toBe("There's no setup built here yet. Run bun run build:installer in projects/xf-studio/authoring/desktop first.");
    expect((await handler(post({ action: "open" }))).status).toBe(404);
  });
});

describe("presentation wording", () => {
  test("the Help entry opens the installed app, or offers to get it", async () => {
    const installed = (await detectDesktopApp(fakeHost(installedFake), { desktopRoot: DESKTOP, siteConfig: SITE })).status;
    expect(desktopAppEntry({ busy: null, status: installed, outcome: null, error: null }))
      .toEqual({ label: "Open the desktop app", opens: true, detail: "XF Studio 0.1.0-alpha.2 is installed on this computer as a Windows app." });
    expect(desktopAppEntry({ busy: null, status: null, outcome: null, error: null }))
      .toEqual({ label: "Get the desktop app…", opens: false, detail: "XF Studio as a Windows app: how to get it." });
  });

  test("a built setup is named by file, size and when it was built", () => {
    const now = new Date(2026, 8, 27, 12, 0);
    const summary = installerSummary({ id: "x", name: "canary-win-x64-XFStudio-Setup-canary.exe", bytes: 43_932_863, builtAt: new Date(2026, 8, 27, 11, 1).toISOString() }, now);
    expect(summary).toStartWith("canary-win-x64-XFStudio-Setup-canary.exe, 42 MB, built today at ");
    expect(installerSummary({ id: "x", name: "a.exe", bytes: 10, builtAt: new Date(2026, 8, 20, 9, 0).toISOString() }, now)).toContain("1 MB, built ");
  });
});
