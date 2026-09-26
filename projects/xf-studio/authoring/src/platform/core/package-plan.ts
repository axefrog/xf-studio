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
 *   collection's name added to the later one (or a number, when that would not be a valid folder name), and the person
 *   can't rename one mod to another's name (PIPE-91);
 * - a feature is in exactly one product: a plan putting it into two is refused (`PackagePlanConflict`).
 */
import { isKeptPackagePlan, MERGED_MOD_NAME, MOD_NAME_MAX, modNameIssue, PACKAGE_PLAN_1, PackagePlanConflict, type KeptPackagePlan, type ModPackagePlan,
  type ModProductPlan } from "../api/export";

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
    if (owner.has(feature)) throw new PackagePlanConflict(feature, input.features.find(item => item.id === feature)?.label);
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
    const modName = distinctName(chosen ?? (features.length === 1 ? brand.get(features[0])! : MERGED_MOD_NAME), taken, input.collectionName);
    taken.add(modName.toLowerCase());
    return { id, isDefault: id === collectionId, archive: productArchive(collectionId, id), modName,
      nameSource: chosen !== undefined ? "plan" as const : "derived" as const, features };
  });
}

/**
 * A mod name no earlier mod of the collection has (`taken`, lower case). Two mods of one collection never share a
 * folder: the later one gets the collection's name, and when that isn't a valid mod name (collection names may hold
 * `/ : ?`, or run too long) or is taken too, a number instead (PIPE-91). Every result passes `modNameIssue`.
 */
function distinctName(name: string, taken: ReadonlySet<string>, collectionName: string): string {
  const free = (value: string) => !taken.has(value.toLowerCase()) && modNameIssue(value) === undefined;
  if (!taken.has(name.toLowerCase())) return name;
  const suffixed = `${name} (${collectionName.trim()})`;
  if (free(suffixed)) return suffixed;
  // Numbered from the suffixed name when that is a valid name (as before), else from the name itself, cut to fit.
  const base = modNameIssue(suffixed) === undefined ? suffixed : name;
  for (let n = 2; ; n++) {
    const end = ` ${n}`, stem = base.slice(0, MOD_NAME_MAX - end.length).replace(/[\s.]+$/, "");
    if (free(stem + end)) return stem + end;
  }
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
  // The default mod always exists as a place for features to go, even while it holds none.
  const target = (id: string) => id === collectionId || !!product(id);
  const home = (feature: string) => products.find(item => item.features.includes(feature));
  const label = (feature: string) => labels[feature] ?? feature;
  switch (edit.kind) {
    case "rename": {
      if (!product(edit.productId)) return "That mod is no longer part of this collection's package.";
      if (edit.name === null) return undefined;
      const name = edit.name.trim();
      // Renaming one mod to another's name would make two mods of one folder; refused instead of renamed behind the person's back (PIPE-91).
      const other = products.find(item => item.id !== edit.productId && item.modName.toLowerCase() === name.toLowerCase());
      if (other) return `Another mod of this collection is already called “${other.modName}”. Choose a different name.`;
      return modNameIssue(edit.name);
    }
    case "assign": {
      const from = home(edit.feature);
      if (!from) return `This collection has no ${label(edit.feature)} to package.`;
      if (!target(edit.productId)) return "That mod is no longer part of this collection's package.";
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
      if (!product(edit.productId) || !target(edit.intoId)) return "That mod is no longer part of this collection's package.";
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
 * The plan of a copy saved under a new collection ID ("Save as copy"): the old default product's entry becomes the
 * new default's, so the copy's merged mod is its own (`xfs_c<new collection>`), and every other product gets a fresh
 * ID from `newId`, so no split-off mod of the copy shares an `xfs_m<product>` archive with the original's and hides
 * it in the mod manager's virtual folder (PIPE-89). Names and feature moves are kept. A kept plan (one this build
 * can't read, CORE-91) is kept as it is: its products can't be re-identified here.
 */
export function copyPackagePlan(plan: ModPackagePlan | KeptPackagePlan | undefined, from: string, to: string,
  newId: () => string): ModPackagePlan | KeptPackagePlan | undefined {
  if (!plan) return undefined;
  if (isKeptPackagePlan(plan)) return structuredClone(plan);
  const used = new Set<string>([from, to, ...plan.products.map(product => product.id)]);
  const fresh = () => { let id: string; do id = newId(); while (used.has(id)); used.add(id); return id; };
  return normalizePackagePlan({ schema: PACKAGE_PLAN_1, products: plan.products.map(product =>
    ({ ...product, id: product.id === from ? to : fresh() })) }, to);
}

/** A feature module's export defaults, as the part registry lists the composed features that have an exporter. */
export type ExportingFeature = { readonly id: string; readonly label: string; readonly brand: string };
/** The products an in-memory collection builds: its plan over the exporting features its looks hold. */
export function collectionProducts(collection: { readonly id: string; readonly name: string; readonly packagePlan?: ModPackagePlan | KeptPackagePlan;
  readonly presets: readonly { readonly parts: Readonly<Record<string, unknown>> }[] }, exporting: readonly ExportingFeature[]): PlannedProduct[] {
  // Nothing plans on a plan this build can't read (CORE-91); the actions and Check refuse it with its reason.
  if (isKeptPackagePlan(collection.packagePlan)) return [];
  const present = exporting.filter(feature => collection.presets.some(look => look.parts[feature.id] !== undefined));
  return planProducts({ collectionId: collection.id, collectionName: collection.name, plan: collection.packagePlan, features: present });
}
