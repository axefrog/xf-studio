/**
 * Check for every product of a collection (feature-module platform §6 "Pipeline", step 1): plan the
 * products, run each feature's eligibility and plan (and, for Check, its preflight), then the product
 * checks: no two features share a depot path or a namespace, each product's `.xl` fragments merge, and a
 * product's framework requirements take the highest version per framework. Shared by the builder (in its
 * child process), the Check worker and the hosts' result gates, so every one plans exactly alike.
 */
import { COLLECTION_1, COLLECTION_2 } from "../api/document";
import {
  ExportRefusal, mergeXlFragments, NO_EXPORTER_REASON, PACKAGE_CHECK_2, PackagePlanConflict, parsePackagePlan,
  type ExportOmission, type FeatureExporterEntry, type FeatureOutcome, type FrameworkRequirements, type ModPackagePlan,
  type PackageCheckResult, type ProductCheck, type XlFragment,
} from "../api/export";
import { planProducts, type PlannedProduct } from "../core/package-plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INVALID = "Expected a named XF Studio collection with a stable UUID and at least one preset.";
const refuse = (code: string, message: string): never => { throw new ExportRefusal(code, message); };

/** What the platform reads of a collection before any exporter: identities, which features each look holds, and the package plan. */
export type CollectionIdentity = {
  readonly id: string; readonly name: string; readonly schema: typeof COLLECTION_1 | typeof COLLECTION_2;
  /** Each look; `parts` lists its features (a collection-1 look is one exporter's own format and lists none). */
  readonly looks: readonly { readonly id: string; readonly name: string; readonly parts?: readonly string[] }[];
  /** Looks a collection-1 view already left out (an older request's `omitted`), counted as looks of the collection. */
  readonly omittedLooks: number;
  readonly packagePlan?: ModPackagePlan;
};

/** A collection's identity; throws `ExportRefusal("invalid_collection")` on anything else. */
export function readCollectionIdentity(value: unknown): CollectionIdentity {
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
  try { packagePlan = input.packagePlan === undefined ? undefined : parsePackagePlan(input.packagePlan); }
  catch (error) {
    if (error instanceof PackagePlanConflict) return refuse(error.code, error.message);
    return refuse("invalid_collection", (error as Error).message);
  }
  const omittedLooks = input.schema === COLLECTION_1 && Array.isArray(input.omitted)
    ? input.omitted.filter(item => (item as { feature?: unknown } | null)?.feature === undefined).length : 0;
  return { id: input.id, name: input.name, schema: input.schema, looks, omittedLooks, ...(packagePlan ? { packagePlan } : {}) };
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
  const identity = readCollectionIdentity(options.collection);
  const entries = new Map(options.exporters.map(entry => [entry.exporter.feature, entry]));
  // Parts of a feature no registered exporter packages: reported once, by look.
  const omissions: ExportOmission[] = identity.looks.flatMap(look => (look.parts ?? []).filter(feature => !entries.has(feature))
    .map(feature => ({ kind: "part" as const, presetId: look.id, presetName: look.name, feature, reason: NO_EXPORTER_REASON })));
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
  const products: ProductOutcome[] = [];
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
        omissions.push({ kind: "feature", feature, label: entry.exporter.label, reason: error.message });
      }
    }
    if (!features.length) continue;
    let xl: XlFragment;
    try { xl = mergeXlFragments(features.map(item => item.outcome.xl)); }
    catch (error) { return refuse("package_conflict", (error as Error).message); }
    products.push({ product, features, xl, check: { productId: product.id, modName: product.modName, nameSource: product.nameSource,
      archive: product.archive, isDefault: product.isDefault, features: features.map(item => item.outcome.check),
      requirements: mergeRequirements(features.map(item => item.outcome.check.requirements)) } });
  }
  if (!products.length) throw refusals[0];
  // Resources and selectors are feature-scoped: no two features may claim the same depot path or namespace,
  // whichever products they ship in (the game sees every installed archive at once).
  const paths = new Map<string, string>(), namespaces = new Map<string, string>();
  for (const { features } of products) for (const { outcome } of features) {
    const feature = outcome.check.feature;
    const other = namespaces.get(outcome.check.namespace);
    if (other) refuse("package_conflict", `${other} and ${feature} use the same namespace ${outcome.check.namespace}.`);
    namespaces.set(outcome.check.namespace, feature);
    for (const path of outcome.inventory) {
      const owner = paths.get(path);
      if (owner) refuse("package_conflict", `${owner} and ${feature} both write ${path}.`);
      paths.set(path, feature);
    }
  }
  return { products, result: { schema: PACKAGE_CHECK_2, ready: true, collectionId: identity.id,
    originalPresetCount: identity.looks.length + identity.omittedLooks, products: products.map(item => item.check), omissions,
    collectionSha256: options.collectionSha256 } };
}
