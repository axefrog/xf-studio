/**
 * Host adapter for the clothing resolver (clothing-resolver.ts `ClothingPorts`): item records from the game's compiled TweakDB, and the
 * game's cooked appearance-name visual-tag preset. Read-only; everything it keeps is private and derived.
 *
 * - **Item records**: the TweakDB blob the installation's game uses (`tweakdb_ep1.bin` with Phantom Liberty, else `tweakdb.bin`), read
 *   once per file identity (tweakdb-flats.ts); each record's fields are addressed from the save's record ID alone (`childId`).
 * - **The preset** (`base\entities\appearancename_visualtags.json`, and `ep1\…` with Phantom Liberty, which holds every base entry and
 *   more [resource: 1,351 and 1,907 entities in 2.31]): a `JsonResource` whose root is `gameAppearanceNameVisualTagsPreset {presets:
 *   [{entityPathHash, appearancesToTags: [{appearanceName, visualTags}], commonVisualTags}]}` [resource]. It holds the vanilla items'
 *   hide tags (`hide_T1`, `hide_T1part`, …) that their `.app`s don't carry, which answers the knowledge page's open question 2. WolvenKit
 *   9.0.1 doesn't serialize it, so it is decoded by the Studio's native reader (native/, the only resource read that way in production),
 *   from the archive that wins its path, and kept as a compact table in the resolver cache per archive identity.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClothingPorts, ItemRecord } from "./clothing-resolver";
import { refFromPath } from "./depot-path";
import { NativeArchive } from "./native/archive-reader";
import { loadGameOodle } from "./native/oodle";
import { readResourceJson } from "./native/resource-document";
import { asArray, cname, isObject } from "./red-json";
import type { ResourceGraph } from "./resource-graph";
import { childId, TweakDbBlob, tweakDbId, type TweakId } from "./tweakdb-flats";

const blobs = new Map<string, { stamp: string; blob: TweakDbBlob }>();
/** The TweakDB blob of a game folder (the Phantom Liberty one when installed), read once per file identity. */
export function tweakDbOf(gameRoot: string, ep1: boolean): { blob: TweakDbBlob; source: string } | null {
  const cache = join(gameRoot, "r6", "cache");
  const name = ep1 && existsSync(join(cache, "tweakdb_ep1.bin")) ? "tweakdb_ep1.bin" : "tweakdb.bin";
  const path = join(cache, name);
  let stamp: string;
  try { const stat = statSync(path); stamp = `${stat.size}|${stat.mtimeMs}`; } catch { return null; }
  const known = blobs.get(path);
  if (known?.stamp === stamp) return { blob: known.blob, source: `r6\\cache\\${name}` };
  const blob = new TweakDbBlob(new Uint8Array(readFileSync(path)));
  blobs.clear();
  blobs.set(path, { stamp, blob });
  return { blob, source: `r6\\cache\\${name}` };
}

/** The suffix records the resolver evaluates, by name (vanilla `itemsFactoryAppearanceSuffix.*`, and ArchiveXL's four). */
const SUFFIX_NAMES = ["Gender", "Camera", "Partial", "HairType", "BodyType", "ArmsState", "FeetState", "LegsState"];
const SUFFIX_IDS = new Map(SUFFIX_NAMES.map(name => [tweakDbId(`itemsFactoryAppearanceSuffix.${name}`), name] as const));
/** The save's decimal TweakDBID as the reader's ID (CRC-32 and length; any table-offset bits dropped). */
export const tweakIdOf = (item: string): TweakId => Number(BigInt(item) & 0xffffffffffn);

/** Item records from a TweakDB blob (the fields `ItemRecord` names); null for an ID the blob doesn't define. */
export function itemRecords(blob: TweakDbBlob, items: readonly string[]): Map<string, ItemRecord | null> {
  const fields = ["entityName", "appearanceName", "appearanceSuffixes", "visualTags", "garmentOffset"] as const;
  const ids = new Map<TweakId, { item: string; field: typeof fields[number] }>();
  for (const item of new Set(items)) for (const field of fields) ids.set(childId(tweakIdOf(item), `.${field}`), { item, field });
  const found = blob.lookup(ids.keys());
  const values = new Map<string, Partial<Record<typeof fields[number], unknown>>>();
  for (const [id, value] of found) { const key = ids.get(id)!; const entry = values.get(key.item) ?? {}; entry[key.field] = value.value; values.set(key.item, entry); }
  const out = new Map<string, ItemRecord | null>();
  for (const item of new Set(items)) {
    const entry = values.get(item);
    if (!entry || typeof entry.entityName !== "string" || typeof entry.appearanceName !== "string") { out.set(item, null); continue; }
    const suffixes = Array.isArray(entry.appearanceSuffixes) ? (entry.appearanceSuffixes as number[]).map(id => SUFFIX_IDS.get(id) ?? String(id)) : [];
    out.set(item, { entityName: entry.entityName, appearanceName: entry.appearanceName, suffixes,
      visualTags: Array.isArray(entry.visualTags) ? (entry.visualTags as string[]).filter(tag => typeof tag === "string") : [],
      garmentOffset: typeof entry.garmentOffset === "number" ? entry.garmentOffset : 0 });
  }
  return out;
}

