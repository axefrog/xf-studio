/**
 * The host side of the Save Explorer (research/save/save-editor-design.md phase 1): read-only endpoints both hosts mount (the localhost
 * server and the desktop app), over the player's own Saved Games folder and installed scripts.
 *
 * - `GET /api/saves`: the saves, newest first, each described from its own `metadata.*.json` by a fixed list of game fields (type,
 *   location, level, life path, game version, when). The platform user name, play-through ID and every other field are never sent.
 * - `GET /api/saves/file?save=<folder>&part=data|screenshot`: one save's `sav.dat` or `screenshot.png`, by folder name only.
 * - `GET /api/saves/types`: candidate names for the hashes a save stores: the engine's type list the Studio ships and the names the
 *   installed `final.redscripts` defines (read-only labels; the bundle is read, never written).
 *
 * The saves folder is the host's (`SavesHostSources.root`): the folder chosen in Settings › Saves, else the detected Saved Games folder, which
 * a listing names only as described (`folder`), never by its path. A verification workspace's copy is mounted at `/api/verification/saves`.
 *
 * Nothing here writes. Paths never leave the host: a save is named by its folder name, which must be a plain child folder of the saves
 * folder (no links, no separators), and files are read by bounded, link-refusing reads. Logs name saves by folder only. The saves folder
 * itself is the host's own finding, so it is resolved once per request, a link or junction at it followed (Saved Games moved to another
 * drive; SAVE-07); links below it are still refused.
 */
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { readScriptBundleNames } from "../../../engines/red-object/script-bundle";
import type { EngineTypes } from "../../../engines/red-object/type-oracle";
import { SAVE_KINDS, type SaveKind, type SaveListing, type SaveListingResult, type SavesFolderSource, type SaveTypeNames } from "../listing";

/**
 * The saves folder in effect and how a person would name it: the folder they chose in Settings, the detected Saved Games folder
 * (described, never its path), or a developer's override. Only `display` and `source` reach the page.
 */
export type SavesRoot = { path: string | null; source: SavesFolderSource; display: string };
/** Where the saves are, and the script bundles to read names from (the first readable one wins), resolved by the host per request. */
export type SavesHostSources = {
  /** The saves folder: a `SavesRoot`, or a bare path (null when it can't be found). */
  root(): Promise<SavesRoot | string | null> | SavesRoot | string | null;
  /** Candidate `final.redscripts` paths, most effective first (an MO2 overwrite before the game folder). */
  scriptBundles(): readonly string[];
  /** The shipped engine type list. */
  engine(): EngineTypes;
};

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const FOLDER = /^[A-Za-z0-9 _.()\-]{1,128}$/;
const MAX_SAVE = 128 * 1024 * 1024, MAX_SCREENSHOT = 16 * 1024 * 1024, MAX_METADATA = 1024 * 1024, MAX_BUNDLE = 256 * 1024 * 1024;
const PREFIXES: readonly [string, SaveKind][] = [["ManualSave", "manual"], ["QuickSave", "quick"], ["AutoSave", "auto"],
  ["PointOfNoReturnSave", "point-of-no-return"], ["EndGameSave", "end-game"]];

