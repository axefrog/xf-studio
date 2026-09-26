/**
 * The local package manifest (feature-module platform §6, PIPE-09): what a verified private candidate is.
 * Build writes `xfs/local-package-2` (one product: its mod name, archive, every feature it holds with its
 * exporter, namespace, looks, omissions and verification); readers accept `xfs/local-package-1` too, the
 * one-feature form every eye-makeup build wrote before products existed. One typed reader serves the
 * install transport and the hosts' result gates.
 */
import type { ExportExperimental, ExportOmission, ExportedLook, FrameworkRequirements, SelectorPlacement } from "../api/export";

export const LOCAL_PACKAGE_1 = "xfs/local-package-1";
export const LOCAL_PACKAGE_2 = "xfs/local-package-2";

export type ManifestFile = { readonly path: string; readonly sha256: string; readonly bytes: number };
/** One feature of a product, as its manifest records it. */
export type ManifestFeature = {
  readonly feature: string; readonly exporter: string; readonly exporterVersion: string;
  readonly namespace: string; readonly brand: string; readonly selectorLabel: string; readonly selector: SelectorPlacement;
  readonly presets: readonly ExportedLook[];
  readonly omissions: readonly ExportOmission[];
  readonly experimental: readonly ExportExperimental[];
  readonly requirements: FrameworkRequirements;
  readonly packagedSha256: string;
  /** SHA-256 of the feature's plan (its compact JSON; `plan.json` holds the same plan pretty-printed). */
  readonly planSha256: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly verification: { readonly presetCount: number; readonly verifiedFiles: number; readonly limits: readonly string[] };
};
/** `xfs/local-package-2`: one verified product. */
export type LocalPackageManifest2 = {
  readonly schema: typeof LOCAL_PACKAGE_2;
  readonly productId: string; readonly modName: string; readonly nameSource: "plan" | "derived";
  /** The archive base name (`xfs_c…`/`xfs_m…`); the files are `<archive>.archive` and `<archive>.archive.xl`. */
  readonly archive: string;
  readonly collectionId: string; readonly collectionSha256: string; readonly originalPresetCount: number;
  /** Parts no exporter packages and features left out whole. */
  readonly omissions: readonly ExportOmission[];
  readonly requirements: FrameworkRequirements;
  readonly features: readonly ManifestFeature[];
  readonly files: readonly [ManifestFile, ManifestFile];
  readonly verifiedUnpackedFiles: number;
  readonly installed: false; readonly gameRenderingVerified: false;
};

/** What every reader needs of a manifest, whichever version wrote it. */
export type PackageManifestView = {
  readonly schema: typeof LOCAL_PACKAGE_1 | typeof LOCAL_PACKAGE_2;
  readonly productId: string; readonly modName?: string; readonly archive: string;
  /** The features the archive holds and their namespaces (each may be present in only one installed XF mod). */
  readonly features: readonly { readonly feature: string; readonly namespace: string }[];
  readonly files: readonly [ManifestFile, ManifestFile];
  readonly verifiedUnpackedFiles: number;
};

const ARCHIVE = /^xfs_[a-z0-9_]{1,124}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEATURE = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;
const fail = (): never => { throw Error("Candidate manifest is not a verified two-file package."); };

function files(value: unknown, archive: string): [ManifestFile, ManifestFile] {
  if (!Array.isArray(value) || value.length !== 2) return fail();
  return value.map((entry, index) => {
    const file = entry as Partial<ManifestFile> | null;
    if (!file || file.path !== `archive/pc/mod/${archive}.${index ? "archive.xl" : "archive"}` || typeof file.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes! <= 0)
      throw Error("Candidate manifest contains an unexpected file or hash.");
    return { path: file.path, sha256: file.sha256, bytes: file.bytes! };
  }) as [ManifestFile, ManifestFile];
}

/**
 * Read a candidate manifest of either version. `legacyFeature` names the feature a version-1 manifest
 * belongs to (version 1 was written only by the eye-makeup exporter, whose namespace was its archive name).
 * Throws on anything but a verified, uninstalled two-file package.
 */
export function readPackageManifest(value: unknown, legacyFeature: string): PackageManifestView {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== "object" || input.installed !== false || input.gameRenderingVerified !== false ||
      !Number.isSafeInteger(input.verifiedUnpackedFiles) || (input.verifiedUnpackedFiles as number) <= 0) return fail();
  if (input.schema === LOCAL_PACKAGE_1) {
    const archive = input.namespace;
    if (typeof archive !== "string" || !ARCHIVE.test(archive)) return fail();
    return { schema: LOCAL_PACKAGE_1, productId: typeof input.collectionId === "string" ? input.collectionId : "",
      ...(typeof input.modName === "string" ? { modName: input.modName } : {}), archive,
      features: [{ feature: legacyFeature, namespace: archive }], files: files(input.files, archive),
      verifiedUnpackedFiles: input.verifiedUnpackedFiles as number };
  }
  if (input.schema !== LOCAL_PACKAGE_2) return fail();
  const archive = input.archive;
  if (typeof archive !== "string" || !ARCHIVE.test(archive) || typeof input.productId !== "string" || !UUID.test(input.productId) ||
      typeof input.modName !== "string" || !input.modName.trim() || !Array.isArray(input.features) || !input.features.length) return fail();
  const seen = new Set<string>();
  const features = input.features.map(item => {
    const entry = item as { feature?: unknown; namespace?: unknown } | null;
    if (!entry || typeof entry.feature !== "string" || !FEATURE.test(entry.feature) || typeof entry.namespace !== "string" ||
        !ARCHIVE.test(entry.namespace) || seen.has(entry.feature) || seen.has(`ns:${entry.namespace}`)) return fail();
    seen.add(entry.feature); seen.add(`ns:${entry.namespace}`);
    return { feature: entry.feature, namespace: entry.namespace };
  });
  return { schema: LOCAL_PACKAGE_2, productId: input.productId, modName: input.modName, archive, features,
    files: files(input.files, archive), verifiedUnpackedFiles: input.verifiedUnpackedFiles as number };
}

/**
 * The feature namespaces an incoming product would duplicate among the XF mods already installed elsewhere
 * (a feature namespace may be present in only one installed XF mod; §6 "Moving a feature between mods").
 * Empty when it duplicates none.
 */
export function duplicatedNamespaces(incoming: Pick<PackageManifestView, "features">,
  installed: readonly { readonly features: readonly { readonly namespace: string }[] }[]): string[] {
  const elsewhere = new Set(installed.flatMap(mod => mod.features.map(feature => feature.namespace)));
  return incoming.features.map(feature => feature.namespace).filter(namespace => elsewhere.has(namespace));
}
