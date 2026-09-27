/**
 * The expression exporter's host prerequisite (`expressions/game`, research/animation/expression-editor-design.md §6.3): what a set's mod is
 * planned and built on, read from the player's own game files the way the game resolves them.
 *
 * - **The table** photo mode reads on the launch route, skipping XF Studio's own expression tables (an earlier Build's overlay must never be
 *   carried into the next), and the game's own (the first provider in the base archives, `content` or `ep1`), each as rows with its provider and SHA-256.
 * - **Every provider** of the table path in load order and whether a visible `modlist.txt` orders them, so Check can say which list wins.
 * - **Each gender's face**: the vanilla photo-mode face set (whose neutral face gives the joint keys every static face shares) and the rig it
 *   names (its track names), with the facial setup's main-pose block.
 * - **V's photo-mode face rig** as the game ships it, whose document shape the patch follows.
 *
 * Everything is game-derived and stays in the host's private cache; nothing is committed or shipped but the built mod. A prepared file belongs
 * to one installation (`expressionsGameFingerprint`: the route, its mod folders' stamps, the registry's generation and the reader's version);
 * Check plans on it only while that installation is current, and otherwise reads afresh in the background (the Check is provisional meanwhile).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { refFromPath, type DepotRef } from "./depot-path";
import { writeFileAtomic } from "./derived-cache";
import { extractFacialJson, type FacialExtractor } from "./facial-host";
import { EXPRESSION_TABLE, FACE_SETUP, PHOTO_MODE_FACE_RIG } from "./facial-catalogue";
import { installations } from "./installation-registry";
import { routeIdentity, routeStamps } from "./route-fingerprint";
import type { MountedArchive } from "./archive-precedence";
import type { Installation, InstallationOptions } from "./resolver-host";
import type { HostPrerequisite, PreparedPrerequisite } from "./platform/export/product-host";

/**
 * What this prerequisite prepares, in the shape the expressions exporter reads (`features/expressions/export/game.ts`, which checks it
 * field by field; the composition binds the two by the prerequisite ID). A host module reaches no feature, so the shape is restated here.
 */
export const EXPRESSIONS_GAME_1 = "xfs/expressions-game-1";
const GENDER_SETS = { female: "base/animations/ui/photomode/photomode_female_facial.anims",
  male: "base/animations/ui/photomode/photomode_male_facial.anims" } as const;
type Gender = keyof typeof GENDER_SETS;
type GameTable = { rows: string[][]; archive: string; provider: string; sha256: string };
export type GameRig = { rig: string; tracks: string[]; main: { start: number; count: number }; joints: number; constAnimKeys: number; jointBlockSha256: string };
export type GameInputs = { schema: typeof EXPRESSIONS_GAME_1; table: GameTable; base: GameTable;
  providers: { name: string; group: string; provider: string }[]; modOrder: "modlist" | "alphabetical"; rigs: Record<Gender, GameRig> };
type GameFile = { fingerprint?: string; plan: GameInputs; sets: Record<Gender, unknown>; faceRig: unknown; table: unknown };

export type ExpressionsGameOptions = {
  readonly route: Pick<InstallationOptions, "gameRoot" | "launchRoute" | "mo2Root" | "mo2ProfileId" | "manualModRoot">;
  readonly wolvenKitCli: string;
  /** The host's private cache (the prepared file lives in `expressions-game/`). */
  readonly cacheRoot: string;
  readonly resolverCache: string;
  /** Test seams. */
  readonly extract?: FacialExtractor;
  readonly acquire?: (options: InstallationOptions) => Promise<Installation>;
  /** The installation fingerprint (default `expressionsGameFingerprint`). */
  readonly fingerprint?: () => string;
};

const coded = (code: string, message: string) => Object.assign(Error(message), { code });
const sha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const backslashed = (path: string) => path.replaceAll("/", "\\");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** An XF Studio expression table overlay (`0xfs_c…_table` / `0xfs_m…_table`): never carried. */
export const XF_TABLE_OVERLAY = /^0xfs_[cm][0-9a-f]{32}_table\.archive$/i;
/** The base archives: the game's own files (never a mod's, nor ArchiveXL's bundle). */
const isGameOwn = (archive: MountedArchive) => archive.group === "content" || archive.group === "ep1";
const MISSING = "XF Studio couldn't read photo mode's expressions from your game files. Check your game folder in Settings › Game, then build again.";

function root(document: unknown): Record<string, unknown> {
  const data = isRecord(document) && isRecord(document.Data) ? document.Data : undefined;
  if (!data || !isRecord(data.RootChunk)) throw Error("no root");
  return data.RootChunk;
}
const cname = (value: unknown) => isRecord(value) ? String(value.$value ?? "") : String(value ?? "");

