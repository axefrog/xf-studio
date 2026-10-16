import { encodeScalarBytes } from "../../../platform/api/scalar-image";
import { capCoverage, constrainDensity, densityCoverage, coveragePattern } from "../scalp";
/** Worker source adapter; all geometry preparation and refinement stay off the page thread. */
import { buildDistanceGrid, type DistanceGrid } from "../contact";
import { defaultGroom, sampleRoots, seedAnatomicalDensity, surfaceBounds, validateGroom } from "../groom";
import { coarsePaths, cutPaths, drapeStep, pathResiduals } from "../solve";
import { dot, smooth, sub } from "../types";
import type { Groom, HeadSurface } from "../types";
let requested = 0;
let coverageCache: { key: string; value: ReturnType<typeof capCoverage>; encoded: string; check: ReturnType<typeof densityCoverage> & { pattern: ReturnType<typeof coveragePattern> } } | undefined;
let contactCache: { revision: string; grid: DistanceGrid } | undefined;
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
self.onmessage = async event => {
  const message = event.data as { id: number; surface: HeadSurface; groom: Groom | null; cancel?: number };
  if (message.cancel) { if (requested === message.cancel) requested = 0; return; }
  const { id, surface } = message; requested = id;
  try {
    const started = performance.now(), groom = message.groom ?? defaultGroom(surface), issues = validateGroom(groom);
    if (issues.length) throw Error(issues.join(" "));
    if (contactCache?.revision !== surface.revision) {
      const grid = buildDistanceGrid(surface, 96);
      if (surface.body) grid.others = [buildDistanceGrid({ ...surface, ...surface.body }, 96)];
      contactCache = { revision: surface.revision, grid };
    }
    const contactPrepared = performance.now();
    const variant = new URLSearchParams(self.location.search).get("shape");
    const strategy = variant === "tangent" || variant === "supported" ? variant : "face-frame";
    const contactSurface = surface.body ? { ...surface, capsules: [] } : surface;
    const roots = sampleRoots(groom, surface, groom.solver.samples), paths = coarsePaths(groom, roots, surface.down, surface.front, { grid: contactCache.grid, surface, strategy });
    const coverageStarted = performance.now();
    const density = constrainDensity(surface, groom.scalp.density ?? seedAnatomicalDensity(surface));
    const coverageKey = `${surface.revision}:${surface.coverageSurface?.resource}:${groom.flow?.part}:${groom.flow?.foreheadSweep}:${JSON.stringify(density)}`;
    if (coverageCache?.key !== coverageKey) {
      const bounds = surfaceBounds(surface), partX = bounds.centre[0] + bounds.size[0] * .5 * (groom.flow?.part ?? 0);
      const value = capCoverage(surface, density, { xMetres: partX, centre: bounds.centre, heightMetres: bounds.size[1], strength: groom.flow?.foreheadSweep ?? 1 }), check = { ...densityCoverage(surface, density), pattern: coveragePattern(value.mask) };
      if (!check.passed) throw Error("Scalp coverage escaped its head-bound region.");
      if (check.pattern.periodic) throw Error("Scalp coverage has repeated holes. Try again.");
      coverageCache = { key: coverageKey, value, encoded: encodeScalarBytes(value.mask.values), check };
    }
    const capResult = coverageCache.value, coverage = { ...capResult.mask, values: coverageCache.encoded }, coverageGeometry = capResult.geometry, tintCheck = coverageCache.check;
    const coverageFinished = performance.now();
    const coarse = performance.now();
    self.postMessage({ id, result: { groom, coverage, coverageGeometry, tintCheck, paths: cutPaths(groom, paths), stage: "coarse", residuals: null, milliseconds: { coarse: coarse - contactPrepared, paths: coverageStarted - contactPrepared, coverage: coverageFinished - coverageStarted, contact: contactPrepared - started } } });
    await yieldTask(); if (requested !== id) return;
    
    const prepared = performance.now(), result = structuredClone(paths);
    for (let step = 0; step < groom.solver.steps; step++) {
      drapeStep(groom, result, paths, contactCache.grid, contactSurface.capsules, surface.down);
      await yieldTask(); if (requested !== id) return;
      const residual = pathResiduals(result, paths, contactCache.grid, groom.solver.clearanceMetres, contactSurface.capsules);
      if (residual.lengthRatio < .02 && residual.penetrationMetres < .00005) break;
    }
    const trimmed = cutPaths(groom, result), trimmedRest = cutPaths(groom, paths);
    const residuals = pathResiduals(trimmed, trimmedRest, contactCache.grid, groom.solver.clearanceMetres, contactSurface.capsules), finished = performance.now();
    self.postMessage({ id, result: { groom, coverage, coverageGeometry, tintCheck, paths: trimmed, stage: "refined", residuals, milliseconds: { coarse: coarse - contactPrepared, paths: coverageStarted - contactPrepared, coverage: coverageFinished - coverageStarted, contact: contactPrepared - started, queue: prepared - coarse, solve: finished - prepared, total: finished - started } }, done: true });
  } catch (error) { if (requested === id) self.postMessage({ id, error: error instanceof Error ? error.message : "Hair generation failed." }); }
};
