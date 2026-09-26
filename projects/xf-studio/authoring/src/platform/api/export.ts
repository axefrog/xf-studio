/**
 * Mod export (feature-module platform §6): the package plan a collection stores, the exporter and
 * verifier contract every exporting feature registers, ArchiveXL declaration fragments and the
 * results Check and Build publish. Types and small pure helpers only (no Node, no DOM); the export
 * host (`platform/export`) runs the exporters and the product planner (`platform/core/package-plan`)
 * decides which features ship together.
 *
 * Products are the XF-branded mods a collection builds: one merged mod by default, split by the
 * person when they want. Selectors and resource identities are feature-scoped and
 * product-independent; merging or splitting changes only the archive, `.xl`, folder and manifest
 * that carry them.
 */

// ---------------------------------------------------------------------------------------------
// The package plan (stored with the collection)
// ---------------------------------------------------------------------------------------------

export const PACKAGE_PLAN_1 = "xfs/package-plan-1";
/**
 * One product: which features it holds and, when the person named it, its mod name. The default
 * product's ID is the collection's ID; any other product has its own UUID.
 */
export type ModProductPlan = { readonly id: string; readonly name?: string; readonly features: readonly string[] };
/**
 * How a collection's exportable features are grouped into mods. Absent means the default: one mod
 * holding every exportable feature. A plan names only what differs from that default: products the
 * person split off (with their features), and names the person gave. Features it does not name
 * join the default product.
 */
export type ModPackagePlan = { readonly schema: typeof PACKAGE_PLAN_1; readonly products: readonly ModProductPlan[] };

/** The mod name of a product holding several features, until the person names it. */
export const MERGED_MOD_NAME = "XF Looks";
/** Longest mod name (it becomes a mod-manager folder name). */
export const MOD_NAME_MAX = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEATURE_KEY = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;
const RESERVED_FOLDER = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

/**
 * Why a mod name cannot be used as a mod-manager folder, in plain words, or undefined when it can.
 * The "XF " prefix is a default, never a rule.
 */
export function modNameIssue(name: string): string | undefined {
  const value = name.trim();
  if (!value) return "Give the mod a name.";
  if (value.length > MOD_NAME_MAX) return `Keep the mod name to ${MOD_NAME_MAX} characters or fewer.`;
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value)) return "A mod name can't contain < > : \" / \\ | ? or *.";
  if (value.endsWith(".")) return "A mod name can't end with a full stop.";
  if (RESERVED_FOLDER.test(value)) return "Windows reserves that name; choose another.";
  return undefined;
}

/** A plan read from stored or imported data; throws with a plain message when it is damaged. */
export function parsePackagePlan(value: unknown): ModPackagePlan {
  const input = value as { schema?: unknown; products?: unknown } | null;
  if (!input || typeof input !== "object" || input.schema !== PACKAGE_PLAN_1 || !Array.isArray(input.products) ||
      input.products.length > 64)
    throw Error("The collection's mod packaging choices are damaged.");
  const ids = new Set<string>(), owner = new Map<string, string>();
  const products = input.products.map((item): ModProductPlan => {
    const product = item as { id?: unknown; name?: unknown; features?: unknown } | null;
    if (!product || typeof product.id !== "string" || !UUID.test(product.id) || ids.has(product.id) ||
        (product.name !== undefined && (typeof product.name !== "string" || product.name !== product.name.trim() ||
          modNameIssue(product.name) !== undefined)) ||
        !Array.isArray(product.features) || product.features.length > 64)
      throw Error("The collection's mod packaging choices are damaged.");
    ids.add(product.id);
    const features = product.features.map(feature => {
      if (typeof feature !== "string" || !FEATURE_KEY.test(feature) || feature.length > 64)
        throw Error("The collection's mod packaging choices are damaged.");
      // A feature namespace may be present in only one XF mod (§6 "Moving a feature between mods").
      if (owner.has(feature)) throw new PackagePlanConflict(feature);
      owner.set(feature, product.id as string);
      return feature;
    });
    return { id: product.id, ...(product.name !== undefined ? { name: product.name as string } : {}), features };
  });
  return { schema: PACKAGE_PLAN_1, products };
}

