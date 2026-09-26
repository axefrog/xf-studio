/**
 * Fakes for the export host's builder (platform/export/product-builder): WolvenKit stand-ins that convert
 * inputs into placeholder resources, pack by remembering the staging tree and unbundle by copying it back, a
 * synthetic eye plate over the fixture's lids, and an eye-makeup verifier stand-in that reports what the
 * real one would. Also a stub exporter for a second feature (a "lips" feature writing two resources).
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureExporter, FeatureExporterEntry, FeatureVerification, FeatureVerifier, ResourceTools, VerifierTools, XlFragment } from "../../src/platform/api";
import { COLLECTION_2, ExportRefusal } from "../../src/platform/api";
import { EYE_MAKEUP_EXPORTER } from "../../src/features/eye-makeup/export";
import { EYE_PLATE_PREREQUISITE, EYE_MAKEUP_EXPORTER_ID } from "../../src/features/eye-makeup";
import { VERIFICATION_LIMITS } from "../../src/features/eye-makeup/verify";
import { derivePlateDocuments } from "../../src/eye-plate-cut";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "../eye-plate-fixture";
import { plateUvFootprint } from "../../src/engines/layered-makeup/plate-uv-window";
import { PLATE_UV_FILE, plateUvManifestRecord } from "../../src/plate-uv-footprint-io";

/** A synthetic plate over the fixture's lids (UVs like the built-in plate's rectangle), and its UV footprint. */
export const PLATE = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh"), plateLikeUv);
export const FOOTPRINT = plateUvFootprint(PLATE.mesh.Data.RootChunk);
export const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Stands in for WolvenKit: one placeholder resource per converted input, so the path gates see the real plan; pack remembers its tree. */
export function fakeTools(calls: string[], packed: Map<string, string>): ResourceTools {
  const step = (name: string, exitCode = 0) => { calls.push(name); return { exitCode, log: `${name} ok` }; };
  return {
    async importTextures(input, output) {
      for (const file of readdirSync(input)) writeFileSync(join(output, file.replace(/\.dds$/, ".xbm")), readFileSync(join(input, file)));
      return step("import", 3);
    },
    async serialize(input, output) {
      if (readdirSync(input).some(name => name.endsWith(".mesh") && !name.includes("collection"))) {
        const stem = readdirSync(input).find(name => name.endsWith(".mesh"))!.replace(/\.mesh$/, "");
        // A real single-chunk plate cut from the synthetic head, which the builder lifts.
        writeFileSync(join(output, stem + ".mesh.json"), JSON.stringify(PLATE.mesh));
        writeFileSync(join(output, stem + ".morphtarget.json"), JSON.stringify(PLATE.morph));
      }
      return step("serialize");
    },
    async deserialize(input, output) {
      for (const file of readdirSync(input)) writeFileSync(join(output, file.replace(/\.json$/, "")), readFileSync(join(input, file)));
      return step("deserialize");
    },
    async pack(input, output) {
      const archive = join(output, "archive.archive");
      writeFileSync(archive, `packed ${packed.size}`);
      packed.set(sha(readFileSync(archive)), input);
      return step("pack");
    },
  };
}

