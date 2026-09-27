// The Save Explorer's host side over a temporary folder of synthetic saves (never the person's): the listing (only whitelisted game
// fields, newest first, no user name), the file endpoint's refusals (paths, links, unknown parts), the names endpoint, the origin check,
// and the host sources (the Saved Games folder from the registry or profile, and the script bundles the launch route loads).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavesHandler, describeSave, listSaves } from "../src/features/save-explorer/host/saves-server";
import { cyberpunkSavesFolder, expandEnvironment, savedGamesFromRegistry, SAVES_FOLDER_DISPLAY, savesLocation, scriptBundleCandidates, SHELL_FOLDERS_KEY } from "../src/saves-host-sources";
import { parseSaveListing, parseSaveTypeNames } from "../src/features/save-explorer";
import { scriptBundle } from "./fixtures/synthetic-save";

let root = "", bundle = "";
const engine = { enums: ["gameE"], bitfields: [], classes: ["gameC"], properties: ["p"] };
const metadata = (fields: Record<string, unknown>) => JSON.stringify({ RootType: "handle:saveMetadataContainer", Data: { metadata: fields } });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "xfs-saves-"));
  const save = (folder: string, when: number, meta?: Record<string, unknown>, screenshot = false) => {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, "sav.dat"), new Uint8Array([1, 2, 3, 4]));
    if (meta) writeFileSync(join(root, folder, "metadata.9.json"), metadata(meta));
    if (screenshot) writeFileSync(join(root, folder, "screenshot.png"), new Uint8Array([137, 80, 78, 71]));
    utimesSync(join(root, folder, "sav.dat"), when, when);
  };
  save("ManualSave-1", 1_700_000_000, { locationName: "Watson", level: 6, lifePath: "Nomad", buildPatch: "2.31", saveVersion: 269, isModded: true,
    userName: "someone", playthroughID: "abc", playerPosition: { X: 1, Y: 2, Z: 3 } }, true);
  save("QuickSave-0", 1_800_000_000, { locationName: "Japantown", isPointOfNoReturn: false });
  save("AutoSave-3", 1_600_000_000);
  mkdirSync(join(root, "NotASave"));
  writeFileSync(join(root, "user.gls"), "x");
  bundle = join(root, "final.redscripts");
  writeFileSync(bundle, scriptBundle(["DoorControllerPS", "m_isOpen", "DoorControllerPS"]));
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

