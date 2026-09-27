/**
 * The expression exporter's host prerequisite (`expressions/game`, research/animation/expression-editor-design.md §6.3): what a set's mod is
 * planned and built on, read from the player's own game files the way the game resolves them.
 *
 * - **The table** photo mode reads on the launch route, skipping XF Studio's own expression tables (an earlier Build's overlay must never be
 *   carried into the next), and the game's own (the first provider outside the mod folder), each as rows with its provider and SHA-256.
 * - **Every provider** of the table path in load order and whether a visible `modlist.txt` orders them, so Check can say which list wins.
 * - **Each gender's face**: the vanilla photo-mode face set (whose neutral face gives the joint keys every static face shares) and the rig it
 *   names (its track names), with the facial setup's main-pose block.
 * - **V's photo-mode face rig** as the game ships it, whose document shape the patch follows.
 *
 * Everything is game-derived and stays in the host's private cache; nothing is committed or shipped but the built mod.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { refFromPath, type DepotRef } from "./depot-path";
import { writeFileAtomic } from "./derived-cache";
import { extractFacialJson, type FacialExtractor } from "./facial-host";
import { FACE_SETUP } from "./facial-catalogue";
import { installations } from "./installation-registry";
import type { MountedArchive } from "./archive-precedence";
import type { Installation, InstallationOptions } from "./resolver-host";
import type { HostPrerequisite, PreparedPrerequisite } from "./platform/export/product-host";
import { EXPRESSIONS_GAME_1, EXPRESSION_TABLE_PATH, FACE_RIG_APP_PATH, GENDERS, readGameInputs, type GameFile, type GameInputs, type GameRig,
  type Gender } from "./features/expressions/export/game";
import { templateNeutral } from "./features/expressions/export/files";

export type ExpressionsGameOptions = {
  readonly route: Pick<InstallationOptions, "gameRoot" | "launchRoute" | "mo2Root" | "mo2ProfileId" | "manualModRoot">;
  readonly wolvenKitCli: string;
  /** The host's private cache (the prepared file lives in `expressions-game/`). */
  readonly cacheRoot: string;
  readonly resolverCache: string;
  /** Test seams. */
  readonly extract?: FacialExtractor;
  readonly acquire?: (options: InstallationOptions) => Promise<Installation>;
};

const coded = (code: string, message: string) => Object.assign(Error(message), { code });
const sha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const backslashed = (path: string) => path.replaceAll("/", "\\");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** An XF Studio expression table overlay (`0xfs_c…_table` / `0xfs_m…_table`): never carried. */
export const XF_TABLE_OVERLAY = /^0xfs_[cm][0-9a-f]{32}_table\.archive$/i;
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

/** A gender's rig inputs: its skeleton's track names, the setup's main-pose block and its template's joint keys. */
export function genderRig(set: unknown, skeleton: unknown, setup: unknown, rigPath: string): GameRig {
  const neutral = templateNeutral(set);
  const tracks = (Array.isArray(root(skeleton).trackNames) ? root(skeleton).trackNames as unknown[] : []).map(cname);
  const info = root(setup).info, mapping = isRecord(info) && isRecord(info.tracksMapping) ? info.tracksMapping : undefined;
  if (!mapping) throw Error("The facial setup has no track mapping.");
  const main = { start: Number(mapping.numEnvelopes), count: Number(mapping.numMainPoses) };
  return { rig: rigPath, tracks, main, joints: neutral.joints, constAnimKeys: neutral.jointBlock.byteLength / 16, jointBlockSha256: sha256(neutral.jointBlock) };
}