/** The verifiers' WolvenKit stand-in: unbundle copies back the tree the fake pack remembered for that archive. */
export function fakeVerifierTools(packed: Map<string, string>, calls: string[] = []): VerifierTools {
  return {
    unbundle(archive, output) {
      calls.push("unbundle");
      const tree = packed.get(sha(readFileSync(archive)));
      if (!tree) return { exitCode: 1, stdout: "", stderr: "unknown archive" };
      cpSync(tree, output, { recursive: true });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
    serialize: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    exportTextures: () => ({ exitCode: 0, stdout: "", stderr: "" }),
  };
}

type EyeReport = { presetRoutes?: unknown; plateInputs?: { mesh: string; morph: string }; plateGeometry?: { liftsMm: unknown } };
/**
 * Eye makeup's verifier stand-in: reports the plan's routes, lifts and the packaged plate's hashes as the real one
 * would (overridable), and records what it was given.
 */
export function fakeEyeVerifier(seen: Parameters<FeatureVerifier["verify"]>[0][] = [], overrides: Partial<FeatureVerification> & { report?: EyeReport } = {}): FeatureVerifier {
  return {
    exporterId: EYE_MAKEUP_EXPORTER_ID,
    verify(input) {
      seen.push(input);
      if (overrides.report === undefined && "throws" in overrides) throw Error(String((overrides as { throws: unknown }).throws));
      const build = JSON.parse(readFileSync(join(input.work, "build.json"), "utf8"));
      const plate = input.prerequisites[EYE_PLATE_PREREQUISITE] as { mesh: string; morph: string };
      return { presetCount: build.plan.presets.length, verifiedFiles: build.artifacts.length, limits: [...VERIFICATION_LIMITS],
        ...overrides,
        report: { presetRoutes: build.plan.presets.map((p: { id: string; route: string }) => ({ id: p.id, route: p.route })),
          plateInputs: { mesh: sha(readFileSync(plate.mesh)), morph: sha(readFileSync(plate.morph)) },
          plateGeometry: { liftsMm: build.plan.plate.liftsMm }, ...overrides.report } };
    },
  };
}

/** The eye-makeup exporter with a verifier stand-in. */
export const eyeEntry = (verifier: FeatureVerifier = fakeEyeVerifier()): FeatureExporterEntry =>
  ({ exporter: EYE_MAKEUP_EXPORTER as FeatureExporter<unknown>, verifier });

/** A prepared plate folder (mesh, morph target, cache manifest and recorded footprint) in `dir`. */
export function writePlate(dir: string, recordFootprint = true) {
  const plate = join(dir, "plate");
  mkdirSync(plate, { recursive: true });
  writeFileSync(join(plate, "xfs_eye_plate.mesh"), "mesh fixture");
  writeFileSync(join(plate, "xfs_eye_plate.morphtarget"), "morph fixture");
  const manifest = { schema: "xfs/eye-plate-cache-1", recipeId: "xfs-expanded-eye-plate", recipeRevision: 1, cacheKey: "c".repeat(64),
    source: { revisionId: "cp2077-2.31" }, verification: { morphTargets: 105 },
    files: { mesh: { sha256: sha("mesh fixture") }, morph: { sha256: sha("morph fixture") } },
    ...(recordFootprint ? { uv: plateUvManifestRecord(FOOTPRINT) } : {}) };
  writeFileSync(join(dir, "plate-manifest.json"), JSON.stringify(manifest));
  if (recordFootprint) writeFileSync(join(dir, PLATE_UV_FILE), JSON.stringify(FOOTPRINT));
  return { plate, manifestFile: join(dir, "plate-manifest.json"), manifest };
}

// ---------------------------------------------------------------------------------------------
// A stub second feature: "lips", whose part is `{ shades: string[] }`; it writes one app and one texture per look.
// ---------------------------------------------------------------------------------------------

export const LIPS = "lips";
type LipsPlan = { namespace: string; looks: { id: string; name: string; revision: number }[]; app: string; textures: string[] };
const lipsLooks = (collection: unknown) => ((collection as { schema?: unknown; presets?: unknown[] })?.schema === COLLECTION_2
  ? ((collection as { presets: { id: string; name: string; revision: number; parts?: Record<string, unknown> }[] }).presets
    .filter(look => look.parts?.[LIPS])) : []);
export const LIPS_EXPORTER: FeatureExporter<LipsPlan> = {
  id: "lips/stub", version: "1", feature: LIPS, label: "Lip makeup",
  info: { exporterId: "lips/stub", brand: "XF Lip Artistry", selectorLabel: "XF Lips", selector: "vanilla" }, prerequisites: [],
  present: collection => lipsLooks(collection).length > 0,
  plan(input) {
    const looks = lipsLooks(input.collection), id = (input.collection as { id: string }).id.replaceAll("-", "");
    if (!looks.length) throw new ExportRefusal("no_exportable_content", "No mod files can be made: no look has lip makeup.");
    const depot = `axefrog/xf_studio/${id}/lips`;
    const plan: LipsPlan = { namespace: `xfs_c${id}_lips`, looks: looks.map(({ id, name, revision }) => ({ id, name, revision })),
      app: `${depot}/xfs_lips.app`, textures: looks.map(look => `${depot}/textures/xfs_p${look.id.replaceAll("-", "")}_lips.xbm`) };
    const packaged = JSON.stringify(plan.looks);
    const xl: XlFragment = { scope: { "player_customization.app": [plan.app] } };
    return { plan, packaged, inventory: [plan.app, ...plan.textures].sort(), xl,
      check: { feature: LIPS, label: "Lip makeup", exporter: "lips/stub", exporterVersion: "1", namespace: plan.namespace, brand: "XF Lip Artistry",
        selectorLabel: "XF Lips", selector: "vanilla", presets: plan.looks.map(({ id, revision }) => ({ id, revision })), omissions: [],
        experimental: [], notes: [], requirements: { ArchiveXL: "1.28.0" }, packagedSha256: sha(packaged), details: {} } };
  },
  async build(outcome, context) {
    const files = [];
    for (const path of outcome.inventory) {
      const file = join(context.staging, ...path.split("/"));
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, `lips ${path}`);
      files.push({ path, bytes: Buffer.byteLength(`lips ${path}`), sha256: sha(`lips ${path}`) });
    }
    mkdirSync(context.work, { recursive: true });
    return { files };
  },
};
export const LIPS_VERIFIER: FeatureVerifier = { exporterId: "lips/stub",
  verify: input => ({ presetCount: 0, verifiedFiles: input.unpacked.files.filter(file => file.path.includes("/lips/")).length, limits: [], report: {} }) };
export const LIPS_ENTRY: FeatureExporterEntry = { exporter: LIPS_EXPORTER as FeatureExporter<unknown>, verifier: LIPS_VERIFIER };
