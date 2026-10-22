import { afterEach, expect, test } from "bun:test";
import * as THREE from "three";
import { loadCoreDetail } from "../src/character/render/core-detail-loader";
import { loadGameMotion } from "../src/platform/scene/head-rig";
import { createFeatureRenderers, type FeatureRendererContext } from "../src/platform/scene/feature-renderers";
import { featureId } from "../src/platform/api/feature";
import type { FeatureRendererFactory } from "../src/platform/api/scene";

/**
 * A scene runtime's build steps under an abort (profiles phase 4a-ii, experiments/043-scene-runtimes §8): a step cut short by the abort
 * rejects with the signal's reason, never as a failure of the files, the idle or a renderer, so a superseded build is never reported as a
 * broken preview. The whole build on a real GPU (aborted at each step, a failing step after an abort included) is
 * tests/webgl-renderer-device.test.ts.
 */

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A fetch that is aborted while in flight and then fails, as a cut connection does. */
const abortingFetch = (controller: AbortController) => async () => { controller.abort(); throw new TypeError("Failed to fetch"); };

test("the core head's record read cut short by an abort rejects with the abort, not as an unreachable preview", async () => {
  const controller = new AbortController();
  const reason = await loadCoreDetail({} as THREE.WebGLRenderer, abortingFetch(controller), "female", controller.signal).catch(error => error);
  expect(reason).toBe(controller.signal.reason);
  expect((reason as Error).name).toBe("AbortError");
  // An answer that arrives after the abort (the host said the preview isn't prepared) is not reported either.
  const late = new AbortController();
  const answered = await loadCoreDetail({} as THREE.WebGLRenderer, async () => { late.abort(); return new Response("missing", { status: 404 }); },
    "female", late.signal).catch(error => error);
  expect(answered).toBe(late.signal.reason);
  // Without an abort the same failure is the preview's.
  const plain = await loadCoreDetail({} as THREE.WebGLRenderer, async () => { throw new TypeError("Failed to fetch"); }, "female").catch(error => error);
  expect((plain as { code?: string }).code).toBe("preview_unreachable");
});

test("the rig's motion cut short by an abort rejects with the abort instead of becoming the idle's error", async () => {
  const controller = new AbortController();
  globalThis.fetch = abortingFetch(controller) as unknown as typeof fetch;
  const eye = { mesh: new THREE.Mesh(), material: new THREE.MeshBasicMaterial(), replace: () => {} };
  const reason = await loadGameMotion(new THREE.Scene(), eye, "female", controller.signal).catch(error => error);
  expect(reason).toBe(controller.signal.reason);
  // Without an abort the idle's failure stays the idle's (the motion loads without it).
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  const motion = await loadGameMotion(new THREE.Scene(), eye, "female");
  expect(motion.idle).toBeUndefined();
  expect(motion.idleError).not.toBe("");
});

test("feature renderers stop at an abort: the renderer made is disposed, the next is never made, and the abort is what rejects", () => {
  const controller = new AbortController(), log: string[] = [];
  const listen = () => () => {};
  const context: FeatureRendererContext = { renderer: {} as THREE.WebGLRenderer, head: new THREE.SkinnedMesh(), surfaces: new Map(),
    skin: { light: () => null, underlay: () => { throw Error("no underlay"); }, subscribe: listen }, character: () => ({ identity: null, drawn: [] }),
    subscribeCharacter: listen, requestFrame: () => {}, onFrame: listen, rig: { attach: () => {}, detach: () => {} }, supersededChanged: () => {} };
  const factory = (id: string, abort: boolean): FeatureRendererFactory => ({ feature: featureId(id), create() {
    log.push(`create ${id}`);
    if (abort) controller.abort();
    return { dispose: () => { log.push(`dispose ${id}`); } };
  } });
  let thrown: unknown;
  try { createFeatureRenderers(context, [factory("first", true), factory("second", false)], controller.signal); } catch (error) { thrown = error; }
  expect(thrown).toBe(controller.signal.reason);
  expect(log).toEqual(["create first", "dispose first"]);
});