/** The rows of a serialised `C2dArray` (cells as strings), checked against the four columns photo mode's table has. */
export function tableRows(document: unknown): string[][] {
  const r = root(document);
  const headers = Array.isArray(r.compiledHeaders) ? r.compiledHeaders.map(String) : [];
  if (JSON.stringify(headers) !== JSON.stringify(["Index", "AnimationName", "streamingContext", "FallbackAnimationName"]))
    throw coded("package_input_missing", "Photo mode's expression list has columns XF Studio doesn't know, so it can't add to it.");
  return (Array.isArray(r.compiledData) ? r.compiledData : []).map(row => (row as unknown[]).map(String));
}

/** The joint keys of a vanilla face set's `facial_neutral` (every static face of the set shares them) and its joint count. */
export function neutralJoints(set: unknown): { jointBlock: Uint8Array; joints: number } {
  const r = root(set), chunks = Array.isArray(r.animationDataChunks) ? r.animationDataChunks : [];
  for (const item of Array.isArray(r.animations) ? r.animations : []) {
    const entry = isRecord(item) && isRecord(item.Data) ? item.Data : undefined;
    const animation = entry && isRecord(entry.animation) && isRecord(entry.animation.Data) ? entry.animation.Data : undefined;
    if (!animation || cname(animation.name) !== "facial_neutral") continue;
    const buffer = isRecord(animation.animBuffer) && isRecord(animation.animBuffer.Data) ? animation.animBuffer.Data : undefined;
    const address = buffer && isRecord(buffer.dataAddress) ? buffer.dataAddress : undefined;
    const chunk = address ? chunks[Number(address.unkIndex)] : undefined;
    const text = isRecord(chunk) && isRecord(chunk.buffer) && typeof chunk.buffer.Bytes === "string" ? chunk.buffer.Bytes : undefined;
    if (!buffer || !address || !text || buffer.numAnimKeys !== 0 || !Number.isInteger(buffer.numConstAnimKeys)) break;
    const bytes = new Uint8Array(Buffer.from(text, "base64")), offset = Number(address.fsetInBytes), size = (buffer.numConstAnimKeys as number) * 16;
    if (bytes.byteLength < offset + size) break;
    return { jointBlock: bytes.slice(offset, offset + size), joints: Number(buffer.numJoints) };
  }
  throw coded("package_input_missing", "The game's photo-mode faces aren't what XF Studio expects, so it can't add expressions to them.");
}

/** A gender's rig inputs: its skeleton's track names, the setup's main-pose block and its template's joint keys. */
export function genderRig(set: unknown, skeleton: unknown, setup: unknown, rigPath: string): GameRig {
  const neutral = neutralJoints(set);
  const tracks = (Array.isArray(root(skeleton).trackNames) ? root(skeleton).trackNames as unknown[] : []).map(cname);
  const info = root(setup).info, mapping = isRecord(info) && isRecord(info.tracksMapping) ? info.tracksMapping : undefined;
  if (!mapping) throw Error("The facial setup has no track mapping.");
  const main = { start: Number(mapping.numEnvelopes), count: Number(mapping.numMainPoses) };
  return { rig: rigPath, tracks, main, joints: neutral.joints, constAnimKeys: neutral.jointBlock.byteLength / 16, jointBlockSha256: sha256(neutral.jointBlock) };
}

/** Bumped whenever the same game files would be read into a different prepared file (PIPE-118): an older file is re-read. */
export const EXPRESSIONS_GAME_READER = "1";
/** Prepared files kept per route (the newest; an older installation's file may still be in a running Build's hands). */
const KEPT_PER_ROUTE = 3;

/**
 * Reads in flight, by cache folder and route key (PIPE-117): at most one per route. A Check that finds nothing prepared for the current installation starts
 * one in the background; a Build for the same installation joins it; a read for another installation (mods changed meanwhile) aborts it.
 * Each read works in its own folder, so nothing it does touches another's files.
 */
const reading = new Map<string, { fingerprint: string; controller: AbortController; promise: Promise<PreparedPrerequisite> }>();

/** The installation's fingerprint (PIPE-118): its route settings, the stamps of its mod folders and lists, the registry's generation, the reader. */
export function expressionsGameFingerprint(route: ExpressionsGameOptions["route"], wolvenKitCli: string): string {
  if (!route.gameRoot) return "";
  const settings = { ...route, gameRoot: route.gameRoot };
  return sha256(JSON.stringify({ reader: EXPRESSIONS_GAME_READER, route: routeIdentity(settings), stamps: routeStamps(settings),
    generation: installations.generation({ ...settings, wolvenKitCli: wolvenKitCli || null }) }));
}

