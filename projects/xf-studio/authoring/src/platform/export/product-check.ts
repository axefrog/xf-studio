/**
 * Check for every product of a collection (feature-module platform §6 "Pipeline", step 1): plan the
 * products, run each feature's eligibility and plan (and, for Check, its preflight), then the product
 * checks: no two features share a depot path or a namespace, each product's `.xl` fragments merge, and a
 * product's framework requirements take the highest version per framework. Shared by the builder (in its
 * child process), the Check worker and the hosts' result gates, so every one plans exactly alike.
 *
 * Omissions are decided here once (PIPE-88): a whole look is left out only when no feature of any product packages
 * anything of it; a feature's own list keeps what it leaves out of looks that are packaged (its layers, or its part of
 * a look another feature packages); and each product records only the omissions of its own features and looks.
 */
import { COLLECTION_1, COLLECTION_2 } from "../api/document";
import {
  ExportRefusal, mergeXlFragments, NO_EXPORTER_REASON, NOTHING_PACKAGED_REASON, PACKAGE_CHECK_2, PackagePlanConflict, PLAN_ISSUE_CODE,
  PLAN_ISSUE_MESSAGE, readPackagePlan, type ExportOmission, type FeatureExporterEntry, type FeatureOutcome, type FrameworkRequirements,
  type ModPackagePlan, type PackageCheckResult, type ProductCheck, type XlFragment,
} from "../api/export";
import { planProducts, type PlannedProduct } from "../core/package-plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INVALID = "Expected a named XF Studio collection with a stable UUID and at least one preset.";
const UNCHANGED = "Nothing was built; your collection is unchanged.";
const refuse = (code: string, message: string, detail?: string): never => { throw new ExportRefusal(code, message, detail); };

/** A look an older request's collection-1 view already left out (`omitted`), with its recorded reason. */
type LegacyOmission = { readonly presetId: string; readonly presetName: string; readonly reason: string; readonly feature?: string };
/** What the platform reads of a collection before any exporter: identities, which features each look holds, and the package plan. */
export type CollectionIdentity = {
  readonly id: string; readonly name: string; readonly schema: typeof COLLECTION_1 | typeof COLLECTION_2;
  /** Each look; `parts` lists its features (a collection-1 look is one exporter's own format and lists none). */
  readonly looks: readonly { readonly id: string; readonly name: string; readonly parts?: readonly string[] }[];
  /** Looks a collection-1 view already left out (an older request's `omitted`), counted as looks of the collection. */
  readonly omittedLooks: number;
  /** Those looks and parts, with the reasons the older request recorded. */
  readonly legacyOmissions: readonly LegacyOmission[];
  readonly packagePlan?: ModPackagePlan;
};

/**
 * A collection's identity; throws `ExportRefusal("invalid_collection")` on anything else. A package plan this build
 * can't use is refused with `package_plan_newer` or `package_plan_damaged` (CORE-91), and one putting a feature into
 * two mods with `namespace_duplicated`, named by its label from `labels` (PIPE-93).
 */