export function expressionsGamePrerequisite(options: ExpressionsGameOptions): HostPrerequisite {
  const key = sha256(JSON.stringify([options.route.gameRoot, options.route.launchRoute, options.route.mo2Root, options.route.mo2ProfileId,
    options.route.manualModRoot])).slice(0, 24);
  const folder = join(options.cacheRoot, "expressions-game"), file = join(folder, `${key}.json`);
  return {
    cached() {
      if (!existsSync(file)) return null;
      try { return readGameInputs((JSON.parse(readFileSync(file, "utf8")) as GameFile).plan); } catch { return null; }
    },
    async prepare(signal): Promise<PreparedPrerequisite> {
      if (!options.route.gameRoot || !options.wolvenKitCli) throw coded("package_input_missing", MISSING);
      const installation = await (options.acquire ?? (value => installations.acquire(value)))({ ...options.route, gameRoot: options.route.gameRoot,
        wolvenKitCli: options.wolvenKitCli, cacheDir: options.resolverCache });
      const graph = installation.graph, extract = options.extract ?? extractFacialJson;
      const work = join(folder, "tmp");
      /** Read resources from one archive (untrimmed JSON: clips need their data chunks). */
      const read = async (archive: MountedArchive, refs: readonly { ref: DepotRef; extension: string }[]) => {
        const out = new Map<string, unknown>();
        await extract(options.wolvenKitCli, archive, refs.map(item => ({ hash: item.ref.hash, extension: item.extension })), work,
          (hash, text) => { out.set(hash, JSON.parse(text.replace(/^﻿/, ""))); }, signal);
        return out;
      };
      const winner = async (path: string, extension: string) => {
        const ref = refFromPath(backslashed(path)), located = graph.locate(ref), archive = located.lookup.winner;
        if (!archive) throw coded("package_input_missing", MISSING);
        const document = (await read(archive, [{ ref: located.entry, extension }])).get(located.entry.hash);
        if (!document) throw coded("package_input_missing", MISSING);
        return { document, archive };
      };
      // The table: the effective one (skipping XF overlays) and the game's own.
      const tableRef = refFromPath(backslashed(EXPRESSION_TABLE_PATH)), candidates = graph.locate(tableRef).lookup.candidates;
      const effective = candidates.find(archive => !XF_TABLE_OVERLAY.test(archive.name)), base = candidates.find(archive => archive.group !== "mod");
      if (!effective || !base) throw coded("package_input_missing", MISSING);
      const tables = new Map<MountedArchive, unknown>();
      for (const archive of new Set([effective, base])) {
        const document = (await read(archive, [{ ref: tableRef, extension: "csv" }])).get(tableRef.hash);
        if (!document) throw coded("package_input_missing", MISSING);
        tables.set(archive, document);
      }
      const table = (archive: MountedArchive) => {
        const rows = tableRows(tables.get(archive));
        return { rows, archive: archive.name, provider: archive.group === "mod" ? archive.providerName || archive.name : "Base game", sha256: sha256(JSON.stringify(rows)) };
      };
      // The face rig as the game ships it (its first provider outside the mod folder), the facial setup, each gender's set and skeleton.
      const rigRef = refFromPath(backslashed(FACE_RIG_APP_PATH)), rigArchive = graph.locate(rigRef).lookup.candidates.find(archive => archive.group !== "mod");
      const faceRig = rigArchive ? (await read(rigArchive, [{ ref: rigRef, extension: "app" }])).get(rigRef.hash) : undefined;
      if (!faceRig) throw coded("package_input_missing", MISSING);
      const setup = (await winner(FACE_SETUP, "facialsetup")).document;
      const sets = {} as Record<Gender, unknown>, rigs = {} as Record<Gender, GameRig>;
      for (const gender of Object.keys(GENDERS) as Gender[]) {
        const set = (await winner(GENDERS[gender].set, "anims")).document;
        const rigPath = cname(isRecord(root(set).rig) && isRecord((root(set).rig as Record<string, unknown>).DepotPath) ? ((root(set).rig as Record<string, unknown>).DepotPath) : "");
        if (!rigPath.endsWith(".rig")) throw coded("package_input_missing", MISSING);
        const skeleton = (await winner(rigPath, "rig")).document;
        sets[gender] = set;
        rigs[gender] = genderRig(set, skeleton, setup, rigPath);
      }
      const plan: GameInputs = { schema: EXPRESSIONS_GAME_1, table: table(effective), base: table(base),
        providers: candidates.map(archive => ({ name: archive.name.replace(/\.archive$/i, ""), group: archive.group, provider: archive.providerName || archive.name })),
        modOrder: installation.plan.modOrder, rigs };
      mkdirSync(folder, { recursive: true });
      const prepared: GameFile = { plan, sets, faceRig, table: tables.get(effective) };
      writeFileAtomic(file, JSON.stringify(prepared));
      rmSync(work, { recursive: true, force: true });
      return { builder: { file }, plan };
    },
    discard() { rmSync(file, { force: true }); },
  };
}