/** A plan that puts one feature into two mods: refused, because a feature's namespace may exist in only one XF mod. */
export class PackagePlanConflict extends Error {
  readonly code = "namespace_duplicated";
  constructor(readonly feature: string) {
    super(`The ${feature} feature is in two mods. Each feature can go into only one mod, so its looks never appear twice in game.`);
    this.name = "PackagePlanConflict";
  }
}

// ---------------------------------------------------------------------------------------------
// ArchiveXL declaration fragments
// ---------------------------------------------------------------------------------------------

/**
 * What one feature adds to its product's `.archive.xl`: character-customization resources by body
 * gender and resource scopes. Depot paths use forward slashes; the declaration writes backslashes.
 */
export type XlFragment = {
  readonly customizations?: { readonly female?: readonly string[]; readonly male?: readonly string[] };
  readonly scope?: Readonly<Record<string, readonly string[]>>;
};
const XL_PATH = /^[a-z0-9_][a-z0-9_.\/-]*$/;
const XL_SCOPE = /^[a-z0-9_][a-z0-9_.]*$/;

/** One product's declaration: every feature's fragment in product order. Refuses an entry declared twice. */
export function mergeXlFragments(fragments: readonly XlFragment[]): XlFragment {
  const female: string[] = [], male: string[] = [], scope = new Map<string, string[]>();
  const add = (list: string[], path: string) => {
    if (!XL_PATH.test(path)) throw Error(`ArchiveXL entry is not a canonical depot path: ${JSON.stringify(path)}`);
    if (list.includes(path)) throw Error(`Two features declare the same ArchiveXL entry: ${path}`);
    list.push(path);
  };
  for (const fragment of fragments) {
    for (const path of fragment.customizations?.female ?? []) add(female, path);
    for (const path of fragment.customizations?.male ?? []) add(male, path);
    for (const [name, paths] of Object.entries(fragment.scope ?? {})) {
      if (!XL_SCOPE.test(name)) throw Error(`ArchiveXL scope is not a resource name: ${JSON.stringify(name)}`);
      const list = scope.get(name) ?? [];
      for (const path of paths) add(list, path);
      scope.set(name, list);
    }
  }
  return { ...(female.length || male.length ? { customizations: { ...(female.length ? { female } : {}), ...(male.length ? { male } : {}) } } : {}),
    ...(scope.size ? { scope: Object.fromEntries(scope) } : {}) };
}

/**
 * The `.archive.xl` text of a declaration. CRLF line endings (every candidate built so far has them, and
 * YAML accepts them); a gender or scope with one entry is written as a scalar, several as a list. One
 * feature's fragment gives exactly the declaration the eye-makeup builder has always written.
 */
export function archiveXlText(fragment: XlFragment): string {
  const lines: string[] = [], depot = (path: string) => path.replaceAll("/", "\\");
  const entry = (indent: string, key: string, paths: readonly string[], list: boolean) => {
    if (paths.length === 1 && !list) lines.push(`${indent}${key}: ${depot(paths[0])}`);
    else { lines.push(`${indent}${key}:`); for (const path of paths) lines.push(`${indent}  - ${depot(path)}`); }
  };
  const custom = fragment.customizations;
  if (custom && (custom.female?.length || custom.male?.length)) {
    lines.push("customizations:");
    if (custom.female?.length) entry("  ", "female", custom.female, false);
    if (custom.male?.length) entry("  ", "male", custom.male, false);
  }
  const scopes = Object.entries(fragment.scope ?? {}).filter(([, paths]) => paths.length);
  if (scopes.length) {
    lines.push("resource:", "  scope:");
    for (const [name, paths] of scopes) entry("    ", name, paths, true);
  }
  if (!lines.length) throw Error("An ArchiveXL declaration needs at least one entry.");
  return [...lines, ""].join("\r\n");
}

// ---------------------------------------------------------------------------------------------
// Exporters and verifiers
// ---------------------------------------------------------------------------------------------

/** Minimum versions by framework (`ArchiveXL`, `TweakXL`, `game`…). A product takes the highest per framework. */
export type FrameworkRequirements = Readonly<Record<string, string>>;
/**
 * How a feature's looks appear in the character creator: its own selector where that is genuinely best
 * (eye makeup, because of its face plate), or extra choices added to the matching vanilla option set.
 */
export type SelectorPlacement = "own" | "vanilla";
/**
 * What a feature module says about its exporter in its core registration (browser-safe): the exporter
 * the host must register for it and the defaults a presentation shows before any Check.
 */
