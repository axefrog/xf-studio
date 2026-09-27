/**
 * Expressions' mod exporter `expressions/photo-mode-static-v1` (research/animation/expression-editor-design.md §6, phase 3; feature-module
 * platform §6). Host only (Node). It packages the saved expressions of an **expression set** (a package collection marked `presetSet`,
 * part-preset-sets.ts) as photo-mode expressions:
 *
 * - each gender's animation set of static faces (engines/facial-rig/clip.ts), attached to V's photo-mode face rig by an ArchiveXL resource
 *   patch that adds its own animation component;
 * - photo mode's expression table, the installed one (or, for sharing, the game's own) with a row per expression, in an overlay archive
 *   named to load first;
 * - TweakXL records naming each expression in photo mode's list.
 *
 * Partial export: an expression that can't be packaged (damaged, no controls, controls the game's face rig lacks) is left out with its reason
 * in Check, Build and the manifest. A look collection's expression parts are not this exporter's (sets are how expressions become mods), so
 * it never changes a look collection's mods.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COLLECTION_2, ExportRefusal, PrerequisiteStale, type ExportInfo, type ExportOmission, type FeatureCheck, type FeatureExporter, type FeatureOutcome,
  type GeneratedFile } from "../../../platform/api";
import { unknownControls } from "../../../engines/facial-rig/clip";
import { controlLabel, controlSide } from "../../../engines/facial-rig/vocabulary";
import { EXPRESSION_PART_1, parseExpressionPart } from "../part";
import { EXPRESSIONS_GAME_PREREQUISITE, EXPRESSION_TABLE_PATH, FACE_RIG_APP_PATH, GAME_INPUTS_DAMAGED, GENDERS, readGameInputs, type GameBuilderInputs, type GameFile,
  type Gender, type GameInputs } from "./game";
import { animationSet, componentId, expressionRow, expressionTable, faceRigPatch, fillerRow, tweakRecords } from "./files";

export const EXPRESSIONS_EXPORTER_ID = "expressions/photo-mode-static-v1";
/** Bumped whenever the same input would build different bytes. */
export const EXPRESSIONS_EXPORTER_VERSION = "1";
export const EXPRESSIONS_FEATURE = "expressions";
export const EXPRESSIONS_EXPORT: ExportInfo = Object.freeze({ exporterId: EXPRESSIONS_EXPORTER_ID, brand: "XF Expressions",
  selectorLabel: "Photo mode expressions", selector: "vanilla" });
/** Framework versions the files are written for (the sources studied: ArchiveXL 1.27.3, TweakXL 1.11.4). */
export const EXPRESSIONS_REQUIREMENTS = Object.freeze({ ArchiveXL: "1.27.3", TweakXL: "1.11.4" });
/** "For sharing": XF rows start here, after filler rows that keep every index at its position. */
export const SHARING_FIRST_INDEX = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const compact = (uuid: string) => uuid.replaceAll("-", "");
const refuse = (code: string, message: string): never => { throw new ExportRefusal(code, message); };
/** Case-insensitive ordinal order, as the resolver sorts mod archives (knowledge/mod-loading.md). */
const before = (a: string, b: string) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y || (x === y && a < b); };

/** Omission reasons follow the expression's photo-mode name in quotes. */
export const NO_CONTROLS_REASON = "has no face movements set, and photo mode already has a neutral face.";
export const DAMAGED_REASON = "is damaged, so XF Studio can't read it.";
/** A face control's readable name ("Inner brow raise, left"); a name the game's rig lacks reads as its words. */
export function movementName(name: string): string {
  const side = controlSide(name), label = controlLabel(name);
  return side && !/, (?:left|right)$/.test(label) ? `${label}, ${side}` : label;
}
export const GAME_UNREAD_NOTE = "XF Studio is reading your game files; this check runs again by itself when it has them.";

export type PlannedExpression = { readonly id: string; readonly name: string; readonly revision: number; readonly label: string; readonly clip: string;
  readonly index: number | null; readonly controls: readonly (readonly [string, number])[] };
