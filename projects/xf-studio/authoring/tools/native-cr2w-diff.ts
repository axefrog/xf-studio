/**
 * Differential harness for the native CR2W reader (R&D; read-only towards the game and mods). For every resource in a WolvenKit JSON
 * cache (the resolver's `data/resolver-cache/json`: `{meta: {hash, archive, extractedSha256}, document}`), it reads the same resource
 * natively from the archive the cache names, checks the bytes against the cached SHA-256, and compares:
 *
 * 1. the whole JSON document, leaf by leaf (Header, buffer `Type` strings and cached buffer bytes aside), and
 * 2. what the resolver's own readers make of each document (the mesh, morph target and `.app` models of the resource graph, the
 *    creator option model, material parameters, template defaults, profiles, gradients, layer setups and templates, and the creator
 *    catalogue's on-screen text entries; tools/catalogue-texts-oracle.ts writes those resources' WolvenKit JSON).
 *
 *   bun tools/native-cr2w-diff.ts --game <game folder> [--mods <MO2 mods folder>] --cache <json folder> [--report <file>]
 *     [--learn [--holdout]] [--limit N]
 *
 * `--learn` records, per class and property, the value WolvenKit writes when the file leaves the property out, and writes
 * `src/native/rtti-defaults.json` (only values seen the same way every time). With `--holdout` it learns from resources whose hash
 * is even and the report then covers only the others, which shows whether the learned defaults hold for resources they never saw.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMountPlan, DepotIndex } from "../src/archive-precedence";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { readCcoWithPresentation } from "../src/cc-catalogue";
import { readCco } from "../src/cco-model";
import { gradientStops, hairProfileStops, skinProfileValues, templateIdentity, textureIsGamma } from "../src/character-detail-service";
import { refFromHash } from "../src/depot-path";
import { readOnscreenEntries } from "../src/game-text";
import { readSetup, readTemplate } from "../src/layered-setup";
import { templateDefaults } from "../src/material-template";
import { tweakDbId } from "../src/tweakdb-flats";
import { NativeArchivePool } from "../src/native/archive-reader";
import { compareDocuments, isNameOnly } from "../src/native/document-diff";
import { jsonPayloadClass } from "../src/native/native-decode";
import { loadGameOodle } from "../src/native/oodle";
import { DecodeSession } from "../src/native/limits";
import { writeResourceJson } from "../src/native/red-json-writer";
import { NativeUnsupportedError } from "../src/native/red-model";
import { readResourceModel } from "../src/native/resource-document";
import { cr2wRoot, depotRef, type JsonObject, materialParams } from "../src/red-json";
import { ResourceGraph } from "../src/resource-graph";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string) => args.includes(`--${name}`);
const game = option("game"), mods = option("mods"), cache = option("cache");
if (!game || !cache) { console.error("usage: bun tools/native-cr2w-diff.ts --game <folder> [--mods <MO2 mods>] --cache <json folder> [--report file] [--learn [--holdout]] [--limit N]"); process.exit(2); }
const learn = flag("learn"), holdout = flag("holdout"), limit = Number(option("limit") ?? Infinity);

// Archives by file name: the game's groups and bundle, then every MO2 mod's archive/pc/mod.
const byName = new Map<string, string[]>();
const addDir = (dir: string) => { if (!existsSync(dir)) return; for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".archive")) byName.set(name, [...(byName.get(name) ?? []), join(dir, name)]); };
for (const group of ["content", "ep1", "mod"]) addDir(join(game, "archive", "pc", group));
addDir(join(game, "red4ext", "plugins", "ArchiveXL", "Bundle"));
if (mods && existsSync(mods)) for (const mod of readdirSync(mods)) addDir(join(mods, mod, "archive", "pc", "mod"));

const oodle = loadGameOodle(game);
const pool = new NativeArchivePool(oodle.decompress);

type Doc = { Data: { RootChunk: JsonObject } };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);


// ---- learning --------------------------------------------------------------------------------------------------------------
const observed = new Map<string, Map<string, Map<string, number>>>();
function observe(mine: unknown, reference: unknown, depth = 0): void {
  if (depth > 200) return;
  if (Array.isArray(mine) && Array.isArray(reference)) { for (let i = 0; i < Math.min(mine.length, reference.length); i++) observe(mine[i], reference[i], depth + 1); return; }
  if (!isObject(mine) || !isObject(reference)) return;
  const type = typeof mine.$type === "string" && mine.$type === reference.$type ? mine.$type : null;
  for (const [key, value] of Object.entries(reference)) {
    if (key in mine) { observe(mine[key], value, depth + 1); continue; }
    if (!type || key === "Bytes") continue;
    // Per concrete class: a base property's default can differ between subclasses (entIVisualComponent.autoHideDistance).
    const owner = type;
    const row = observed.get(owner) ?? new Map<string, Map<string, number>>();
    observed.set(owner, row);
    const values = row.get(key) ?? new Map<string, number>();
    row.set(key, values);
    const text = JSON.stringify(value);
    values.set(text, (values.get(text) ?? 0) + 1);
  }
}

// ---- comparison: src/native/document-diff.ts ----------------------------------------------------------------------------

/** One archive holding one resource, for running the resource graph's readers on a document. */
async function graphModel(type: string, hash: string, document: unknown): Promise<unknown> {
  const archive = { id: "x.archive", virtualPath: "archive/pc/content/x.archive", provider: "game" as const, providerName: "Installed game", active: true, priority: null };
  const plan = buildMountPlan([archive], null);
  const graph = new ResourceGraph(new DepotIndex(plan, new Map([["x.archive", BigUint64Array.from([BigInt(hash)])]])), readArchiveXlConfig([]),
    { fetch: async () => ({ document, extractedSha256: null }) }, false);
  const ref = refFromHash(hash);
  const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item) => key === "loaded" || key === "notes" ? undefined : item));
  if (type === "CMesh") return strip(await graph.mesh(ref));
  if (type === "MorphTargetMesh") return strip(await graph.morph(ref));
  if (type === "appearanceAppearanceResource") return strip(await graph.app(ref));
  if (type === "entEntityTemplate") return strip((await graph.entityComponents(ref))?.components);
  return undefined;
}