export type ExportInfo = { readonly exporterId: string; readonly brand: string; readonly selectorLabel: string;
  readonly selector: SelectorPlacement };

/** Something Check, Build and the manifest report as left out, with the reason in plain words. */
export type ExportOmission =
  /** A whole look this feature packages nothing of. */
  | { kind: "preset"; presetId: string; presetName: string; reason: string }
  /** A part of a look that no exporter packages (a feature without a mod exporter yet). */
  | { kind: "part"; presetId: string; presetName: string; feature: string; reason: string }
  /** One layer (or item) of a look's part. */
  | { kind: "layer"; presetId: string; presetName: string; layerId: string; layerName: string; finish: string; reason: string }
  /** A whole feature a product could hold but nothing of it can be packaged. */
  | { kind: "feature"; feature: string; label: string; reason: string };
/** Why a part of a look is left out when no registered exporter packages its feature. */
export const NO_EXPORTER_REASON = "XF Studio can't make mod files for this part yet.";
/** An included item whose export adapter still needs in-game confirmation. */
export type ExportExperimental = { presetId: string; presetName: string; layerId: string; layerName: string;
  finish: string; adapter: string; note: string };
/** A packaged look's stable identity and whatever the feature records beside it (export route, diagnostic knobs). */
export type ExportedLook = { readonly id: string; readonly revision: number; readonly appearance?: string; readonly [extra: string]: unknown };

/**
 * One feature's part of a Check or Build: what it packages, what it leaves out and why. `details` holds
 * facts only this feature knows (eye makeup: the plate's lifts and UV footprint); the host's result
 * gate compares the whole record with its own.
 */
export type FeatureCheck = {
  readonly feature: string; readonly label: string;
  readonly exporter: string; readonly exporterVersion: string;
  /** The feature's resource namespace (its selector and depot identity); present in only one installed XF mod. */
  readonly namespace: string;
  readonly brand: string; readonly selectorLabel: string; readonly selector: SelectorPlacement;
  readonly presets: readonly ExportedLook[];
  readonly omissions: readonly ExportOmission[];
  readonly experimental: readonly ExportExperimental[];
  readonly notes: readonly string[];
  readonly requirements: FrameworkRequirements;
  /** SHA-256 of the feature's package-only snapshot (its eligible looks, filtered). */
  readonly packagedSha256: string;
  readonly details: Readonly<Record<string, unknown>>;
};

/** What a feature's eligibility and plan read. */
export type FeatureCheckInput = {
  /** The collection as the request carried it, in either stored schema: each exporter reads its own part. */
  readonly collection: unknown;
  /**
   * What Check or Build plans on, by prerequisite ID (eye makeup: the prepared eye plate's UV footprint);
   * a missing entry means none is prepared yet.
   */
  readonly prerequisites: Readonly<Record<string, unknown>>;
  /** Honour diagnostic export knobs (a developer's prepared test candidate; never a host). */
  readonly diagnostics: boolean;
};
/** A feature's plan: its report, its plan (`plan.json`), its package-only snapshot, planned resources and `.xl` fragment. */
export type FeatureOutcome<Plan = unknown> = {
  readonly check: FeatureCheck;
  readonly plan: Plan;
  /** The package-only snapshot as JSON text (`check.packagedSha256` is its hash). */
  readonly packaged: string;
  /** Every depot path the feature's build writes, sorted. */
  readonly inventory: readonly string[];
  readonly xl: XlFragment;
};

/** A refusal an exporter or the export host decides, with its code (`no_exportable_content`, `invalid_collection`…). */
export class ExportRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ExportRefusal"; }
}
/**
 * The builder found a host prerequisite stale (eye makeup: a cached plate whose recorded UV footprint
 * differs from the plate itself). The host discards it and builds once more on a fresh one.
 */
export class PrerequisiteStale extends Error {
  readonly code = "package_prerequisite_stale";
  constructor(readonly prerequisite: string, message: string) { super(message); this.name = "PrerequisiteStale"; }
}

