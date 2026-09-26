/**
 * The product planner (feature-module platform §6): which mods a collection builds, with their
 * identities and names, and the package-plan edits behind the collection's `package.*` actions.
 * Pure and DOM-free: the browser shows the plan and checks the actions with it, and the export host
 * plans the same products before it runs the exporters.
 *
 * Defaults first, overrides available:
 * - one product holds every exportable feature; the person may move any feature into a mod of its own;
 * - the default product's ID is the collection's ID and its archive is `xfs_c<collection>` (the name
 *   every eye-makeup build has had); any other product's archive is `xfs_m<product>`. Archive names are
 *   ID-based, never shown or edited, so a rename never changes load order;
 * - a product with one feature is named after that feature's brand (eye makeup's, from mod-branding), one with several
 *   is "XF Looks", until the person names it; two products of one collection with the same name get the
 *   collection's name added to the later one;
 * - a feature is in exactly one product: a plan putting it into two is refused (`PackagePlanConflict`).
 */
import { MERGED_MOD_NAME, modNameIssue, PACKAGE_PLAN_1, PackagePlanConflict, type ModPackagePlan, type ModProductPlan } from "../api/export";

/** An exporting feature present in the collection, in composition order. */
export type PlannableFeature = { readonly id: string; readonly label: string; readonly brand: string };
/** A product the collection builds. */
export type PlannedProduct = {
  readonly id: string; readonly isDefault: boolean;
  /** Archive base name: `xfs_c<collection>` for the default product, `xfs_m<product>` for the others. */
  readonly archive: string;
  readonly modName: string; readonly nameSource: "plan" | "derived";
  /** Feature IDs, in composition order. */
  readonly features: readonly string[];
};

const compact = (uuid: string) => uuid.replaceAll("-", "");
/** A product's archive base name: ID-based, so renaming a mod never changes it. */
export const productArchive = (collectionId: string, productId: string) =>
  productId === collectionId ? `xfs_c${compact(collectionId)}` : `xfs_m${compact(productId)}`;

/**
 * The products a collection builds from its plan (absent: the default) and the exporting features
 * its looks hold. Products that hold none of those features are left out; a plan naming a feature
 * twice is refused.
 */
export function planProducts(input: { readonly collectionId: string; readonly collectionName: string;
  readonly plan?: ModPackagePlan; readonly features: readonly PlannableFeature[] }): PlannedProduct[] {
  const { collectionId, plan } = input;
  const owner = new Map<string, string>();
  for (const product of plan?.products ?? []) for (const feature of product.features) {
    if (owner.has(feature)) throw new PackagePlanConflict(feature);
    owner.set(feature, product.id);
  }
  const named = new Map((plan?.products ?? []).filter(product => product.name !== undefined).map(product => [product.id, product.name!]));
  // Product order: the default first, then the plan's order.
  const order = [collectionId, ...(plan?.products ?? []).map(product => product.id).filter(id => id !== collectionId)];
  const members = new Map<string, string[]>(order.map(id => [id, []]));
  for (const feature of input.features) members.get(owner.get(feature.id) ?? collectionId)!.push(feature.id);
  const brand = new Map(input.features.map(feature => [feature.id, feature.brand]));
  const taken = new Set<string>();
  return order.filter(id => members.get(id)!.length).map(id => {
    const features = members.get(id)!, chosen = named.get(id);
    let modName = chosen ?? (features.length === 1 ? brand.get(features[0])! : MERGED_MOD_NAME);
    // Two mods of one collection never share a folder: the later one gets the collection's name.
    if (taken.has(modName.toLowerCase())) modName = `${modName} (${input.collectionName.trim()})`;
    for (let n = 2; taken.has(modName.toLowerCase()); n++) modName = `${modName.replace(/ \d+$/, "")} ${n}`;
    taken.add(modName.toLowerCase());
    return { id, isDefault: id === collectionId, archive: productArchive(collectionId, id), modName,
      nameSource: chosen !== undefined ? "plan" as const : "derived" as const, features };
  });
}

/**
 * The plan in its canonical form: only what differs from the default. The default product's features are
 * implicit (every feature no other product holds), an unnamed default product and a product without
 * features are dropped, and a plan left with nothing is `undefined` (collections without choices store none).
 */
export function normalizePackagePlan(plan: ModPackagePlan | undefined, collectionId: string): ModPackagePlan | undefined {
  if (!plan) return undefined;
  const products: ModProductPlan[] = [];
  for (const product of plan.products) {
    if (product.id === collectionId) {
      if (product.name !== undefined) products.push({ id: product.id, name: product.name, features: [] });
    } else if (product.features.length) products.push({ id: product.id, ...(product.name !== undefined ? { name: product.name } : {}),
      features: [...product.features] });
  }
  return products.length ? { schema: PACKAGE_PLAN_1, products } : undefined;
}

/** A package-plan edit: the collection's `package.*` actions. */
export type PackagePlanEdit =
  /** Name a mod, or with `name: null` go back to the name that follows its features. */
  | { kind: "rename"; productId: string; name: string | null }
  /** Move a feature into an existing mod (the default mod included). */
  | { kind: "assign"; feature: string; productId: string }
  /** Move a feature into a new mod of its own; `newId` is the new product's ID (host-supplied). */
  | { kind: "split"; feature: string; newId: string }
  /** Put everything of one mod into another; the first one goes away. */
  | { kind: "merge"; productId: string; intoId: string };