/** What the resolver's readers take from a document, by root type. */
async function projection(document: unknown, hash: string): Promise<unknown> {
  const { root } = cr2wRoot(document);
  const type = String(root.$type);
  switch (type) {
    case "CMesh": case "MorphTargetMesh": case "appearanceAppearanceResource": case "entEntityTemplate": return graphModel(type, hash, document);
    case "CMaterialInstance": return { base: depotRef(root.baseMaterial), params: materialParams(root.values) };
    case "CMaterialTemplate": return { identity: templateIdentity(root), defaults: templateDefaults(root) };
    case "CHairProfile": return hairProfileStops(root);
    case "CSkinProfile": return skinProfileValues(root);
    case "CGradient": return gradientStops(root);
    case "Multilayer_Setup": return readSetup(root);
    case "Multilayer_LayerTemplate": return readTemplate(root);
    case "CBitmapTexture": return textureIsGamma(root);
    case "gameuiCharacterCustomizationInfoResource": return { cco: readCco(root, "x"), presentation: iconsById(readCcoWithPresentation(root, "x")) };
    // The creator catalogue's on-screen texts: the entries the text table merges.
    case "JsonResource": return jsonPayloadClass(document) === "localizationPersistenceOnScreenEntries" ? readOnscreenEntries(document) : null;
    default: return null;
  }
}
/**
 * Icon records compare by TweakDB id: a name (`OptionsIcons.BrownLiquorice`) and a hash-only key (`#117106207571`) that name the
 * same record are the same icon to the catalogue (cc-presentation.ts `iconKey`).
 */
function iconsById(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(iconsById);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "icon" && typeof item === "string"
    ? item.startsWith("#") ? item : `#${tweakDbId(item)}` : iconsById(item)]));
}

/** Hash-only references compare by hash: drop the path text where either side lacks it. */
function hashesOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hashesOnly);
  if (!isObject(value)) return value;
  if (typeof value.hash === "string" && "path" in value && Object.keys(value).length === 2) return { hash: value.hash };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hashesOnly(item)]));
}

// ---- run -------------------------------------------------------------------------------------------------------------------
type Row = { count: number; bytesOk: number; unsupported: number; errors: number; docsEqual: number; docsEqualButPaths: number; projectionEqual: number;
  projectionEqualByHash: number; projected: number; ms: number; mismatchKinds: Map<string, number>; examples: string[] };
const rows = new Map<string, Row>();
const rowFor = (ext: string) => { let row = rows.get(ext); if (!row) { row = { count: 0, bytesOk: 0, unsupported: 0, errors: 0, docsEqual: 0, docsEqualButPaths: 0,
  projectionEqual: 0, projectionEqualByHash: 0, projected: 0, ms: 0, mismatchKinds: new Map(), examples: [] }; rows.set(ext, row); } return row; };