/** One step of a WolvenKit conversion: its exit code and log. */
export interface ToolStep { readonly exitCode: number; readonly log: string }
/** WolvenKit's XBM import settings, passed as `XbmImportArgs__*` environment values. */
export interface TextureImportSettings {
  IsGamma: boolean; TextureGroup: string; RawFormat: string; Compression: string;
  GenerateMipMaps: boolean; IsStreamable: boolean; PremultiplyAlpha: boolean;
}
/** The WolvenKit operations a build needs; exporters convert, the host packs. */
export interface ResourceTools {
  importTextures(input: string, output: string, settings: TextureImportSettings): Promise<ToolStep>;
  serialize(input: string, output: string): Promise<ToolStep>;
  deserialize(input: string, output: string): Promise<ToolStep>;
  pack(input: string, output: string): Promise<ToolStep>;
}
/** A generated file of the staging tree: slash-separated depot path, length and SHA-256. */
export type GeneratedFile = { readonly path: string; readonly bytes: number; readonly sha256: string };

/** What a feature's build is given. */
export type FeatureBuildContext = {
  /** The product's staging tree: files go at their depot paths below it. Other features write beside them. */
  readonly staging: string;
  /** This feature's private work directory (fresh; the build creates it). Its verifier reads it. */
  readonly work: string;
  readonly tools: ResourceTools;
  /** Builder-side prerequisite values by ID (eye makeup: the prepared plate's directory and manifest). */
  readonly prerequisites: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly log: (line: string) => void;
};
/** What a feature's build wrote: exactly its outcome's inventory, hashed. */
export type FeatureBuildRecord = { readonly files: readonly GeneratedFile[] };

/** What a Build needs before it plans (eye makeup: the plate's UV footprint, read from its manifest or the plate itself). */
export type FeatureBuildInputs = {
  /**
   * Prerequisite values by ID, replacing the builder-side ones: the plan reads them, and the build, the
   * verifier and `accept` get them too (eye makeup: the plate's files, provenance and footprint).
   */
  readonly prerequisites: Readonly<Record<string, unknown>>;
};

/**
 * A feature's exporter (host only; feature-module platform §6). Eligibility and plan are pure and
 * deterministic, so the host's result gate can repeat them; the build writes into the product's shared
 * staging tree; the host packs once, verifies the product and then each feature on its own subset.
 */
export interface FeatureExporter<Plan = unknown> {
  readonly id: string;
  /** Bumped whenever the same input would build different bytes. */
  readonly version: string;
  readonly feature: string;
  readonly label: string;
  readonly info: ExportInfo;
  /** Host prerequisites a Build of this feature needs, by ID (the host prepares them before the builder runs). */
  readonly prerequisites: readonly string[];
  /** Whether any look of the collection holds this feature's part (cheap; decides product membership). */
  present(collection: unknown): boolean;
  /** Eligibility and plan. Throws `ExportRefusal` when nothing can be packaged or the input is invalid. */
  plan(input: FeatureCheckInput): FeatureOutcome<Plan>;
  /** Check's extra gate beyond the plan (eye makeup: a small compile of every packaged preset). */
  preflight?(outcome: FeatureOutcome<Plan>): void;
  /**
   * Check: read builder-side prerequisite values into what the plan reads, without tools (eye makeup: a
   * prepared plate's recorded UV footprint, from its manifest). Absent: Check plans on none.
   */
  checkInputs?(prerequisites: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  /** Input paths among the builder-side prerequisites that the writable build roots may not overlap, each with a plain label. */
  protectedInputs?(prerequisites: Readonly<Record<string, unknown>>): readonly (readonly [string, string])[];
  /** Build: read the prerequisites the plan needs (may use WolvenKit), before planning. `work` is a fresh private folder. */
  buildInputs?(context: Omit<FeatureBuildContext, "staging">): Promise<FeatureBuildInputs>;
  build(outcome: FeatureOutcome<Plan>, context: FeatureBuildContext): Promise<FeatureBuildRecord>;
  /** Cross-check its independent verifier's report against the plan (routes, lifts, inputs). Throws on a mismatch. */
  accept?(outcome: FeatureOutcome<Plan>, verification: FeatureVerification, context: FeatureBuildContext): void;
}

/** A WolvenKit run's outcome, for the verifiers. */
export interface ToolResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }
/** The WolvenKit operations the verifiers run themselves; each writes only into `output`. */
export interface VerifierTools {
  unbundle(archive: string, output: string): ToolResult;
  serialize(input: string, output: string): ToolResult;
  exportTextures(input: string, output: string): ToolResult;
}
/**
 * The product's packed archive as the product verifier unbundled it: every member hash-checked against
 * the union of the features' build records, and the `.xl` it compared with the merged fragments.
 */
