/**
 * Eye makeup's mod exporter (feature-module platform §6), branded by mod-branding. It wraps the existing package
 * pipeline unchanged: the partial-export filter and plan (`package-filter`, `preset-collection`), the
 * 32-pixel compiler preflight, the resource builder (`package-resource-builder`) and the plate input. The
 * export host (platform/export) packs its resources with any other feature's into one archive and runs the
 * independent verifier (`../verify`). Host only (Node); the browser bundle never reaches it.
 *
 * The src pipeline modules it imports are legacy until they move into this folder; the boundary test lists
 * each with the condition that removes it.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ExportRefusal, PrerequisiteStale, type ExportWarning, type FeatureCheck, type FeatureExporter, type FeatureOutcome } from "../../../platform/api";
import { parsePlateUvFootprint } from "../../../engines/layered-makeup/plate-uv-window";
import { compilePreset } from "../../../engines/layered-makeup/preset-compiler";
import { COLLECTION_2 } from "../../../platform/api";
import { EYE_MAKEUP_FEATURE, readRecipe } from "../../../recipe-schema";
import { packagePresetIdentities, PLATE_REACH_UNCHECKED_NOTE, preparePackageCollection } from "../../../package-filter";
import { expectedPaths } from "../../../archive-inventory";
import { eyeMakeupXl } from "../../../package-resources";
import { buildEyeMakeupResources, MASCULINE_PLATE_STEMS, MasculinePlateFootprintChangedError, PlateFootprintChangedError,
  type BuildRecord } from "../../../package-resource-builder";
import { PackageToolError } from "../../../package-build-wolvenkit";
import { NO_EYE_MAKEUP_REASON, type planCollection } from "../../../preset-collection";
import type { PlateReachInput } from "../../../plate-reach";
import type { PackagePlate } from "../../../package-action";
import { EYE_MAKEUP_REGION } from "../region";
import { EYE_MAKEUP_EXPORT, EYE_MAKEUP_EXPORTER_ID, EYE_PLATE_MASCULINE_PREREQUISITE, EYE_PLATE_PREREQUISITE } from "../export-info";
import { unavailablePlate } from "../../../eye-plate-service";
import { manifestPlateReach, plateBuilderInput, plateBuildValue, type PlateBuildValue } from "./plate-input";

/** Bumped whenever the same input would build different bytes. */
export const EYE_MAKEUP_EXPORTER_VERSION = "1";
export type EyeMakeupPlan = ReturnType<typeof planCollection>;
type Outcome = FeatureOutcome<EyeMakeupPlan>;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const refuse = (code: string, message: string): never => { throw new ExportRefusal(code, message); };
const DIAGNOSTICS_REFUSAL = "This collection carries diagnostic export knobs, which only build a prepared in-game test candidate. " +
  "Pass --diagnostics to build one on purpose, or export the collection again from XF Studio.";

/**
 * Who the mod is for. A Build names the plate it packages for the masculine V or why there is none; so does a Check once
 * a Build prepared his plate for this route (or found it couldn't). Before that, Check plans on including him and its one
 * note says Build checks that. When he isn't included, the result's product line says so (`audience`) and one warning
 * says why and what to do (`warnings`).
 */
export const AUDIENCE_BOTH = "for a feminine and a masculine V";
export const AUDIENCE_FEMININE = "for a feminine V only";
/** Check's one note before any Build prepared the plates for this route: what Build will still decide. */
export const CHECK_BUILD_DECIDES_NOTE = "Build checks which looks reach the eye area and whether the mod can also fit a masculine V.";
export const CHECK_MASCULINE_NOTE = "Build checks whether the mod can also fit a masculine V.";
/** A developer's CLI build given no masculine plate (the hosts always prepare one). */
export const MASCULINE_NOT_PREPARED: ExportWarning = { text: "No masculine V plate was given to this build; pass --plate-masculine to include him." };
/** His plate's texture window differs from hers: only a head mod can move the head's eye UVs (the 2.31 heads share them). */
export const MASCULINE_WINDOW: ExportWarning = { next: "settings.game",
  text: "A head mod moves the masculine V's eye area, so these looks can't fit him; choose “The unmodified game head” for both heads to include him." };
