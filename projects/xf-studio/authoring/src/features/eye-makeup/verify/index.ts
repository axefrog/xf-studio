/**
 * Eye makeup's independent verifier as the export host runs it (feature-module platform §6, §7 rule 3): its
 * checks of its own resources in the product archive the host unbundled. Like everything in this folder it
 * imports nothing from the exporter (`../export`) or any engine compiler, raster or bake module; the rules it
 * checks are restated here (tests/mod-verifier.test.ts and the boundary test enforce it).
 */
import type { FeatureVerifier } from "../../../platform/api";
import { EYE_MAKEUP_EXPORTER_ID, EYE_PLATE_PREREQUISITE } from "../export-info";
import { ensure } from "./resource-checks";
import { verifyEyeMakeupBuild } from "./verify-build";

export { verifyBuild, verifyEyeMakeupBuild, VerificationError, VERIFICATION_LIMITS, type VerificationReport } from "./verify-build";

/** The plate files the build packaged and their provenance, as the host's prerequisite value carries them. */
type PlateInput = { mesh?: unknown; morph?: unknown; morphTargets?: unknown; record?: { meshSha256?: unknown; morphSha256?: unknown } };

export const EYE_MAKEUP_VERIFIER: FeatureVerifier = Object.freeze<FeatureVerifier>({
  exporterId: EYE_MAKEUP_EXPORTER_ID,
  verify(input) {
    const plate = input.prerequisites[EYE_PLATE_PREREQUISITE] as PlateInput | undefined;
    ensure(plate && typeof plate.mesh === "string" && typeof plate.morph === "string" && typeof plate.record?.meshSha256 === "string" &&
      typeof plate.record?.morphSha256 === "string", "The verifier needs the plate the build packaged");
    const report = verifyEyeMakeupBuild({ work: input.work, staging: input.staging, unpacked: input.unpacked, tools: input.tools,
      workDir: input.verifyDir, packagedCollection: input.packaged,
      plate: { mesh: plate.mesh as string, morph: plate.morph as string, meshSha256: plate.record!.meshSha256 as string,
        morphSha256: plate.record!.morphSha256 as string },
      ...(Number.isSafeInteger(plate.morphTargets) ? { morphTargets: plate.morphTargets as number } : {}) });
    return { presetCount: report.presetCount, verifiedFiles: report.unpackedFilesVerified, limits: report.limits,
      report: report as unknown as Record<string, unknown> };
  },
});
