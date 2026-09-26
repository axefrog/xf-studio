// A test server, an agent's acceptance run or a verification workspace (?verify) can never reach the person's real settings or
// add a mod to a real mod folder (INSTALL-01, UI-98): settings and receipts follow an isolated data folder, a verification
// workspace edits its own copy of the settings, and neither adds mods.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultLocalSettings } from "../src/local-settings";
import { LocalSettingsStore } from "../src/local-settings-store";
import { localHostState, machineInstallReceiptsRoot } from "../src/host-state";
import { READ_ONLY_TEST_SERVER, READ_ONLY_VERIFICATION } from "../src/mod-install-host";

const LOCAL = "C:\\Users\\someone\\AppData\\Local";

test("settings and install receipts follow an isolated data or settings folder, and an isolated server doesn't add mods", () => {
  const real = localHostState("D:\\studio\\data", { LOCALAPPDATA: LOCAL }, "win32");
  expect(real).toEqual({ dataRoot: resolve("D:\\studio\\data"), settingsDirectory: resolve(LOCAL, "XF Studio"),
    installReceipts: resolve(LOCAL, "XF Studio", "install-receipts"), legacyInstallReceipts: [resolve("D:\\studio\\data", "install-receipts")],
    isolated: false, installs: true });
  expect(real.installReceipts).toBe(machineInstallReceiptsRoot({ LOCALAPPDATA: LOCAL }, "win32"));
  const data = localHostState("D:\\studio\\data", { LOCALAPPDATA: LOCAL, XFAS_DATA_DIR: "E:\\scratch\\data" }, "win32");
  expect(data).toMatchObject({ dataRoot: resolve("E:\\scratch\\data"), settingsDirectory: resolve("E:\\scratch\\data"),
    installReceipts: resolve("E:\\scratch\\data", "install-receipts"), legacyInstallReceipts: [], isolated: true, installs: false });
  const settings = localHostState("D:\\studio\\data", { LOCALAPPDATA: LOCAL, XFS_SETTINGS_DIR: "E:\\scratch\\settings", XFS_MOD_INSTALL: "on" }, "win32");
  expect(settings).toMatchObject({ settingsDirectory: resolve("E:\\scratch\\settings"), installReceipts: resolve("E:\\scratch\\settings", "install-receipts"),
    isolated: true, installs: true });
  for (const state of [data, settings]) expect(JSON.stringify(state)).not.toContain(JSON.stringify(LOCAL).slice(1, -1));
  expect(localHostState("D:\\studio\\data", { LOCALAPPDATA: LOCAL, XFS_MOD_INSTALL: "off" }, "win32").installs).toBe(false);
});

test("a verification store starts from the host's settings and keeps every change to itself", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-verify-settings-"));
  try {
    const host = new LocalSettingsStore(join(root, "host"));
    host.save({ ...defaultLocalSettings(), gameRoot: "E:\\Games\\Cyberpunk 2077" }, 0);
    const verification = new LocalSettingsStore(join(root, "verify"), { seed: () => host.load().settings });
    expect(verification.load()).toMatchObject({ source: "new", settings: { gameRoot: "E:\\Games\\Cyberpunk 2077", revision: 1 } });
    verification.save({ ...verification.load().settings, gameRoot: "F:\\Elsewhere", launchRoute: "mo2" }, 1);
    expect(verification.load().settings).toMatchObject({ gameRoot: "F:\\Elsewhere", launchRoute: "mo2", revision: 2 });
    expect(host.load().settings).toMatchObject({ gameRoot: "E:\\Games\\Cyberpunk 2077", launchRoute: "direct", revision: 1 });
    // A seed that can't be read starts from the defaults.
    expect(new LocalSettingsStore(join(root, "other"), { seed: () => { throw Error("unreadable"); } }).load().settings.gameRoot).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const freePort = () => new Promise<number>((ok, fail) => {
  const probe = createServer();
  probe.once("error", fail);
  probe.listen(0, "127.0.0.1", () => { const port = (probe.address() as { port: number }).port; probe.close(() => ok(port)); });
});

test("an isolated localhost server never touches the real settings folder, and neither it nor ?verify adds a mod", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-isolated-server-"));
  // A stand-in for the person's real %LOCALAPPDATA% (and its non-Windows equivalents): it must stay empty.
  const local = join(root, "local"), data = join(root, "data");
  mkdirSync(local); mkdirSync(data);
  const port = await freePort();
  const server = Bun.spawn(["bun", "server.ts"], { cwd: resolve(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, LOCALAPPDATA: local, XDG_CONFIG_HOME: local, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "" } });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 240; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ }
      await Bun.sleep(250);
    }
    const headers = { Origin: base, "Content-Type": "application/json" };
    const patch = (path: string, revision: number, fields: object) => fetch(base + path, { method: "PATCH", headers, body: JSON.stringify({ revision, fields }) });
    expect((await patch("/api/local-settings", 0, { launchRoute: "mo2", gameRoot: "E:\\Games\\Cyberpunk 2077" })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(data, "settings.json"), "utf8"))).toMatchObject({ launchRoute: "mo2", gameRoot: "E:\\Games\\Cyberpunk 2077" });
    // ?verify edits its own copy, which starts from the server's.
    const verification = await (await fetch(`${base}/api/verification/local-settings`)).json();
    expect(verification).toMatchObject({ revision: 1, fields: { launchRoute: "mo2", gameRoot: "E:\\Games\\Cyberpunk 2077" } });
    expect((await patch("/api/verification/local-settings", 1, { gameRoot: "F:\\Test game" })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(data, "settings.json"), "utf8")).gameRoot).toBe("E:\\Games\\Cyberpunk 2077");
    expect(JSON.parse(readFileSync(join(data, "verification-settings", "settings.json"), "utf8")).gameRoot).toBe("F:\\Test game");
    // Neither adds a mod, whatever the page sends.
    const install = (path: string) => fetch(base + path, { method: "POST", headers, body: JSON.stringify({ action: "install", candidateId: "any", token: "t" }) });
    const refused = await install("/api/mod-install");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ code: "install_unavailable", error: READ_ONLY_TEST_SERVER });
    expect(await (await install("/api/verification/mod-install")).json()).toEqual({ code: "install_unavailable", error: READ_ONLY_VERIFICATION });
    expect(readdirSync(local).filter(name => /xf.?studio/i.test(name))).toEqual([]);
    expect(existsSync(join(data, "install-receipts"))).toBe(false);
  } finally {
    server.kill();
    await server.exited;
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