/** Why an edit cannot apply to these products, in plain words, or undefined when it can. */
export function packagePlanEditIssue(edit: PackagePlanEdit, products: readonly PlannedProduct[], collectionId: string,
  labels: Readonly<Record<string, string>> = {}): string | undefined {
  const product = (id: string) => products.find(item => item.id === id);
  const home = (feature: string) => products.find(item => item.features.includes(feature));
  const label = (feature: string) => labels[feature] ?? feature;
  switch (edit.kind) {
    case "rename":
      if (!product(edit.productId)) return "That mod is no longer part of this collection's package.";
      return edit.name === null ? undefined : modNameIssue(edit.name);
    case "assign": {
      const from = home(edit.feature);
      if (!from) return `This collection has no ${label(edit.feature)} to package.`;
      if (!product(edit.productId)) return "That mod is no longer part of this collection's package.";
      if (from.id === edit.productId) return `${label(edit.feature)} is already in that mod.`;
      return undefined;
    }
    case "split": {
      const from = home(edit.feature);
      if (!from) return `This collection has no ${label(edit.feature)} to package.`;
      if (from.features.length < 2) return `${label(edit.feature)} is already a mod of its own.`;
      if (edit.newId === collectionId || products.some(item => item.id === edit.newId)) return "That mod ID is already in use.";
      return undefined;
    }
    case "merge":
      if (!product(edit.productId) || !product(edit.intoId)) return "That mod is no longer part of this collection's package.";
      if (edit.productId === edit.intoId) return "Choose another mod to merge into.";
      return undefined;
  }
}

/**
 * Apply an edit to the stored plan (absent: the default) over the products it plans today; returns the
 * canonical plan (`undefined` when it is back to the default). Check `packagePlanEditIssue` first. The
 * stored plan stays the source of names and moves; entries for features no look holds right now are kept.
 */
export function editPackagePlan(plan: ModPackagePlan | undefined, edit: PackagePlanEdit, products: readonly PlannedProduct[],
  collectionId: string): ModPackagePlan | undefined {
  const entries = new Map<string, { name?: string; features: string[] }>((plan?.products ?? []).map(product =>
    [product.id, { ...(product.name !== undefined ? { name: product.name } : {}), features: [...product.features] }]));
  const entry = (id: string) => { let found = entries.get(id); if (!found) entries.set(id, found = { features: [] }); return found; };
  const without = (feature: string) => { for (const item of entries.values()) item.features = item.features.filter(other => other !== feature); };
  // A feature moved into the default mod needs no entry: the default holds every feature no other mod holds.
  const into = (id: string, feature: string) => { without(feature); if (id !== collectionId) entry(id).features.push(feature); };
  switch (edit.kind) {
    case "rename":
      if (edit.name === null) delete entry(edit.productId).name; else entry(edit.productId).name = edit.name.trim();
      break;
    case "assign": into(edit.productId, edit.feature); break;
    case "split": without(edit.feature); entry(edit.newId).features.push(edit.feature); break;
    case "merge": {
      const from = products.find(product => product.id === edit.productId);
      for (const feature of from?.features ?? []) into(edit.intoId, feature);
      // The default mod always exists (it takes any feature added later); any other merged mod goes away with its name.
      if (edit.productId === collectionId) delete entry(collectionId).name; else entries.delete(edit.productId);
      break;
    }
  }
  return normalizePackagePlan({ schema: PACKAGE_PLAN_1, products: [...entries].map(([id, item]) =>
    ({ id, ...(item.name !== undefined ? { name: item.name } : {}), features: item.features })) }, collectionId);
}

/**
 * The plan of a copy saved under a new collection ID: the old default product's entry becomes the new default's,
 * so the copy's merged mod is its own (`xfs_c<new collection>`), never a split-off product of the original.
 */
export function renameCollectionId(plan: ModPackagePlan | undefined, from: string, to: string): ModPackagePlan | undefined {
  if (!plan) return undefined;
  return normalizePackagePlan({ schema: PACKAGE_PLAN_1, products: plan.products.map(product => product.id === from ? { ...product, id: to } : product) }, to);
}

/** A feature module's export defaults, as the part registry lists the composed features that have an exporter. */
export type ExportingFeature = { readonly id: string; readonly label: string; readonly brand: string };
/** The products an in-memory collection builds: its plan over the exporting features its looks hold. */
export function collectionProducts(collection: { readonly id: string; readonly name: string; readonly packagePlan?: ModPackagePlan;
  readonly presets: readonly { readonly parts: Readonly<Record<string, unknown>> }[] }, exporting: readonly ExportingFeature[]): PlannedProduct[] {
  const present = exporting.filter(feature => collection.presets.some(look => look.parts[feature.id] !== undefined));
  return planProducts({ collectionId: collection.id, collectionName: collection.name, plan: collection.packagePlan, features: present });
}