/** A preset table: entity path hash → appearance name → tags (the entity's common tags included under `*`). */
export type PresetTable = Map<string, Map<string, string[]>>;
/** The table of a decoded preset document (the native reader's JSON). */
export function presetTable(document: unknown): PresetTable {
  const table: PresetTable = new Map();
  const data = (document as { Data?: { RootChunk?: { root?: { Data?: unknown } } } })?.Data?.RootChunk?.root?.Data;
  if (!isObject(data) || data.$type !== "gameAppearanceNameVisualTagsPreset") throw Error("Not an appearance-name visual tag preset.");
  const tags = (value: unknown) => isObject(value) ? asArray(value.tags).map(cname).filter(Boolean) : [];
  for (const preset of asArray(data.presets)) {
    if (!isObject(preset) || typeof preset.entityPathHash !== "string") continue;
    const entity = table.get(preset.entityPathHash) ?? new Map<string, string[]>();
    const common = tags(preset.commonVisualTags);
    if (common.length) entity.set("*", common);
    for (const entry of asArray(preset.appearancesToTags)) if (isObject(entry)) entity.set(cname(entry.appearanceName), tags(entry.visualTags));
    table.set(preset.entityPathHash, entity);
  }
  return table;
}
export const PRESET_PATHS = { base: "base\\entities\\appearancename_visualtags.json", ep1: "ep1\\entities\\appearancename_visualtags.json" } as const;
/** 1: `[entity hash, [[appearance, tags], …]]` rows. */
const PRESET_CACHE_VERSION = 1;
const presets = new Map<string, PresetTable | null>();

/**
 * The preset the installation's game reads (Phantom Liberty's when installed), decoded natively from its winning archive and cached by
 * that archive's identity. Null, with the reason logged, when it can't be read (the resolver then goes without the cooked tags).
 */
export function presetOf(graph: ResourceGraph, gameRoot: string, cacheDir: string, log: (message: string) => void = () => {}): PresetTable | null {
  const path = graph.depot.plan.ep1Installed && graph.exists(refFromPath(PRESET_PATHS.ep1).hash) ? PRESET_PATHS.ep1 : PRESET_PATHS.base;
  const ref = refFromPath(path);
  const winner = graph.locate(ref).lookup.winner;
  if (!winner) return null;
  let identity: string;
  try { const stat = statSync(winner.id); identity = createHash("sha256").update(`${winner.id.toLowerCase()}|${stat.size}|${stat.mtimeMs}|${ref.hash}|v${PRESET_CACHE_VERSION}`).digest("hex").slice(0, 32); }
  catch { return null; }
  if (presets.has(identity)) return presets.get(identity)!;
  const file = join(cacheDir, "clothing", `visual-tag-preset-${identity}.json`);
  let table: PresetTable | null = null;
  try {
    const rows = JSON.parse(readFileSync(file, "utf8")) as [string, [string, string[]][]][];
    table = new Map(rows.map(([entity, entries]) => [entity, new Map(entries)]));
  } catch { /* Not cached yet. */ }
  if (!table) {
    let oodle: ReturnType<typeof loadGameOodle> | null = null;
    try {
      oodle = loadGameOodle(gameRoot);
      const archive = NativeArchive.open(winner.id, oodle.decompress);
      let bytes: Uint8Array | null;
      try { bytes = archive.read(ref.hash); } finally { archive.close(); }
      if (!bytes) throw Error(`${winner.name} doesn't hold it.`);
      table = presetTable(readResourceJson(bytes, oodle.decompress));
      mkdirSync(join(cacheDir, "clothing"), { recursive: true });
      const staging = `${file}.${process.pid}.tmp`;
      writeFileSync(staging, JSON.stringify([...table].map(([entity, entries]) => [entity, [...entries]])));
      renameSync(staging, file);
    } catch (error) {
      log(`The game's item visual tags (${path}) couldn't be read: ${(error as Error)?.message ?? error}`);
      table = null;
    } finally { oodle?.close(); }
  }
  presets.set(identity, table);
  return table;
}

/** The clothing resolver's ports for one installation. */
export function clothingPorts(graph: ResourceGraph, gameRoot: string, cacheDir: string, log?: (message: string) => void): ClothingPorts & { tweakDb: string | null; preset: boolean } {
  const tweakDb = (() => { try { return tweakDbOf(gameRoot, graph.depot.plan.ep1Installed); } catch (error) { log?.(`The game's TweakDB couldn't be read: ${(error as Error).message}`); return null; } })();
  const preset = presetOf(graph, gameRoot, cacheDir, log);
  return {
    tweakDb: tweakDb?.source ?? null, preset: !!preset,
    records: items => tweakDb ? itemRecords(tweakDb.blob, items) : new Map(items.map(item => [item, null])),
    presetTags: (entity, appearance) => {
      if (!preset) return null;
      const entry = preset.get(entity);
      return entry ? [...entry.get("*") ?? [], ...entry.get(appearance) ?? []] : [];
    },
  };
}