const failures: string[] = [];
let seen = 0, skipped = 0;
const files = readdirSync(cache).filter(name => name.endsWith(".json")).sort();
for (const name of files) {
  if (seen >= limit) break;
  let entry: { meta: { hash: string; archive: string; path: string | null; extractedSha256: string }; document: Doc };
  try { entry = JSON.parse(readFileSync(join(cache, name), "utf8")); } catch { continue; }
  const { meta } = entry;
  const even = BigInt(meta.hash) % 2n === 0n;
  if (holdout && !learn && even) continue;
  if (holdout && learn && !even) continue;
  const ext = /\.([a-z0-9]+)$/i.exec(meta.path ?? "")?.[1]?.toLowerCase() ?? "(no path)";
  let bytes: Uint8Array | null = null;
  for (const path of byName.get(meta.archive) ?? []) {
    const archive = pool.get(path);
    if (!archive.has(meta.hash)) continue;
    const candidate = archive.read(meta.hash)!;
    if (createHash("sha256").update(candidate).digest("hex") === meta.extractedSha256) { bytes = candidate; break; }
  }
  if (!bytes) { skipped++; continue; }
  seen++;
  const row = rowFor(ext);
  row.count++; row.bytesOk++;
  const start = performance.now();
  let model;
  const session = new DecodeSession();
  try { model = readResourceModel(bytes, oodle.decompress, session); }
  catch (error) {
    if (error instanceof NativeUnsupportedError) row.unsupported++; else { row.errors++; failures.push(`${meta.path ?? meta.hash}: ${(error as Error).message}`); }
    continue;
  }
  if (learn) { observe(writeResourceJson(model, { buffers: "trim", omitDefaults: true }, session).Data, entry.document.Data); continue; }
  const mine = writeResourceJson(model, { buffers: "trim" }, session);
  row.ms += performance.now() - start;
  const mismatches = compareDocuments(mine.Data, entry.document.Data);
  if (!mismatches.length) row.docsEqual++;
  else if (mismatches.every(isNameOnly)) row.docsEqualButPaths++;
  for (const mismatch of mismatches) {
    row.mismatchKinds.set(mismatch.kind, (row.mismatchKinds.get(mismatch.kind) ?? 0) + 1);
    if (row.examples.length < 6 && !isNameOnly(mismatch)) row.examples.push(`${meta.path ?? meta.hash}${mismatch.path}: ${mismatch.mine} vs ${mismatch.reference}`);
  }
  try {
    const [a, b] = await Promise.all([projection(mine, meta.hash), projection(entry.document, meta.hash)]);
    if (a !== null || b !== null) {
      row.projected++;
      if (JSON.stringify(a) === JSON.stringify(b)) row.projectionEqual++;
      else if (JSON.stringify(hashesOnly(a)) === JSON.stringify(hashesOnly(b))) row.projectionEqualByHash++;
      else if (row.examples.length < 10) row.examples.push(`${meta.path ?? meta.hash}: resolver model differs`);
    }
  } catch (error) { failures.push(`${meta.path ?? meta.hash}: projection: ${(error as Error).message}`); }
}
pool.close();

if (learn) {
  const table: Record<string, Record<string, unknown>> = {};
  const conflicts: string[] = [];
  for (const [owner, props] of [...observed].sort((a, b) => (a[0] < b[0] ? -1 : 1))) for (const [key, values] of [...props].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (values.size === 1) (table[owner] ??= {})[key] = JSON.parse([...values.keys()][0]!);
    else conflicts.push(`${owner}.${key}: ${[...values].map(([value, count]) => `${value.slice(0, 60)} ×${count}`).join(" | ")}`);
  }
  const target = join(import.meta.dir, "..", "src", "native", "rtti-defaults.json");
  writeFileSync(target, JSON.stringify(table, null, 1) + "\n");
  console.log(JSON.stringify({ learnedFrom: seen, skipped, classes: Object.keys(table).length, properties: Object.values(table).reduce((sum, row) => sum + Object.keys(row).length, 0),
    conflicts, failures: failures.slice(0, 20) }, null, 1));
} else {
  const report = { resources: seen, skipped, holdout, byExtension: Object.fromEntries([...rows].sort((a, b) => b[1].count - a[1].count).map(([ext, row]) => [ext, {
    count: row.count, unsupported: row.unsupported, errors: row.errors, docsEqual: row.docsEqual, docsEqualExceptHashOnlyNames: row.docsEqualButPaths,
    resolverModels: row.projected, resolverModelsEqual: row.projectionEqual, resolverModelsEqualByHash: row.projectionEqualByHash,
    msPerResource: row.count - row.unsupported - row.errors ? Math.round(row.ms / (row.count - row.unsupported - row.errors) * 100) / 100 : null,
    mismatchKinds: Object.fromEntries([...row.mismatchKinds].sort((a, b) => b[1] - a[1]).slice(0, 12)), examples: row.examples }])), failures: failures.slice(0, 40) };
  const out = option("report");
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
