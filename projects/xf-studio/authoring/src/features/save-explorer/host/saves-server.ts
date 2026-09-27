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
 * Nothing here writes. Paths never leave the host: a save is named by its folder name, which must be a plain child folder of the saves
 * folder (no links, no separators), and files are read by bounded, link-refusing reads. Logs name saves by folder only.
 */
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { readScriptBundleNames } from "../../../engines/red-object/script-bundle";
import type { EngineTypes } from "../../../engines/red-object/type-oracle";
import { SAVE_KINDS, type SaveKind, type SaveListing, type SaveListingResult, type SaveTypeNames } from "../listing";

/** Where the saves are, and the script bundles to read names from (the first readable one wins), resolved by the host per request. */
export type SavesHostSources = {
  /** The Saved Games folder for Cyberpunk 2077, or null when it can't be found. */
  root(): Promise<string | null> | string | null;
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

/** `log` takes one plain line (the host's area logger); lines name saves by folder only, never a path. */
export function createSavesHandler(sources: SavesHostSources, log?: (message: string) => void) {
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
    return { available: false, names: [], reason: "XF Studio couldn't find your game's compiled scripts, so some names show as numbers. Choose your game folder in Mod package › Game & tools." };
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to read saves." }, 403);
    if (request.method !== "GET") return json({ code: "method", error: "Method not allowed." }, 405);
    if (url.pathname === "/api/saves/types") {
      const engine = sources.engine();
      const value: SaveTypeNames = { engine: { enums: [...engine.enums], bitfields: [...engine.bitfields], classes: [...engine.classes],
        properties: [...engine.properties] }, scripts: scriptNames() };
      return json(value);
    }
    let root: string | null;
    try { root = await sources.root(); } catch { root = null; }
    if (url.pathname === "/api/saves") {
      if (!root || !isDirectory(root)) {
        const result: SaveListingResult = { available: false, saves: [],
          reason: "XF Studio couldn't find your Cyberpunk 2077 saves folder. You can still open a save with Open a save file…" };
        return json(result);
      }
      const result: SaveListingResult = { available: true, saves: listSaves(root) };
      return json(result);
    }
    if (url.pathname === "/api/saves/file") {
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
