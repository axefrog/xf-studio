/**
 * Canned package results for tests of the Studio side (collection service, file operations, presentation): one
 * default product holding eye makeup, shaped exactly as the export host answers (`xfs/package-check-2`), and the real
 * Check of a collection through the composed exporters.
 */
import { createHash } from "node:crypto";
import { PACKAGE_BUILD_2, PACKAGE_CHECK_2, type ExportedLook, type ExportOmission, type FeatureCheck, type PackageBuildResult,
  type PackageCheckResult } from "../../src/platform/api";
import { checkProducts } from "../../src/platform/export/product-check";
import { STUDIO_EXPORTERS } from "../../src/compose/exporters";

/** A Check result: the default mod (XF Eye Artistry) with eye makeup's looks and omissions as given. */
export function eyeCheck(collection: { id: string }, options: { presets: ExportedLook[]; omissions?: ExportOmission[];
  originalPresetCount?: number; notes?: string[] }): PackageCheckResult {
  const feature: FeatureCheck = { feature: "eye-makeup", label: "Eye makeup", exporter: "eye-makeup/mesh-decal", exporterVersion: "1",
    namespace: "xfs_test", brand: "XF Eye Artistry", selectorLabel: "XF", selector: "own", presets: options.presets,
    omissions: options.omissions ?? [], experimental: [], notes: options.notes ?? [], requirements: { ArchiveXL: "1.27.3", game: "2.31" },
    packagedSha256: "test", details: { plateLiftsMm: [0.4], plateUv: null } };
  return { schema: PACKAGE_CHECK_2, ready: true, collectionId: collection.id, originalPresetCount: options.originalPresetCount ?? options.presets.length,
    omissions: [], collectionSha256: "source", products: [{ productId: collection.id, modName: "XF Eye Artistry", nameSource: "derived",
      archive: "xfs_test", isDefault: true, features: [feature], requirements: feature.requirements, omissions: [] }] };
}

/** A Build result for a Check result: each product as a verified private candidate at `root/<archive>`. */
export function eyeBuild(check: PackageCheckResult, root = "dist"): PackageBuildResult {
  const { schema: _schema, ready: _ready, products, ...common } = check;
  return { ...common, schema: PACKAGE_BUILD_2, installed: false, gameRenderingVerified: false, products: products.map(product => ({ ...product,
    package: `${root}/${product.archive}`, manifest: `${root}/${product.archive}/manifest.json`, archiveSha256: "a".repeat(64), xlSha256: "b".repeat(64),
    verifiedUnpackedFiles: 1, installed: false, gameRenderingVerified: false })) };
}

/** The real Check of a collection (any stored schema) through the composed exporters, on no prepared plate. */
export function realCheck(collection: unknown): PackageCheckResult {
  return checkProducts({ collection, exporters: STUDIO_EXPORTERS, prerequisites: {}, diagnostics: false, preflight: true,
    collectionSha256: createHash("sha256").update(JSON.stringify(collection)).digest("hex") }).result;
}