export function readCollectionIdentity(value: unknown, labels: Readonly<Record<string, string>> = {}): CollectionIdentity {
  const input = value as { schema?: unknown; id?: unknown; name?: unknown; presets?: unknown; packagePlan?: unknown; omitted?: unknown } | null;
  if (!input || (input.schema !== COLLECTION_1 && input.schema !== COLLECTION_2) || typeof input.id !== "string" || !UUID.test(input.id) ||
      typeof input.name !== "string" || !input.name.trim() || !Array.isArray(input.presets) || !input.presets.length)
    return refuse("invalid_collection", INVALID);
  const looks = input.presets.map(item => {
    const look = item as { id?: unknown; name?: unknown; parts?: unknown } | null;
    if (!look || typeof look.id !== "string" || typeof look.name !== "string") return refuse("invalid_collection", INVALID);
    const parts = input.schema === COLLECTION_2 && look.parts && typeof look.parts === "object" ? Object.keys(look.parts) : undefined;
    return { id: look.id, name: look.name, ...(parts ? { parts } : {}) };
  });
  let packagePlan: ModPackagePlan | undefined;
  if (input.packagePlan !== undefined) {
    const read = readPackagePlan(input.packagePlan);
    if ("issue" in read) {
      // A plan putting one feature into two mods is damaged, but has its own code and names the feature.
      if (read.issue === "damaged") {
        try { strictConflict(input.packagePlan, labels); }
        catch (error) { if (error instanceof PackagePlanConflict) return refuse(error.code, error.message); throw error; }
      }
      return refuse(PLAN_ISSUE_CODE[read.issue], PLAN_ISSUE_MESSAGE[read.issue]);
    }
    packagePlan = read.plan;
  }
  // The eye-makeup exporter validates an older request's `omitted` strictly; here only well-formed entries are read.
  const legacyOmissions: LegacyOmission[] = input.schema === COLLECTION_1 && Array.isArray(input.omitted)
    ? input.omitted.flatMap(item => {
      const entry = item as Partial<LegacyOmission> | null;
      return entry && typeof entry.presetId === "string" && typeof entry.presetName === "string" && typeof entry.reason === "string" &&
        (entry.feature === undefined || typeof entry.feature === "string")
        ? [{ presetId: entry.presetId, presetName: entry.presetName, reason: entry.reason, ...(entry.feature !== undefined ? { feature: entry.feature } : {}) }]
        : [];
    }) : [];
  const omittedLooks = legacyOmissions.filter(item => item.feature === undefined).length;
  return { id: input.id, name: input.name, schema: input.schema, looks, omittedLooks, legacyOmissions, ...(packagePlan ? { packagePlan } : {}) };
}

/** Throws the labelled `PackagePlanConflict` when a plan-1 plan names one feature in two products. */
function strictConflict(value: unknown, labels: Readonly<Record<string, string>>): void {
  const products = (value as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) return;
  const seen = new Set<string>();
  for (const product of products) for (const feature of (product as { features?: unknown } | null)?.features as unknown[] ?? []) {
    if (typeof feature !== "string") continue;
    if (seen.has(feature)) throw new PackagePlanConflict(feature, labels[feature]);
    seen.add(feature);
  }
}

/** One product of a Check with what its build needs: each feature's exporter entry and outcome, and the merged `.xl`. */
export type ProductOutcome = {
  readonly product: PlannedProduct;
  readonly features: readonly { readonly entry: FeatureExporterEntry; readonly outcome: FeatureOutcome }[];
  readonly xl: XlFragment;
  readonly check: ProductCheck;
};
export type ProductsCheck = { readonly result: PackageCheckResult; readonly products: readonly ProductOutcome[] };

