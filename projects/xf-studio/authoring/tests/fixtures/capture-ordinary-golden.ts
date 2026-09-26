/**
 * Captures `tests/golden/ordinary-package.json` (PIPE-76): for every committed collection fixture without a glitter
 * knob, digests of its export plan, the plate mesh's materials and appearances, the plate morph and the ArchiveXL
 * declaration built over a synthetic plate with plate-like UVs, and the SHA-256 of every baked map. It was run once
 * before the diagnostic Glitter cleanup (commit 8413f25); ordinary builds must keep these exact results.
 *   bun tests/fixtures/capture-ordinary-golden.ts <commit>
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { derivePlateDocuments } from "../../src/eye-plate-cut";
import { bakeCollection } from "../../src/package-bake";
import { preparePackageCollection } from "../../src/package-filter";
import { archiveXlDeclaration, HandleCounter, rewritePlateMesh, rewritePlateMorph } from "../../src/package-resources";
import { liftPlate } from "../../src/plate-lift";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "../eye-plate-fixture";
import { plateWindow } from "../window-fixture";
import { COLLECTION_FIXTURES, readFixture } from "./capture-plan-golden";
import { digest } from "./workspace-observable";

/** Ordinary fixtures: the committed collections whose presets carry no glitter knob (the plan golden covers all of them). */
export const ORDINARY_FIXTURES = COLLECTION_FIXTURES.filter(path =>
  !Object.values((readFixture(path).diagnostics?.presets ?? {}) as Record<string, { glitter?: unknown }>).some(entry => entry.glitter));
/** Fixtures whose baked maps are pinned too (every ordinary route: flat, faceted, Fresnel, lifts, surface and head-UV knobs). */
export const BAKED_FIXTURES = ["016-finish-board/finish-board.collection.json", "020-session-2/session-2.collection.json"];

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** The package documents an ordinary collection builds on the synthetic plate, and (optionally) its baked maps. */
export async function ordinaryDigests(path: string, bake: boolean) {
  const cut = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh"), plateLikeUv);
  const { window, transform } = plateWindow(cut);
  const prepared = preparePackageCollection(readFixture(path)), plan = prepared.plan;
  const lifted = liftPlate({ Data: { RootChunk: { ...structuredClone(cut.mesh.Data.RootChunk), appearances: [], materialEntries: [], localMaterialBuffer: {} } } },
    cut.morph, plan.plate.liftsMm);
  const mesh = rewritePlateMesh(lifted.mesh, plan, new HandleCounter(), transform).Data.RootChunk;
  const morph = rewritePlateMorph(lifted.morph, plan).Data.RootChunk;
  const out: Record<string, unknown> = {
    plan: digest(plan),
    materials: digest({ materialEntries: mesh.materialEntries, localMaterialBuffer: mesh.localMaterialBuffer, appearances: mesh.appearances }),
    morph: digest({ baseMesh: morph.baseMesh, baseMeshAppearance: morph.baseMeshAppearance }),
    archiveXl: sha(archiveXlDeclaration(plan)),
  };
  if (bake) {
    const dir = mkdtempSync(resolve(tmpdir(), "xfs-ordinary-golden-"));
    try {
      const { records } = await bakeCollection(JSON.parse(JSON.stringify(prepared.packaged)), dir, undefined, { window });
      out.maps = Object.fromEntries(records.flatMap(record => [...record.maps.map(map => [map.file, map.sha256]),
        ...(record.reference ? [[record.reference.file, record.reference.sha256]] : [])]));
      out.compiled = sha(readFileSync(join(dir, "compiled.json")));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return out;
}

if (import.meta.main) {
  const golden: Record<string, unknown> = {};
  for (const path of ORDINARY_FIXTURES) golden[path] = await ordinaryDigests(path, BAKED_FIXTURES.includes(path));
  writeFileSync(new URL("../golden/ordinary-package.json", import.meta.url),
    JSON.stringify({ capturedFrom: process.argv[2] ?? "working tree", fixtures: golden }, null, 1) + "\n");
  console.log(Object.keys(golden).length, "fixtures");
}