export type ExpressionPlan = {
  readonly exporter: string; readonly version: string; readonly collectionId: string; readonly namespace: string; readonly archive: string;
  readonly modName: string; readonly table: "installed" | "sharing"; readonly overlay: string; readonly tweak: string;
  readonly paths: { readonly sets: Readonly<Record<Gender, string>>; readonly patch: string; readonly table: string };
  readonly component: { readonly name: string; readonly id: string; readonly hash: string };
  /** The table the rows go after: its row count, SHA-256 and who provides it (null until the game files are read). */
  readonly carried: { readonly rows: number; readonly sha256: string; readonly provider: string; readonly archive: string } | null;
  /** Filler rows (for sharing): indices `from` to `to - 1`. */
  readonly filler: { readonly from: number; readonly to: number } | null;
  readonly expressions: readonly PlannedExpression[];
};
type Outcome = FeatureOutcome<ExpressionPlan>;
type Look = { id?: unknown; name?: unknown; revision?: unknown; parts?: Record<string, { schema?: unknown; body?: unknown }> };

/** Whether a package collection is an expression set's (the only collections this exporter packages). */
function presetSet(collection: unknown): { table: "installed" | "sharing" } | undefined {
  const value = collection as { schema?: unknown; presetSet?: { table?: unknown } } | null;
  if (!value || value.schema !== COLLECTION_2 || !value.presetSet || typeof value.presetSet !== "object") return undefined;
  return { table: value.presetSet.table === "sharing" ? "sharing" : "installed" };
}