/** A regular file's bytes (no links, bounded), or null. */
function readFile(path: string, max: number): Uint8Array<ArrayBuffer> | null {
  let fd: number | undefined;
  try {
    const link = lstatSync(path);
    if (!link.isFile() || link.isSymbolicLink() || link.size > max) return null;
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (stat.size > max) return null;
    const out = new Uint8Array(stat.size);
    let read = 0;
    while (read < out.length) { const n = readSync(fd, out, read, out.length - read, read); if (n === 0) break; read += n; }
    return read === out.length ? out : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
const isDirectory = (path: string) => { try { const s = lstatSync(path); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } };
/** The saves folder the host found, with a link or junction at it followed, or null when it isn't a folder. */
export function resolveSavesRoot(root: string | null): string | null {
  if (!root) return null;
  try { const real = realpathSync.native(root); return statSync(real).isDirectory() ? real : null; } catch { return null; }
}
const fileInfo = (path: string) => { try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() ? s : null; } catch { return null; } };

/** The game's fields a listing shows, from a save's metadata; anything else (the user name above all) is dropped here. */
export function describeSave(folder: string, metadataText: string | null, savedAt: Date, bytes: number, screenshot: boolean): SaveListing {
  let meta: Record<string, unknown> = {};
  try {
    const parsed = metadataText ? JSON.parse(metadataText) as { Data?: { metadata?: Record<string, unknown> } } : null;
    if (parsed?.Data?.metadata && typeof parsed.Data.metadata === "object") meta = parsed.Data.metadata;
  } catch { meta = {}; }
  const text = (key: string, max = 128) => typeof meta[key] === "string" && (meta[key] as string).length <= max ? meta[key] as string : null;
  const number = (key: string) => typeof meta[key] === "number" && Number.isFinite(meta[key]) ? meta[key] as number : null;
  const prefix = PREFIXES.find(([name]) => folder.startsWith(name));
  const kind: SaveKind = meta.isPointOfNoReturn === true ? "point-of-no-return" : meta.isEndGameSave === true ? "end-game" : prefix?.[1] ?? "other";
  // A location still spelled as a localisation key (`LocKey#10963`) isn't a name a person can read: it is left out.
  const location = text("locationName");
  return { folder, kind, savedAt: savedAt.toISOString(), location: location && !/^LocKey#/i.test(location) ? location : null, level: number("level"), lifePath: text("lifePath", 32),
    gameVersion: text("buildPatch", 16), saveVersion: number("saveVersion"), bytes, screenshot,
    modded: typeof meta.isModded === "boolean" ? meta.isModded : null };
}

/** Every save in `root`: folders holding a `sav.dat`, newest first. */
export function listSaves(root: string): SaveListing[] {
  let names: string[];
  try { names = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { return []; }
  const out: SaveListing[] = [];
  for (const folder of names) {
    if (!FOLDER.test(folder) || folder === "." || folder === "..") continue;
    const dir = join(root, folder);
    if (!isDirectory(dir)) continue;
    const data = fileInfo(join(dir, "sav.dat"));
    if (!data) continue;
    let metadata: string | null = null;
    try {
      const file = readdirSync(dir).find(name => /^metadata\.\d+\.json$/.test(name));
      const bytes = file ? readFile(join(dir, file), MAX_METADATA) : null;
      metadata = bytes ? new TextDecoder().decode(bytes) : null;
    } catch { metadata = null; }
    out.push(describeSave(folder, metadata, data.mtime, data.size, !!fileInfo(join(dir, "screenshot.png"))));
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.folder.localeCompare(b.folder));
}

/** Why no saves could be listed, in the person's words, with the one next step (Settings › Saves, or a single file). */
function unavailableReason(root: SavesRoot): string {
  if (root.source === "chosen") return "The saves folder you chose isn't there any more. Choose it again in Settings › Saves, or use the detected folder.";
  if (root.source === "developer") return "The folder XFS_SAVES_DIR names isn't there. Fix it, or unset it to use your own saves.";
  if (root.path) return `XF Studio couldn't find your Cyberpunk 2077 saves in ${root.display}. If you keep them somewhere else, choose that folder in Settings › Saves.`;
  return "XF Studio couldn't find your Cyberpunk 2077 saves folder. Choose it in Settings › Saves, or open a save with Open a save file…";
}

/**
 * `log` takes one plain line (the host's area logger); lines name saves by folder only, never a path. `prefix` is where the handler is
 * mounted: `/api/saves`, or a verification workspace's `/api/verification/saves`, whose sources read its own settings (UI-98).
 */
export function createSavesHandler(sources: SavesHostSources, log?: (message: string) => void, prefix = "/api/saves") {
  let names: { key: string; value: SaveTypeNames["scripts"] } | null = null;
  const scriptNames = (): SaveTypeNames["scripts"] => {
    for (const path of sources.scriptBundles()) {
      const info = fileInfo(path);
      if (!info) continue;
      const key = `${path}|${info.size}|${info.mtimeMs}`;
      if (names?.key === key) return names.value;
      const bytes = readFile(path, MAX_BUNDLE);
      if (!bytes) continue;
      try {
        const value = { available: true as const, names: [...new Set(readScriptBundleNames(bytes))] };
        names = { key, value };
        return value;
      } catch (error) {
        log?.(`A compiled script bundle couldn't be read: ${error instanceof Error ? error.message : "unknown layout"}`);
      }
    }
    return { available: false, names: [], reason: "XF Studio couldn't find your game's compiled scripts, so some names show as numbers. Choose your game folder in Settings › Game." };
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to read saves." }, 403);
    if (request.method !== "GET") return json({ code: "method", error: "Method not allowed." }, 405);
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : null;
    if (path === "/types") {
      const engine = sources.engine();
      const value: SaveTypeNames = { engine: { enums: [...engine.enums], bitfields: [...engine.bitfields], classes: [...engine.classes],
        properties: [...engine.properties] }, scripts: scriptNames() };
      return json(value);
    }
    let found: SavesRoot;
    try {
      const value = await sources.root();
      found = value && typeof value === "object" ? value : { path: value ?? null, source: "detected", display: "your saves folder" };
    } catch { found = { path: null, source: "detected", display: "your saves folder" }; }
    // The folder found (or chosen) is resolved once, a link or junction at it followed (SAVE-07); links below it are still refused.
    const root = resolveSavesRoot(found.path);
    if (path === "") {
      const folder = { source: found.source, display: found.display };
      if (!root) {
        const result: SaveListingResult = { available: false, saves: [], reason: unavailableReason(found), folder };
        return json(result);
      }
      const result: SaveListingResult = { available: true, saves: listSaves(root), folder };
      return json(result);
    }
    if (path === "/file") {
      const folder = url.searchParams.get("save") ?? "", part = url.searchParams.get("part");
      if (!FOLDER.test(folder) || folder === "." || folder === ".." || (part !== "data" && part !== "screenshot") || [...url.searchParams.keys()].length !== 2)
        return json({ code: "invalid_value", error: "Choose a save from the list." }, 400);
      if (!root || !isDirectory(join(root, folder))) return json({ code: "missing_target", error: "That save isn't in your saves folder any more." }, 404);
      const bytes = readFile(join(root, folder, part === "data" ? "sav.dat" : "screenshot.png"), part === "data" ? MAX_SAVE : MAX_SCREENSHOT);
      if (!bytes) return json({ code: "missing_target", error: "That save's file couldn't be read. Try again, or choose another save." }, 404);
      log?.(`Read save ${folder} (${part === "data" ? "sav.dat" : "screenshot"}).`);
      return new Response(bytes, { headers: { "Content-Type": part === "data" ? "application/octet-stream" : "image/png", "Cache-Control": "no-store" } });
    }
    return json({ code: "not_found", error: "Not found." }, 404);
  };
}

/** Whether a known save kind (for tests and the listing's parser). */
export const isSaveKind = (value: unknown): value is SaveKind => (SAVE_KINDS as readonly unknown[]).includes(value);