type MasculineDecision = { include: boolean; unchecked?: true; warning?: ExportWarning; plate?: PlateReachInput & { record?: PackagePlate } };
function masculineDecision(value: unknown, feminine: (PlateReachInput & { record?: PackagePlate }) | null): MasculineDecision {
  const unavailable = unavailablePlate(value);
  if (unavailable) return { include: false, warning: { text: unavailable.message, ...(unavailable.next ? { next: unavailable.next } : {}) } };
  // Without a value, a Build (whose feminine plate carries its provenance) prepared none; a Check just doesn't know yet.
  if (value === undefined || value === null) return feminine?.record ? { include: false, warning: MASCULINE_NOT_PREPARED } : { include: true, unchecked: true };
  const plate = planPlate(value)!;
  // One texture set serves both plates only when their windows agree (the male head uses the female head's UVs, 2.31).
  if (feminine && JSON.stringify(plate.footprint.window) !== JSON.stringify(feminine.footprint.window)) return { include: false, warning: MASCULINE_WINDOW };
  return { include: true, plate };
}

/** The plate a plan is made on: its UV footprint (and, when a Build prepared it, its provenance record), or none yet. */
function planPlate(value: unknown): (PlateReachInput & { record?: PackagePlate }) | null {
  if (value === undefined || value === null) return null;
  const plate = value as { footprint?: unknown; sha256?: unknown; record?: PackagePlate };
  if (typeof plate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(plate.sha256))
    return refuse("invalid_collection", "The eye plate's UV footprint is damaged. Build again to prepare the plate afresh.");
  return { footprint: parsePlateUvFootprint(plate.footprint), sha256: plate.sha256, ...(plate.record ? { record: plate.record } : {}) };
}

function plan(input: { collection: unknown; prerequisites: Readonly<Record<string, unknown>>; diagnostics: boolean }): Outcome {
  const value = input.collection;
  if (!input.diagnostics && value && typeof value === "object" && "diagnostics" in value) refuse("invalid_collection", DIAGNOSTICS_REFUSAL);
  const plate = planPlate(input.prerequisites[EYE_PLATE_PREREQUISITE]);
  const masculine = masculineDecision(input.prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE], plate);
  let prepared: ReturnType<typeof preparePackageCollection>;
  try { prepared = preparePackageCollection(value, EYE_MAKEUP_REGION, plate, { masculine: masculine.include }); }
  catch (error) {
    const message = (error as Error).message;
    return refuse(message.startsWith("No mod files can be made") || message.startsWith("This collection has no eye-makeup looks")
      ? "no_exportable_content" : "invalid_collection", message);
  }
  const planned = prepared.plan, packaged = JSON.stringify(prepared.packaged);
  // Whole looks are the export host's to decide once, across every feature (PIPE-88): a look without eye makeup is not
  // eye makeup's omission, and neither is a look an older request's collection-1 view already left out (the host reads
  // those itself). What stays is eye makeup's own: its layers, and looks whose eye makeup it packages nothing of.
  const collection2 = (value as { schema?: unknown } | null)?.schema === COLLECTION_2;
  const notOurs = new Set((prepared.source.omitted ?? []).filter(item => item.feature === undefined &&
    (!collection2 || item.reason === NO_EYE_MAKEUP_REASON)).map(item => item.presetId));
  const check: FeatureCheck = {
    feature: EYE_MAKEUP_FEATURE, label: "Eye makeup", exporter: EYE_MAKEUP_EXPORTER_ID, exporterVersion: EYE_MAKEUP_EXPORTER_VERSION,
    namespace: planned.namespace, brand: planned.modName, selectorLabel: planned.selectorLabel, selector: EYE_MAKEUP_EXPORT.selector,
    presets: packagePresetIdentities(planned),
    // Another feature's part of a look is the export host's to report (it knows which features have exporters).
    omissions: prepared.omissions.filter(item => item.kind !== "part" && !(item.kind === "preset" && notOurs.has(item.presetId))),
    experimental: prepared.experimental,
    // Before any plate was prepared for this route, Check cannot tell which looks reach the eye area; Build does (PIPE-36).
    // One note at most: what Build still decides (plate reach before any plate was prepared, and whether he fits).
    notes: !prepared.plateUv ? [masculine.unchecked ? CHECK_BUILD_DECIDES_NOTE : PLATE_REACH_UNCHECKED_NOTE] : masculine.unchecked ? [CHECK_MASCULINE_NOTE] : [],
    // Before a Build has checked him, the product line names no one: its note says Build decides whether he fits (UI-148).
    ...(masculine.unchecked ? {} : { audience: masculine.include ? AUDIENCE_BOTH : AUDIENCE_FEMININE }),
    ...(masculine.warning ? { warnings: [masculine.warning] } : {}),
    requirements: planned.requirements,
    packagedSha256: sha256(packaged),
    // `bodies`: whose creators get the selector. His plate's provenance is recorded beside hers when a Build prepared it.
    details: { plateLiftsMm: [...planned.plate.liftsMm], plateUv: prepared.plateUv, ...(plate?.record ? { plate: plate.record } : {}),
      bodies: masculine.include ? ["female", "male"] : ["female"],
      ...(masculine.plate?.record ? { masculinePlate: masculine.plate.record } : {}) },
  };
  return { check, plan: planned, packaged, inventory: [...expectedPaths(planned)].sort(), xl: eyeMakeupXl(planned) };
}