const handler = (overrides: { root?: string | null; bundles?: string[] } = {}) => createSavesHandler({
  root: () => overrides.root === undefined ? root : overrides.root, scriptBundles: () => overrides.bundles ?? [bundle], engine: () => engine });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:4318${path}`, { headers });

describe("saves endpoints", () => {
  test("lists saves newest first with only the game's fields; the user name and every other field stay on the host", async () => {
    const response = await handler()(get("/api/saves"));
    const body = await response.json();
    const listing = parseSaveListing(body);
    expect(listing.available).toBe(true);
    expect(listing.saves.map(save => [save.folder, save.kind])).toEqual([["QuickSave-0", "quick"], ["ManualSave-1", "manual"], ["AutoSave-3", "auto"]]);
    expect(listing.saves[1]).toMatchObject({ location: "Watson", level: 6, lifePath: "Nomad", gameVersion: "2.31", saveVersion: 269, screenshot: true, modded: true, bytes: 4 });
    expect(listing.saves[2]).toMatchObject({ location: null, level: null, screenshot: false, modded: null });
    const text = JSON.stringify(body);
    for (const secret of ["someone", "abc", "playerPosition", root]) expect(text).not.toContain(secret);
    expect(describeSave("EndGameSave-2", metadata({ isEndGameSave: true }), new Date(0), 1, false).kind).toBe("end-game");
    expect(describeSave("Odd", "{broken", new Date(0), 1, false)).toMatchObject({ kind: "other", location: null });
    expect(listSaves(join(root, "missing"))).toEqual([]);
  });

  test("serves a listed save's file by folder name; refuses paths, unknown parts and folders that aren't there", async () => {
    const data = await handler()(get("/api/saves/file?save=ManualSave-1&part=data"));
    expect(data.status).toBe(200);
    expect([...new Uint8Array(await data.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect((await handler()(get("/api/saves/file?save=ManualSave-1&part=screenshot"))).headers.get("Content-Type")).toBe("image/png");
    for (const query of ["save=..&part=data", "save=..%2Fx&part=data", "save=a%5Cb&part=data", "save=ManualSave-1&part=metadata", "save=ManualSave-1", "save=ManualSave-1&part=data&x=1"])
      expect((await handler()(get(`/api/saves/file?${query}`))).status, query).toBe(400);
    expect((await handler()(get("/api/saves/file?save=Gone-1&part=data"))).status).toBe(404);
    expect((await handler()(get("/api/saves/file?save=AutoSave-3&part=screenshot"))).status).toBe(404);
  });

  test("names come from the engine list and the first readable script bundle; without one the answer says how to fix it", async () => {
    const names = parseSaveTypeNames(await (await handler()(get("/api/saves/types"))).json());
    expect(names.engine.enums).toEqual(["gameE"]);
    expect(names.scripts).toEqual({ available: true, names: ["DoorControllerPS", "m_isOpen"] });
    const missing = parseSaveTypeNames(await (await handler({ bundles: [join(root, "none.redscripts")] })(get("/api/saves/types"))).json());
    expect(missing.scripts).toMatchObject({ available: false, names: [], reason: expect.stringMatching(/Settings › Game/) });
  });

  test("a saves folder that is itself a link or junction is followed; a linked save folder below it is still refused (SAVE-07)", async () => {
    // A junction on Windows (no rights needed), a directory link elsewhere: Saved Games moved to another drive.
    const outer = mkdtempSync(join(tmpdir(), "xfs-saves-link-")), link = join(outer, "Cyberpunk 2077"), inner = join(root, "Linked-1");
    try {
      symlinkSync(root, link, "junction");
      symlinkSync(join(root, "QuickSave-0"), inner, "junction");
      const listing = parseSaveListing(await (await handler({ root: link })(get("/api/saves"))).json());
      expect(listing.available).toBe(true);
      expect(listing.saves.map(save => save.folder)).toEqual(["QuickSave-0", "ManualSave-1", "AutoSave-3"]);
      const data = await handler({ root: link })(get("/api/saves/file?save=ManualSave-1&part=data"));
      expect([...new Uint8Array(await data.arrayBuffer())]).toEqual([1, 2, 3, 4]);
      expect((await handler({ root: link })(get("/api/saves/file?save=Linked-1&part=data"))).status).toBe(404);
      expect(await (await handler({ root: join(outer, "missing") })(get("/api/saves"))).json()).toMatchObject({ available: false });
    } finally {
      // Links are removed on their own, never through them.
      for (const path of [inner, link]) { try { unlinkSync(path); } catch { try { rmSync(path); } catch { /* gone */ } } }
      rmSync(outer, { recursive: true, force: true });
    }
  });

  test("a host without a saves folder says so plainly; other origins and methods are refused", async () => {
    expect(await (await handler({ root: null })(get("/api/saves"))).json()).toMatchObject({ available: false, saves: [], reason: expect.stringMatching(/Open a save file/) });
    expect((await handler()(get("/api/saves", { Origin: "http://evil.example" }))).status).toBe(403);
    expect((await handler()(new Request("http://localhost:4318/api/saves"))).status).toBe(403);
    expect((await handler()(new Request("http://127.0.0.1:4318/api/saves", { method: "POST" }))).status).toBe(405);
    expect((await handler()(get("/api/saves/other"))).status).toBe(404);
  });
});

describe("saves host sources", () => {
  test("the Saved Games folder: a redirected folder from the registry, else the profile's; the override first; nothing off Windows", async () => {
    const registry = `\r\n${SHELL_FOLDERS_KEY}\r\n    {4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}    REG_EXPAND_SZ    %USERPROFILE%\\Games\\Saved\r\n    Personal    REG_EXPAND_SZ    x\r\n`;
    expect(savedGamesFromRegistry(registry)).toBe("%USERPROFILE%\\Games\\Saved");
    expect(savedGamesFromRegistry("nothing")).toBeNull();
    expect(expandEnvironment("%USERPROFILE%\\x", name => name === "USERPROFILE" ? "D:\\Profile" : undefined)).toBe("D:\\Profile\\x");
    expect(expandEnvironment("%MISSING%\\x", () => undefined)).toBeNull();
    const env = (name: string) => name === "USERPROFILE" ? "D:\\Profile" : undefined;
    expect(await cyberpunkSavesFolder({ platform: "win32", env, registry: async () => registry }))
      .toBe("D:\\Profile\\Games\\Saved\\CD Projekt Red\\Cyberpunk 2077");
    expect(await cyberpunkSavesFolder({ platform: "win32", env, registry: async () => null })).toBe("D:\\Profile\\Saved Games\\CD Projekt Red\\Cyberpunk 2077");
    expect(await cyberpunkSavesFolder({ platform: "win32", env, registry: async () => { throw Error("no reg"); } })).toBe("D:\\Profile\\Saved Games\\CD Projekt Red\\Cyberpunk 2077");
    expect(await cyberpunkSavesFolder({ platform: "linux", env }, undefined)).toBeNull();
    expect(await cyberpunkSavesFolder({ platform: "linux", env }, "/tmp/copies")).toBe("/tmp/copies");
  });

  test("script bundles: the modded bundle before the game's, each from the highest-priority folder that has it", () => {
    const providers = ["overwrite", "modA", "game"];
    const present = new Set([join("modA", "r6", "cache", "final.redscripts.modded"), join("game", "r6", "cache", "final.redscripts.modded"),
      join("game", "r6", "cache", "final.redscripts")]);
    expect(scriptBundleCandidates(providers, path => present.has(path))).toEqual([join("modA", "r6", "cache", "final.redscripts.modded"),
      join("game", "r6", "cache", "final.redscripts")]);
    expect(scriptBundleCandidates([], () => true)).toEqual([]);
  });
});

describe("where saves are read from (UI-109)", () => {
  test("the listing names where it looked; the detected folder is only described; each missing folder says what to do", async () => {
    const display = "Saved Games\\CD Projekt Red\\Cyberpunk 2077";
    const at = (value: { path: string | null; source: "chosen" | "detected" | "developer"; display: string }, prefix?: string) =>
      createSavesHandler({ root: () => value, scriptBundles: () => [bundle], engine: () => engine }, undefined, prefix);
    const found = await (await at({ path: root, source: "detected", display })(get("/api/saves"))).json();
    expect(parseSaveListing(found)).toMatchObject({ available: true, folder: { source: "detected", display } });
    expect(JSON.stringify(found)).not.toContain(root);
    const gone = parseSaveListing(await (await at({ path: join(root, "gone"), source: "chosen", display: join(root, "gone") })(get("/api/saves"))).json());
    expect(gone).toMatchObject({ available: false, folder: { source: "chosen" }, reason: expect.stringMatching(/isn't there any more.*Settings › Saves/) });
    const none = parseSaveListing(await (await at({ path: join(root, "gone"), source: "detected", display })(get("/api/saves"))).json());
    expect(none.reason).toContain(`in ${display}. If you keep them somewhere else, choose that folder in Settings › Saves.`);
    // A verification workspace's mount reads its own sources at its own paths.
    const verification = at({ path: root, source: "chosen", display: root }, "/api/verification/saves");
    expect(parseSaveListing(await (await verification(get("/api/verification/saves"))).json()).saves).toHaveLength(3);
    expect((await verification(get("/api/verification/saves/file?save=ManualSave-1&part=data"))).status).toBe(200);
    expect((await verification(get("/api/saves"))).status).toBe(404);
    // A listing from an older host (no folder) is still read.
    expect(parseSaveListing({ available: true, saves: [] }).folder).toBeUndefined();
    expect(() => parseSaveListing({ available: true, saves: [], folder: { source: "elsewhere", display: "x" } })).toThrow();
  });

  test("the saves folder in effect: the developer override, else the folder chosen in Settings, else the detected one", async () => {
    const env = (name: string) => name === "USERPROFILE" ? "D:\\Profile" : undefined;
    const host = { platform: "win32", env, registry: async () => null };
    expect(await savesLocation(host, { savesDirectory: null })).toEqual({ path: "D:\\Profile\\Saved Games\\CD Projekt Red\\Cyberpunk 2077",
      source: "detected", display: SAVES_FOLDER_DISPLAY });
    expect(SAVES_FOLDER_DISPLAY).toBe("Saved Games\\CD Projekt Red\\Cyberpunk 2077");
    expect(await savesLocation(host, { savesDirectory: "E:\\Saves" })).toEqual({ path: "E:\\Saves", source: "chosen", display: "E:\\Saves" });
    expect(await savesLocation(host, { savesDirectory: "E:\\Saves" }, "/tmp/copies")).toMatchObject({ path: "/tmp/copies", source: "developer" });
    expect(await savesLocation({ platform: "linux", env }, null)).toMatchObject({ path: null, source: "detected" });
  });
});
