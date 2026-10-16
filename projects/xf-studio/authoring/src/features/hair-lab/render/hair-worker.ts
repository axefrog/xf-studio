import { encodeScalarBytes } from "../../../platform/api/scalar-image";
import { capCoverage, constrainDensity, densityCoverage, coveragePattern } from "../scalp";
/** Worker source adapter; all geometry preparation and refinement stay off the page thread. */
import { buildCharacterContact, type DistanceGrid } from "../contact";
import { defaultGroom, sampleRoots, seedAnatomicalDensity, surfaceBounds, validateGroom } from "../groom";
import { coarsePaths, continuePaths, cutPaths, drapeStep, pathResiduals, retargetContinuation, unsettledPaths } from "../solve";
import type { Groom, HeadSurface } from "../types";
import { deriveVolumes, volumeMesh } from "../volumes";
import { generateCards, cardContact } from "../cards";
let requested = 0;
let coverageCache: { key: string; value: ReturnType<typeof capCoverage>; encoded: string; check: ReturnType<typeof densityCoverage> & { pattern: ReturnType<typeof coveragePattern> } } | undefined;
let contactCache: { revision: string; grid: DistanceGrid } | undefined;
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
self.onmessage = async event => {
  const message = event.data as { id: number; surface: HeadSurface; groom: Groom | null; previous?: import("../service").Continuation | null; cancel?: number };
  if (message.cancel) { if (requested === message.cancel) requested = 0; return; }
  const { id, surface } = message; requested = id;
  try {
    const started = performance.now(), groom = message.groom ?? defaultGroom(surface), issues = validateGroom(groom);
    if (issues.length) throw Error(issues.join(" "));
    if (contactCache?.revision !== surface.revision) {
      const grid = buildCharacterContact(surface, 96);
      contactCache = { revision: surface.revision, grid };
    }
    const contactPrepared = performance.now();
    const variant = new URLSearchParams(self.location.search).get("shape");
    const strategy = variant === "tangent" || variant === "supported" ? variant : "face-frame";
    const contactSurface = surface.body ? { ...surface, capsules: [] } : surface;
    const roots = sampleRoots(groom, surface, groom.solver.samples);
    const template = message.previous ? retargetContinuation(message.previous, groom, roots) : null;
    const initial = template && message.previous ? continuePaths(message.previous, groom, template, contactCache.grid) : null;
    const paths = initial ?? coarsePaths(groom, roots, surface.down, surface.front, { grid: contactCache.grid, surface, strategy });
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
    const coarsePathsResult = cutPaths(groom, paths, contactCache.grid);
    const coarseVolumes = deriveVolumes(groom, coarsePathsResult), coarseVolumeGeometry = volumeMesh(coarseVolumes, contactCache.grid), coarseCards = generateCards(coarseVolumes, undefined, contactCache.grid, initial ? 0 : 2), coarseDisplay = performance.now();
    self.postMessage({ id, result: { groom, coverage, coverageGeometry, tintCheck, continuation: !!initial, paths: coarsePathsResult, volumes: coarseVolumes, volumeGeometry: coarseVolumeGeometry, cards: coarseCards, stage: "coarse", residuals: null, milliseconds: { coarse: coarse - contactPrepared, paths: coverageStarted - contactPrepared, coverage: coverageFinished - coverageStarted, contact: contactPrepared - started, display: coarseDisplay - coarse } } });
    await yieldTask(); if (requested !== id) return;
    
    const prepared = performance.now(); let rest = paths, result = structuredClone(paths);
    const stages = groom.cut && !initial ? 2 : 1;
    for (let stage = 0; stage < stages; stage++) {
      if (stage) { rest = cutPaths(groom, result, contactCache.grid); result = structuredClone(rest); }
      let active: number[] | undefined = stage || initial && groom.cut ? unsettledPaths(result, rest, contactCache.grid, groom.solver.clearanceMetres, contactSurface.capsules) : undefined;
      if (active && !active.length) continue;
      for (let step = 0; step < groom.solver.steps; step++) {
        drapeStep(groom, result, rest, contactCache.grid, contactSurface.capsules, surface.down, active);
        await yieldTask(); if (requested !== id) return;
        if (step >= 1) { active = unsettledPaths(result, rest, contactCache.grid, groom.solver.clearanceMetres, contactSurface.capsules); if (!active.length) break; }
      }
    }
    const trimmed = cutPaths(groom, result, contactCache.grid), trimmedRest = cutPaths(groom, rest, contactCache.grid);
    const residuals = pathResiduals(trimmed, trimmedRest, contactCache.grid, groom.solver.clearanceMetres, contactSurface.capsules), solved = performance.now();
    const volumes = deriveVolumes(groom, trimmed), volumeGeometry = volumeMesh(volumes, contactCache.grid), volumesFinished = performance.now(), cards = generateCards(volumes, undefined, contactCache.grid), cardsFinished = performance.now(), contact = cardContact(cards, contactCache.grid), finished = performance.now();
    self.postMessage({ id, result: { groom, coverage, coverageGeometry, tintCheck, continuation: !!initial, paths: trimmed, uncutPaths: result, volumes, volumeGeometry, cards, cardContact: contact, stage: "refined", residuals, milliseconds: { coarse: coarse - contactPrepared, paths: coverageStarted - contactPrepared, coverage: coverageFinished - coverageStarted, contact: contactPrepared - started, queue: prepared - coarseDisplay, solve: solved - prepared, volumes: volumesFinished - solved, cards: cardsFinished - volumesFinished, cardContact: finished - cardsFinished, total: finished - started } }, done: true });
  } catch (error) { if (requested === id) self.postMessage({ id, error: error instanceof Error ? error.message : "Hair generation failed." }); }
};