export function expressionsGamePrerequisite(options: ExpressionsGameOptions): HostPrerequisite {
  const key = sha256(JSON.stringify([options.route.gameRoot, options.route.launchRoute, options.route.mo2Root, options.route.mo2ProfileId,
    options.route.manualModRoot])).slice(0, 24);
  const folder = join(options.cacheRoot, "expressions-game");
  const fingerprint = () => options.fingerprint ? options.fingerprint() : expressionsGameFingerprint(options.route, options.wolvenKitCli);
  /** The prepared file of one installation: the route's key and the fingerprint's (a new installation never overwrites a file in use). */
  const fileOf = (print: string) => join(folder, `${key}-${sha256(print).slice(0, 16)}.json`);
  /** This route's slot in the reads in flight (per cache folder too: two hosts' caches never share a read). */
  const slot = join(folder, key);
  const stoppedError = () => coded("package_build_cancelled", "The game files' read was stopped.");

  /** Keep the route's newest prepared files; older ones go (never the one just written). */
  const prune = (kept: string) => {
    let names: string[];
    try { names = readdirSync(folder).filter(name => name.startsWith(`${key}-`) && name.endsWith(".json")); } catch { return; }
    const dated = names.map(name => { const path = join(folder, name); try { return { path, at: statSync(path).mtimeMs }; } catch { return null; } })
      .filter((item): item is { path: string; at: number } => !!item && item.path !== kept).sort((a, b) => b.at - a.at);
    for (const item of dated.slice(KEPT_PER_ROUTE - 1)) rmSync(item.path, { force: true });
  };

  /** Read the game files for one installation into its prepared file, in a work folder of this read's own. */
  const read = async (entry: { fingerprint: string }, signal: AbortSignal): Promise<PreparedPrerequisite> => {
    if (!options.route.gameRoot || !options.wolvenKitCli) throw coded("package_input_missing", MISSING);
    const installation = await (options.acquire ?? (value => installations.acquire(value)))({ ...options.route, gameRoot: options.route.gameRoot,
      wolvenKitCli: options.wolvenKitCli, cacheDir: options.resolverCache });
    if (signal.aborted) throw stoppedError();
    // Opening the installation may find it changed and move the registry's generation on: the file is kept under the fingerprint after it.
    const print = entry.fingerprint = fingerprint();
    const graph = installation.graph, extract = options.extract ?? extractFacialJson;
    mkdirSync(join(folder, "tmp"), { recursive: true });
    const work = mkdtempSync(join(folder, "tmp", "read-"));
    try {
      /** Read resources from one archive (untrimmed JSON: clips need their data chunks). */
      const fetch = async (archive: MountedArchive, refs: readonly { ref: DepotRef; extension: string }[]) => {
        const out = new Map<string, unknown>();
        await extract(options.wolvenKitCli, archive, refs.map(item => ({ hash: item.ref.hash, extension: item.extension })), work,
          (hash, text) => { out.set(hash, JSON.parse(text.replace(/^﻿/, ""))); }, signal);
        if (signal.aborted) throw stoppedError();
        return out;
      };
      const winner = async (path: string, extension: string) => {
        const ref = refFromPath(backslashed(path)), located = graph.locate(ref), archive = located.lookup.winner;
        if (!archive) throw coded("package_input_missing", MISSING);
        const document = (await fetch(archive, [{ ref: located.entry, extension }])).get(located.entry.hash);
        if (!document) throw coded("package_input_missing", MISSING);
        return { document, archive };
      };
      // The table: the effective one (skipping XF overlays) and the game's own (the base archives', never a mod's or ArchiveXL's bundle).
      const tableRef = refFromPath(EXPRESSION_TABLE), candidates = graph.locate(tableRef).lookup.candidates;
      const effective = candidates.find(archive => !XF_TABLE_OVERLAY.test(archive.name)), base = candidates.find(isGameOwn);
      if (!effective || !base) throw coded("package_input_missing", MISSING);
      const tables = new Map<MountedArchive, unknown>();
      for (const archive of new Set([effective, base])) {
        const document = (await fetch(archive, [{ ref: tableRef, extension: "csv" }])).get(tableRef.hash);
        if (!document) throw coded("package_input_missing", MISSING);
        tables.set(archive, document);
      }
      const table = (archive: MountedArchive) => {
        const rows = tableRows(tables.get(archive));
        return { rows, archive: archive.name, provider: isGameOwn(archive) ? "Base game" : archive.providerName || archive.name, sha256: sha256(JSON.stringify(rows)) };
      };
      // The face rig as the game ships it (its first provider in the base archives), the facial setup, each gender's set and skeleton.
      const rigRef = refFromPath(PHOTO_MODE_FACE_RIG), rigArchive = graph.locate(rigRef).lookup.candidates.find(isGameOwn);
      const faceRig = rigArchive ? (await fetch(rigArchive, [{ ref: rigRef, extension: "app" }])).get(rigRef.hash) : undefined;
      if (!faceRig) throw coded("package_input_missing", MISSING);
      const setup = (await winner(FACE_SETUP, "facialsetup")).document;
      const sets = {} as Record<Gender, unknown>, rigs = {} as Record<Gender, GameRig>;
      for (const gender of Object.keys(GENDER_SETS) as Gender[]) {
        const set = (await winner(GENDER_SETS[gender], "anims")).document;
        const rigPath = cname(isRecord(root(set).rig) && isRecord((root(set).rig as Record<string, unknown>).DepotPath) ? ((root(set).rig as Record<string, unknown>).DepotPath) : "");
        if (!rigPath.endsWith(".rig")) throw coded("package_input_missing", MISSING);
        const skeleton = (await winner(rigPath, "rig")).document;
        sets[gender] = set;
        rigs[gender] = genderRig(set, skeleton, setup, rigPath);
      }
      const plan: GameInputs = { schema: EXPRESSIONS_GAME_1, table: table(effective), base: table(base),
        providers: candidates.map(archive => ({ name: archive.name.replace(/\.archive$/i, ""), group: archive.group, provider: archive.providerName || archive.name })),
        modOrder: installation.plan.modOrder, rigs };
      if (signal.aborted) throw stoppedError();
      mkdirSync(folder, { recursive: true });
      const file = fileOf(print), prepared: GameFile = { fingerprint: print, plan, sets, faceRig, table: tables.get(effective) };
      writeFileAtomic(file, JSON.stringify(prepared));
      prune(file);
      return { builder: { file }, plan };
    } finally { rmSync(work, { recursive: true, force: true }); }
  };

  /** The read for this installation: the one in flight when it is for the same installation, else a new one (stopping another's). */
  const start = (print: string) => {
    const current = reading.get(slot);
    if (current?.fingerprint === print) return current;
    current?.controller.abort();
    const controller = new AbortController();
    const entry = { fingerprint: print, controller, promise: undefined as unknown as Promise<PreparedPrerequisite> };
    entry.promise = read(entry, controller.signal).finally(() => { if (reading.get(slot) === entry) reading.delete(slot); });
    reading.set(slot, entry);
    return entry;
  };

  return {
    cached() {
      if (!options.route.gameRoot || !options.wolvenKitCli) return null;
      const print = fingerprint();
      let plan: GameInputs | null = null;
      try {
        const value = JSON.parse(readFileSync(fileOf(print), "utf8")) as GameFile;
        if (value.fingerprint === print && value.plan?.schema === EXPRESSIONS_GAME_1) plan = value.plan;
      } catch { plan = null; }
      // Nothing read for this installation yet (a new route, mods changed, an older reader): this Check is provisional and says so, and the
      // files are read in the background so the next Check can tell which expressions the game's face rig can show and where they go.
      if (!plan) start(print).promise.catch(() => undefined);
      return plan;
    },
    async prepare(signal): Promise<PreparedPrerequisite> {
      if (!options.route.gameRoot || !options.wolvenKitCli) throw coded("package_input_missing", MISSING);
      const print = fingerprint();
      // Build takes over a background read for this installation (joining it) and stops one for an older installation.
      for (;;) {
        if (signal.aborted) throw stoppedError();
        const entry = start(print);
        let abort: (() => void) | undefined;
        const stopped = new Promise<never>((_, reject) => { abort = () => reject(stoppedError()); signal.addEventListener("abort", abort, { once: true }); });
        try { return await Promise.race([entry.promise, stopped]); }
        catch (error) {
          // The joined read was stopped for another installation's, not by this Build, and this installation is still current: read again.
          if (!signal.aborted && entry.controller.signal.aborted && fingerprint() === print) continue;
          throw error;
        } finally { signal.removeEventListener("abort", abort!); }
      }
    },
    discard(prepared) {
      const file = (prepared?.builder as { file?: unknown } | undefined)?.file;
      rmSync(typeof file === "string" ? file : fileOf(fingerprint()), { force: true });
    },
  };
}