/** Compare dotted versions numerically ("1.27.3" < "1.28"). */
function newer(a: string, b: string): boolean {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
/** The highest version per framework. */
export function mergeRequirements(all: readonly FrameworkRequirements[]): FrameworkRequirements {
  const merged: Record<string, string> = {};
  for (const requirements of all) for (const [framework, version] of Object.entries(requirements))
    if (merged[framework] === undefined || newer(version, merged[framework])) merged[framework] = version;
  return merged;
}

/**
 * Plan every product and run each feature's eligibility and plan. With `preflight` (Check) each feature's
 * preflight runs too. A feature with nothing to package is reported and left out, and so is a product left
 * with no feature; when nothing at all remains, the first feature's refusal is the answer.
 */
export function checkProducts(options: { readonly collection: unknown; readonly exporters: readonly FeatureExporterEntry[];
  readonly prerequisites: Readonly<Record<string, unknown>>; readonly diagnostics: boolean; readonly preflight: boolean;
  readonly collectionSha256: string }): ProductsCheck {
  const entries = new Map(options.exporters.map(entry => [entry.exporter.feature, entry]));
  const labels = Object.fromEntries(options.exporters.map(entry => [entry.exporter.feature, entry.exporter.label]));
  const label = (feature: string) => labels[feature] ?? feature;
  const identity = readCollectionIdentity(options.collection, labels);
  // Parts of a feature no registered exporter packages: reported once, by look (and those an older request's view left out).
  const parts: ExportOmission[] = [
    ...identity.looks.flatMap(look => (look.parts ?? []).filter(feature => !entries.has(feature))
      .map(feature => ({ kind: "part" as const, presetId: look.id, presetName: look.name, feature, reason: NO_EXPORTER_REASON }))),
    ...identity.legacyOmissions.flatMap(item => item.feature === undefined ? []
      : [{ kind: "part" as const, presetId: item.presetId, presetName: item.presetName, feature: item.feature, reason: item.reason }])];
  const present = options.exporters.filter(entry => entry.exporter.present(options.collection));
  let planned: PlannedProduct[];
  try {
    planned = planProducts({ collectionId: identity.id, collectionName: identity.name, plan: identity.packagePlan,
      features: present.map(entry => ({ id: entry.exporter.feature, label: entry.exporter.label, brand: entry.exporter.info.brand })) });
  } catch (error) {
    if (error instanceof PackagePlanConflict) return refuse(error.code, error.message);
    throw error;
  }
  if (!planned.length) refuse("no_exportable_content",
    "No mod files can be made: no look in this collection has anything XF Studio can make into mod files yet. Your collection is unchanged.");
  const refusals: ExportRefusal[] = [];
  const left: { omission: ExportOmission; product: string }[] = [];
  const built: { product: PlannedProduct; features: { entry: FeatureExporterEntry; outcome: FeatureOutcome }[]; xl: XlFragment }[] = [];
  for (const product of planned) {
    const features: { entry: FeatureExporterEntry; outcome: FeatureOutcome }[] = [];
    for (const feature of product.features) {
      const entry = entries.get(feature)!;
      try {
        const outcome = entry.exporter.plan({ collection: options.collection, prerequisites: options.prerequisites, diagnostics: options.diagnostics });
        if (options.preflight) entry.exporter.preflight?.(outcome);
        features.push({ entry, outcome });
      } catch (error) {
        if (!(error instanceof ExportRefusal) || error.code !== "no_exportable_content") throw error;
        refusals.push(error);
        left.push({ omission: { kind: "feature", feature, label: entry.exporter.label, reason: error.message }, product: product.id });
      }
    }
    if (!features.length) continue;
    let xl: XlFragment;
    try { xl = mergeXlFragments(features.map(item => item.outcome.xl)); }
    catch (error) {
      return refuse("package_conflict", `XF Studio couldn't prepare the ArchiveXL file for the mod “${product.modName}”. ${UNCHANGED}`,
        (error as Error).message);
    }
    built.push({ product, features, xl });
  }
  if (!built.length) throw refusals[0];
  // Resources and selectors are feature-scoped: no two features may claim the same depot path or namespace,
  // whichever products they ship in (the game sees every installed archive at once). The person sees the features'
  // labels; the namespace or path goes to the host log (PIPE-93).
  const paths = new Map<string, string>(), namespaces = new Map<string, string>();
  for (const { features } of built) for (const { outcome } of features) {
    const feature = outcome.check.feature;
    const other = namespaces.get(outcome.check.namespace);
    if (other) refuse("package_conflict", `${label(other)} and ${label(feature)} would use the same names in the game's files, so they can't be ` +
      `packaged together. ${UNCHANGED}`, `${other} and ${feature} use the same namespace ${outcome.check.namespace}.`);
    namespaces.set(outcome.check.namespace, feature);
    for (const path of outcome.inventory) {
      const owner = paths.get(path);
      if (owner) refuse("package_conflict", `${label(owner)} and ${label(feature)} would write the same game file, so they can't be packaged ` +
        `together. ${UNCHANGED}`, `${owner} and ${feature} both write ${path}.`);
      paths.set(path, feature);
    }
  }

  // Whole looks, decided once (PIPE-88): a look is left out whole only when no feature packages anything of it. A
  // feature's "preset" omission of such a look moves here (the look's reason, when the features agree on one); of a
  // look another feature packages, it stays the feature's own: its part of that look is left out.
  const packaged = new Set(built.flatMap(({ features }) => features.flatMap(({ outcome }) => outcome.check.presets.map(look => look.id))));
  const reported = new Map<string, { reasons: Set<string>; products: Set<string> }>();
  /** The looks each product's features package or report. */
  const productLooks = new Map<string, Set<string>>(built.map(({ product }) => [product.id, new Set<string>()]));
  for (const { product, features } of built) for (const { outcome } of features) {
    for (const look of outcome.check.presets) productLooks.get(product.id)!.add(look.id);
    for (const omission of outcome.check.omissions) {
      if (omission.kind !== "preset" && omission.kind !== "layer") continue;
      productLooks.get(product.id)!.add(omission.presetId);
      if (omission.kind !== "preset" || packaged.has(omission.presetId)) continue;
      const entry = reported.get(omission.presetId) ?? { reasons: new Set<string>(), products: new Set<string>() };
      entry.reasons.add(omission.reason); entry.products.add(product.id);
      reported.set(omission.presetId, entry);
    }
  }
  const whole: ExportOmission[] = [];
  const legacyWhole = identity.legacyOmissions.filter(item => item.feature === undefined);
  for (const look of [...identity.looks.map(look => ({ presetId: look.id, presetName: look.name, reason: undefined as string | undefined })), ...legacyWhole]) {
    if (packaged.has(look.presetId) || whole.some(item => item.kind === "preset" && item.presetId === look.presetId)) continue;
    const reasons = reported.get(look.presetId)?.reasons;
    whole.push({ kind: "preset", presetId: look.presetId, presetName: look.presetName,
      reason: reasons?.size === 1 ? [...reasons][0] : look.reason ?? NOTHING_PACKAGED_REASON });
  }
  const products: ProductOutcome[] = built.map(({ product, features, xl }) => {
    const kept = features.map(({ entry, outcome }) => ({ entry, outcome: { ...outcome, check: { ...outcome.check,
      omissions: outcome.check.omissions.filter(omission => omission.kind !== "preset" || packaged.has(omission.presetId)) } } }));
    return { product, features: kept, xl, check: { productId: product.id, modName: product.modName, nameSource: product.nameSource,
      archive: product.archive, isDefault: product.isDefault, features: kept.map(item => item.outcome.check),
      requirements: mergeRequirements(kept.map(item => item.outcome.check.requirements)), omissions: [] } };
  });
  const omissions = [...whole, ...parts, ...left.map(item => item.omission)];
  // Each product records only its own omissions: its features left out whole, and its looks' whole-look and part
  // omissions. An omission no built product owns (a look no exporting feature holds, a feature whose product built
  // nothing) goes to the first product, the default one when it builds, so every omission is in some manifest.
  const owners = (omission: ExportOmission): string[] => {
    if (omission.kind === "feature") return left.filter(item => item.omission === omission).map(item => item.product);
    const look = (omission as { presetId: string }).presetId;
    return [...productLooks].filter(([, looks]) => looks.has(look)).map(([id]) => id);
  };
  const byProduct = new Map(products.map(item => [item.product.id, [] as ExportOmission[]]));
  for (const omission of omissions) {
    const own = owners(omission).filter(id => byProduct.has(id));
    for (const id of own.length ? own : [products[0].product.id]) byProduct.get(id)!.push(omission);
  }
  const finished = products.map(item => ({ ...item, check: { ...item.check, omissions: byProduct.get(item.product.id)! } }));
  return { products: finished, result: { schema: PACKAGE_CHECK_2, ready: true, collectionId: identity.id,
    originalPresetCount: identity.looks.length + identity.omittedLooks, products: finished.map(item => item.check), omissions,
    collectionSha256: options.collectionSha256 } };
}