function plan(input: Parameters<FeatureExporter<ExpressionPlan>["plan"]>[0]): Outcome {
  const set = presetSet(input.collection);
  const collection = input.collection as { id: string; name: string; presets: Look[] };
  if (!set) return refuse("no_exportable_content", "Expressions become mods through expression sets: add your saved expressions to a set.");
  if (!input.product) return refuse("invalid_collection", "The expression set's mod wasn't planned.");
  const game = input.prerequisites[EXPRESSIONS_GAME_PREREQUISITE] === undefined ? null : readGameInputs(input.prerequisites[EXPRESSIONS_GAME_PREREQUISITE]);
  const namespace = `xfs_x${compact(collection.id).slice(0, 12)}`, archive = input.product.archive;
  const omissions: ExportOmission[] = [], packaged: { id: string; name: string; label: string; controls: Record<string, number> }[] = [];
  const eligible: Omit<PlannedExpression, "index" | "clip">[] = [];
  for (const look of collection.presets) {
    const id = String(look.id ?? ""), name = typeof look.name === "string" ? look.name : "Expression";
    const envelope = look.parts?.[EXPRESSIONS_FEATURE];
    if (!envelope) continue;
    let shown = name;
    const omit = (reason: string) => { omissions.push({ kind: "preset", presetId: id, presetName: shown, reason: `“${shown}” ${reason}` }); };
    let part: ReturnType<typeof parseExpressionPart>;
    try {
      if (!UUID.test(id) || envelope.schema !== EXPRESSION_PART_1 || !Number.isInteger(look.revision)) throw Error("damaged");
      part = parseExpressionPart(envelope.body);
    } catch { omit(DAMAGED_REASON); continue; }
    // The name photo mode shows is the one everything says (its label, else the saved expression's name).
    shown = (part.label?.trim() || name).slice(0, 120);
    const controls = Object.entries(part.controls).filter(([, weight]) => weight > 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (!controls.length) { omit(NO_CONTROLS_REASON); continue; }
    if (game) {
      const vector = Object.fromEntries(controls);
      const missing = [...new Set((Object.keys(GENDERS) as Gender[]).flatMap(gender => unknownControls(vector, game.rigs[gender].tracks, game.rigs[gender].main)))].sort();
      if (missing.length) { omit(`uses ${missing.length === 1 ? "a face movement" : "face movements"} your game doesn't have: ${missing.map(movementName).join(", ")}.`); continue; }
    }
    eligible.push({ id, name, revision: look.revision as number, label: shown, controls });
    packaged.push({ id, name, label: shown, controls: Object.fromEntries(controls) });
  }
  if (!eligible.length)
    throw new ExportRefusal("no_exportable_content", "Nothing in this set can become mod files yet.", undefined, omissions);
  // Clip names: the namespace and the saved expression's ID (stable across renames); the full ID if two would share a name.
  const short = eligible.map(item => `${namespace}_${compact(item.id).slice(0, 12)}`);
  const clash = new Set(short).size !== short.length;
  // One note says the one thing to know (a conflict first); everything else is guidance for the result's Details.
  const warnings: string[] = [], guidance: string[] = [];
  let summary: string | undefined;
  let carried: ExpressionPlan["carried"] = null, filler: ExpressionPlan["filler"] = null, first: number | null = null;
  const overlay = `0${archive}_table`;
  if (!game) summary = GAME_UNREAD_NOTE;
  else {
    const source = set.table === "sharing" ? game.base : game.table;
    if (sha256(JSON.stringify(source.rows)) !== source.sha256) refuse("invalid_collection", "What XF Studio read from your game files for expressions is damaged. Build again.");
    const indices = source.rows.map(row => Number(row[0]));
    if (indices.some((value, position) => !Number.isInteger(value) || value !== position))
      warnings.push("Photo mode's expression list numbers its rows out of order, so these expressions may show the wrong face.");
    const next = Math.max(-1, ...indices.filter(Number.isInteger)) + 1;
    carried = { rows: source.rows.length, sha256: source.sha256, provider: source.provider, archive: source.archive };
    if (set.table === "sharing") { first = Math.max(SHARING_FIRST_INDEX, next); filler = first > next ? { from: next, to: first } : null; }
    else first = next;
    if (set.table === "installed" && game.table.provider !== game.base.provider)
      summary = `Keeps the ${game.table.rows.length} expressions from ${game.table.provider} working. Build again if you add or remove expression mods.`;
    if (set.table === "sharing") summary = "Made for sharing: it carries only the game's own expressions, so another expression mod's list may win over it.";
    // Who else provides the table, and whether this mod's list loads first.
    const others = game.providers.filter(item => item.group === "mod" && item.name.toLowerCase() !== overlay.toLowerCase());
    const xf = others.filter(item => /^0xfs_[cm][0-9a-f]{32}_table$/i.test(item.name));
    if (xf.length) warnings.push(`Another XF expressions mod (${xf.map(item => item.provider).join(", ")}) also provides photo mode's expression list: install only one.`);
    if (game.modOrder === "modlist") warnings.push(`Your archive load order list decides which expression list wins: after installing, put ${overlay}.archive first in archive/pc/mod/modlist.txt.`);
    else {
      const ahead = others.filter(item => !xf.includes(item) && before(item.name, overlay));
      if (ahead.length) warnings.push(`${ahead.map(item => item.provider).join(", ")} loads its expression list before this mod's: rename or remove it, then check again.`);
    }
  }
  const notes = [...warnings, ...(summary ? [summary] : [])].slice(0, 1);
  guidance.push(...[...warnings, ...(summary ? [summary] : [])].slice(1));
  const expressions = eligible.map((item, position): PlannedExpression => ({ ...item, clip: clash ? `${namespace}_${compact(item.id)}` : short[position]!,
    index: first === null ? null : first + position }));
  const folder = `base/animations/xfs/expressions/${namespace}`;
  const sets = { female: `${folder}/xfs_expressions_female.anims`, male: `${folder}/xfs_expressions_male.anims` };
  const component = `xfs_expressions_${namespace.slice(4)}`;
  const planned: ExpressionPlan = {
    exporter: EXPRESSIONS_EXPORTER_ID, version: EXPRESSIONS_EXPORTER_VERSION, collectionId: collection.id, namespace, archive, modName: input.product.modName,
    table: set.table, overlay, tweak: `${archive}.yaml`, paths: { sets, patch: `${folder}/${namespace}_face_rig_patch.app`, table: EXPRESSION_TABLE_PATH },
    component: { name: component, id: componentId(sha256(`xfs-expressions-component:${namespace}`)),
      hash: componentId(sha256(`xfs-expressions-setup:${namespace}`)) }, carried, filler, expressions,
  };
  // The package-only snapshot the verifier checks against: the table choice and each packaged expression's label and weights.
  const text = JSON.stringify({ table: set.table, expressions: packaged });
  const check: FeatureCheck = {
    feature: EXPRESSIONS_FEATURE, label: "Expressions", exporter: EXPRESSIONS_EXPORTER_ID, exporterVersion: EXPRESSIONS_EXPORTER_VERSION, namespace,
    brand: EXPRESSIONS_EXPORT.brand, selectorLabel: EXPRESSIONS_EXPORT.selectorLabel, selector: EXPRESSIONS_EXPORT.selector,
    presets: expressions.map(item => ({ id: item.id, revision: item.revision, appearance: item.clip, ...(item.index === null ? {} : { faceId: item.index }),
      label: item.label })),
    omissions, experimental: [], notes, requirements: EXPRESSIONS_REQUIREMENTS, packagedSha256: sha256(text),
    // Provisional until the game files have been read for this route: indices and face-rig checks wait for them.
    details: { table: set.table, overlay, carried, filler, genders: Object.keys(GENDERS), guidance, ...(game ? {} : { provisional: true }) },
  };
  return { check, plan: planned, packaged: text, inventory: [sets.female, sets.male, planned.paths.patch].sort(),
    xl: { patch: { [planned.paths.patch]: [FACE_RIG_APP_PATH] } },
    extras: { tweaks: [planned.tweak], overlays: [{ archive: overlay, inventory: [EXPRESSION_TABLE_PATH] }] } };
}

/** The table rows the build writes: the carried table, any filler, then one row per expression. */
export function plannedRows(planned: ExpressionPlan, game: GameInputs): string[][] {
  const source = planned.table === "sharing" ? game.base : game.table;
  if (!planned.carried || source.sha256 !== planned.carried.sha256) return refuse("package_build_failed", "Photo mode's expression list changed while building. Build again.");
  const rows = source.rows.map(row => [...row]);
  if (planned.filler) for (let index = planned.filler.from; index < planned.filler.to; index++) rows.push(fillerRow(index));
  for (const item of planned.expressions) rows.push(expressionRow(item.index!, item.clip));
  return rows;
}

const hashFile = (path: string): GeneratedFile => { const data = readFileSync(path); return { path, bytes: data.byteLength, sha256: sha256(data) }; };

export const EXPRESSIONS_EXPORTER: FeatureExporter<ExpressionPlan> = Object.freeze<FeatureExporter<ExpressionPlan>>({
  id: EXPRESSIONS_EXPORTER_ID, version: EXPRESSIONS_EXPORTER_VERSION, feature: EXPRESSIONS_FEATURE, label: "Expressions", info: EXPRESSIONS_EXPORT,
  prerequisites: [EXPRESSIONS_GAME_PREREQUISITE],
  present(collection: unknown) {
    return !!presetSet(collection) && ((collection as { presets?: Look[] }).presets ?? []).some(look => !!look?.parts?.[EXPRESSIONS_FEATURE]);
  },
  plan,
  checkInputs(prerequisites) {
    // A developer's Check with a prepared file plans on what it read.
    const value = prerequisites[EXPRESSIONS_GAME_PREREQUISITE] as Partial<GameBuilderInputs> | undefined;
    if (typeof value?.file !== "string") return {};
    try { return { [EXPRESSIONS_GAME_PREREQUISITE]: (JSON.parse(readFileSync(value.file, "utf8")) as GameFile).plan }; } catch { return {}; }
  },
  async buildInputs(context) {
    const value = context.prerequisites[EXPRESSIONS_GAME_PREREQUISITE] as Partial<GameBuilderInputs> | undefined;
    if (typeof value?.file !== "string") return refuse("package_input_missing", "XF Studio couldn't read photo mode's expressions from your game files.");
    // A prepared file that can't be read is stale: the host discards it and prepares it again (PIPE-118).
    let inputs: GameInputs;
    try { inputs = readGameInputs((JSON.parse(readFileSync(value.file, "utf8")) as GameFile).plan); }
    catch { throw new PrerequisiteStale(EXPRESSIONS_GAME_PREREQUISITE, GAME_INPUTS_DAMAGED); }
    return { prerequisites: { [EXPRESSIONS_GAME_PREREQUISITE]: inputs, [`${EXPRESSIONS_GAME_PREREQUISITE}#file`]: value.file } };
  },
  async build(outcome, context) {
    const planned = outcome.plan;
    const game = readGameInputs(context.prerequisites[EXPRESSIONS_GAME_PREREQUISITE]);
    const fileAt = context.prerequisites[`${EXPRESSIONS_GAME_PREREQUISITE}#file`];
    if (typeof fileAt !== "string" || planned.expressions.some(item => item.index === null))
      return refuse("package_input_missing", "XF Studio couldn't read photo mode's expressions from your game files.");
    const documents = JSON.parse(readFileSync(fileAt, "utf8")) as GameFile;
    mkdirSync(context.work, { recursive: true });
    const json = join(context.work, "json");
    const convert = async (document: unknown, depotPath: string, into: string): Promise<string> => {
      const source = join(json, `${depotPath.split("/").at(-1)}.json`), target = join(into, ...depotPath.split("/"));
      mkdirSync(dirname(source), { recursive: true }); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(source, JSON.stringify(document, null, 2), "utf8");
      const step = await context.tools.deserialize(source, dirname(target));
      if (step.exitCode !== 0) refuse("package_tool_failed", `WolvenKit couldn't write ${depotPath.split("/").at(-1)}.`);
      context.log(`expressions: wrote ${depotPath}`);
      return target;
    };
    const files: GeneratedFile[] = [];
    const clips = planned.expressions.map(item => ({ clip: item.clip, controls: item.controls }));
    const record: Record<string, unknown> = { plan: planned, sets: {} };
    for (const gender of Object.keys(GENDERS) as Gender[]) {
      const built = animationSet(documents.sets[gender], game.rigs[gender], clips);
      (record.sets as Record<string, unknown>)[gender] = built.buffers.map(buffer => sha256(buffer));
      files.push({ ...hashFile(await convert(built.document, planned.paths.sets[gender], context.staging)), path: planned.paths.sets[gender] });
    }
    files.push({ ...hashFile(await convert(faceRigPatch(documents.faceRig, planned.component, planned.paths.sets), planned.paths.patch, context.staging)),
      path: planned.paths.patch });
    // The extras: the table in its overlay, and the TweakXL records.
    const rows = plannedRows(planned, game);
    const overlayRoot = join(context.extras, "overlays", planned.overlay);
    const table = await convert(expressionTable(documents.table, rows), EXPRESSION_TABLE_PATH, overlayRoot);
    const tweakPath = `r6/tweaks/${planned.archive}/${planned.tweak}`, tweak = join(context.extras, ...tweakPath.split("/"));
    mkdirSync(dirname(tweak), { recursive: true });
    writeFileSync(tweak, tweakRecords(planned.expressions.map(item => ({ clip: item.clip, label: item.label, index: item.index! })), planned.modName), "utf8");
    writeFileSync(join(context.work, "build-record.json"), JSON.stringify({ ...record, rows: rows.length }, null, 2), "utf8");
    return { files: files.sort((a, b) => a.path < b.path ? -1 : 1),
      extras: [{ ...hashFile(table), path: `overlays/${planned.overlay}/${EXPRESSION_TABLE_PATH}` }, { ...hashFile(tweak), path: tweakPath }]
        .sort((a, b) => a.path < b.path ? -1 : 1) };
  },
  accept(outcome, verification) {
    const report = verification.report as { expressions?: unknown };
    if (verification.presetCount !== outcome.plan.expressions.length ||
        JSON.stringify(report.expressions) !== JSON.stringify(outcome.plan.expressions.map(item => ({ id: item.id, clip: item.clip, index: item.index }))))
      refuse("package_verification_failed", "Independent verification does not match the build.");
  },
});