export type UnpackedView = {
  /** The directory the archive copy was unbundled into (depot paths below it). */
  readonly root: string;
  readonly files: readonly GeneratedFile[];
  readonly archiveSha256: string;
  readonly archiveBytes: number;
  /** The `.archive.xl` text, exactly as its bytes were hashed. */
  readonly xl: string;
  readonly xlSha256: string;
  /** How many features the product holds: a feature alone must find the declaration equal to its own fragment. */
  readonly features: number;
};
/** What a feature verifier checks: its subset of the unpacked product, its build's work folder and its snapshot. */
export type FeatureVerifyInput = {
  readonly unpacked: UnpackedView;
  /** The feature's build work directory (its build record and inputs). */
  readonly work: string;
  /** The product's staging tree (the files as generated, before packing). */
  readonly staging: string;
  /** An empty or absent directory for the verifier's own conversions. */
  readonly verifyDir: string;
  readonly tools: VerifierTools;
  /** The package-only snapshot the host planned (every recipe in the build record must equal it). */
  readonly packaged: unknown;
  readonly prerequisites: Readonly<Record<string, unknown>>;
};
/** A feature verifier's report: what it verified and what remains unproven. `report` is its full record. */
export type FeatureVerification = { readonly presetCount: number; readonly verifiedFiles: number; readonly limits: readonly string[];
  readonly report: Readonly<Record<string, unknown>> };
/**
 * A feature's independent verifier (host only). It imports nothing from its exporter or any engine
 * compiler, raster or bake module (feature-module platform §7 rule 3).
 */
export interface FeatureVerifier {
  readonly exporterId: string;
  verify(input: FeatureVerifyInput): FeatureVerification;
}
/** What the host composition registers per exporting feature. */
export type FeatureExporterEntry = { readonly exporter: FeatureExporter<unknown>; readonly verifier: FeatureVerifier };

// ---------------------------------------------------------------------------------------------
// Check and Build results (what the host answers; presentations read them)
// ---------------------------------------------------------------------------------------------

/** One product of a Check: the mod it would be, and each feature's report. */
export type ProductCheck = {
  readonly productId: string;
  /** The mod-manager name. `nameSource` says whether the person chose it or it follows the features. */
  readonly modName: string; readonly nameSource: "plan" | "derived";
  /** Archive base name (`xfs_c<collection>` for the default product, `xfs_m<product>` otherwise). */
  readonly archive: string;
  readonly isDefault: boolean;
  readonly features: readonly FeatureCheck[];
  readonly requirements: FrameworkRequirements;
};
export const PACKAGE_CHECK_2 = "xfs/package-check-2";
export const PACKAGE_BUILD_2 = "xfs/package-build-2";
/**
 * A Check: every product the collection builds, the parts no exporter packages, and features left out
 * whole. Creates no files.
 */
export type PackageCheckResult = {
  readonly schema: typeof PACKAGE_CHECK_2; readonly ready: true;
  readonly collectionId: string;
  /** Every look of the collection, packaged or not. */
  readonly originalPresetCount: number;
  readonly products: readonly ProductCheck[];
  /** Parts no exporter packages and features with nothing to package. */
  readonly omissions: readonly ExportOmission[];
  /** SHA-256 of the collection snapshot the request carried (knobs removed). */
  readonly collectionSha256: string;
};
/** One built product: its verified private candidate. Never installed or game-tested by Build. */
export type ProductBuild = ProductCheck & {
  readonly package: string; readonly manifest: string;
  readonly archiveSha256: string; readonly xlSha256: string;
  readonly verifiedUnpackedFiles: number;
  readonly installed: false; readonly gameRenderingVerified: false;
};
export type PackageBuildResult = Omit<PackageCheckResult, "schema" | "ready" | "products"> & {
  readonly schema: typeof PACKAGE_BUILD_2;
  readonly products: readonly ProductBuild[];
  readonly installed: false; readonly gameRenderingVerified: false;
};

/** Every look count a presentation says "N of M looks" with: the looks any feature of the result packages. */
export function packagedLookCount(result: Pick<PackageCheckResult, "products">): number {
  return new Set(result.products.flatMap(product => product.features.flatMap(feature => feature.presets.map(look => look.id)))).size;
}