/** Eye makeup's exporter: one selector with an Off choice and one choice per packaged look. */
export const EYE_MAKEUP_EXPORTER: FeatureExporter<EyeMakeupPlan> = Object.freeze<FeatureExporter<EyeMakeupPlan>>({
  id: EYE_MAKEUP_EXPORTER_ID, version: EYE_MAKEUP_EXPORTER_VERSION, feature: EYE_MAKEUP_FEATURE, label: "Eye makeup",
  info: EYE_MAKEUP_EXPORT, prerequisites: [EYE_PLATE_PREREQUISITE], optionalPrerequisites: [EYE_PLATE_MASCULINE_PREREQUISITE],
  present(collection: unknown) {
    const value = collection as { schema?: unknown; presets?: unknown } | null;
    if (!value || !Array.isArray(value.presets)) return false;
    // A collection-1 file is eye makeup's own format: every preset holds a recipe.
    if (value.schema !== COLLECTION_2) return value.presets.length > 0;
    return value.presets.some(preset => !!(preset as { parts?: Record<string, unknown> } | null)?.parts?.[EYE_MAKEUP_FEATURE]);
  },
  plan,
  preflight(outcome: Outcome) {
    // Keep the compiler's strict active-layer gate in Check: a small compile of every packaged look.
    for (const preset of outcome.plan.presets) {
      try { compilePreset(readRecipe(preset.recipe, EYE_MAKEUP_REGION.models), EYE_MAKEUP_REGION, 32); }
      catch (error) { refuse("invalid_collection", (error as Error).message); }
    }
  },
  checkInputs(prerequisites) {
    // A developer's Check with a prepared plate's manifest plans on the footprint it records (his plate's too).
    const reachOf = (value: unknown) => {
      const plate = value as { manifest?: unknown } | undefined;
      return typeof plate?.manifest === "string" ? manifestPlateReach(plate.manifest) : null;
    };
    const reach = reachOf(prerequisites[EYE_PLATE_PREREQUISITE]), his = prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE];
    const hisReach = unavailablePlate(his) ? his : reachOf(his);
    return { ...reach ? { [EYE_PLATE_PREREQUISITE]: reach } : {}, ...hisReach ? { [EYE_PLATE_MASCULINE_PREREQUISITE]: hisReach } : {} };
  },
  protectedInputs(prerequisites) {
    const plate = prerequisites[EYE_PLATE_PREREQUISITE], his = prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE];
    return [...plate === undefined ? [] : [["plate source", plateBuilderInput(plate).directory] as const],
      ...his === undefined || unavailablePlate(his) ? [] : [["masculine plate source", plateBuilderInput(his).directory] as const]];
  },
  async buildInputs(context) {
    const plate = await plateBuildValue(plateBuilderInput(context.prerequisites[EYE_PLATE_PREREQUISITE]), context.tools, context.work);
    // His plate, when the host prepared one: its own files, provenance and footprint; else why there is none, as given.
    const given = context.prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE];
    const his = given === undefined || unavailablePlate(given) ? given
      : await plateBuildValue(plateBuilderInput(given), context.tools, join(context.work, "pma"), MASCULINE_PLATE_STEMS);
    return { prerequisites: { [EYE_PLATE_PREREQUISITE]: plate, ...his === undefined ? {} : { [EYE_PLATE_MASCULINE_PREREQUISITE]: his } } };
  },
  async build(outcome: Outcome, context) {
    const plate = context.prerequisites[EYE_PLATE_PREREQUISITE] as PlateBuildValue;
    const his = outcome.plan.masculine ? context.prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE] as PlateBuildValue : undefined;
    if (outcome.plan.masculine && (!his || typeof his.directory !== "string"))
      refuse("package_input_missing", "The masculine eye plate the plan includes was not prepared.");
    let record: BuildRecord;
    try {
      context.log(`Building ${outcome.check.presets.length} eye-makeup preset(s) in ignored local intermediates: ${context.work}`);
      record = await buildEyeMakeupResources({ collection: JSON.parse(outcome.packaged), work: context.work, staging: context.staging,
        plate: plate.directory, region: EYE_MAKEUP_REGION, plateUv: plate.footprint, tools: context.tools, signal: context.signal, log: context.log,
        ...(his ? { masculine: { plate: his.directory, plateUv: his.footprint } } : {}) });
    } catch (error) {
      if (error instanceof PackageToolError) refuse(error.code, error.code === "package_tool_failed"
        ? `WolvenKit failed while building resources: ${error.message}` : error.message);
      if (error instanceof ExportRefusal) throw error;
      // The builder found the cached plate's recorded UV footprint stale: the host discards it and builds once more (PIPE-37).
      if (error instanceof MasculinePlateFootprintChangedError)
        throw new PrerequisiteStale(EYE_PLATE_MASCULINE_PREREQUISITE, `${error.message} The host prepares the plate again.`);
      if (error instanceof PlateFootprintChangedError) throw new PrerequisiteStale(EYE_PLATE_PREREQUISITE, `${error.message} The host prepares the plate again.`);
      return refuse("package_build_failed", `Resource build failed: ${(error as Error).message}`);
    }
    const built = record.plan, planned = outcome.plan;
    if (built.collectionId !== planned.collectionId || built.namespace !== planned.namespace ||
        built.modName !== planned.modName || built.selectorLabel !== planned.selectorLabel ||
        JSON.stringify(packagePresetIdentities(built)) !== JSON.stringify(outcome.check.presets) ||
        JSON.stringify(built.plate.liftsMm) !== JSON.stringify(planned.plate.liftsMm) ||
        JSON.stringify(built.masculine ?? null) !== JSON.stringify(planned.masculine ?? null))
      refuse("package_identity_mismatch", "Compiled collection identities differ from preflight.");
    return { files: record.artifacts.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })) };
  },
  accept(outcome: Outcome, verification, context) {
    const plate = context.prerequisites[EYE_PLATE_PREREQUISITE] as PlateBuildValue;
    const report = verification.report as { presetRoutes?: unknown; plateInputs?: { mesh?: string; morph?: string };
      plateGeometry?: { liftsMm?: unknown }; bodies?: unknown; masculine?: { plateInputs?: { mesh?: string; morph?: string } } };
    const his = outcome.plan.masculine ? context.prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE] as PlateBuildValue : undefined;
    if (JSON.stringify(report.bodies) !== JSON.stringify(outcome.check.details.bodies) ||
        his && (report.masculine?.plateInputs?.mesh !== his.record.meshSha256 || report.masculine?.plateInputs?.morph !== his.record.morphSha256))
      refuse("package_verification_failed", "Independent verification does not match the build.");
    if (verification.presetCount !== outcome.check.presets.length ||
        report.plateInputs?.mesh !== plate.record.meshSha256 || report.plateInputs?.morph !== plate.record.morphSha256 ||
        JSON.stringify(report.presetRoutes) !== JSON.stringify(outcome.check.presets.map(p => ({ id: p.id, route: p.route }))) ||
        JSON.stringify(report.plateGeometry?.liftsMm) !== JSON.stringify(outcome.check.details.plateLiftsMm))
      refuse("package_verification_failed", "Independent verification does not match the build.");
  },
});
