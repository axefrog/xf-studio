import { describe, expect, test } from "bun:test";
import { dangleOf } from "../src/character-detail-plan";
import type { ResolvedComponent } from "../src/character-resolver";
import { MotionActions, PHYSICS_NO_DANGLES, PHYSICS_NO_RIG, PHYSICS_UNSUPPORTED, type MotionPort } from "../src/motion-actions";
import { freshWorkspace } from "./fixtures/eye-region";
import { createStudioViewGraph, previewMirror, workspaceViewGraph } from "../src/preview-view-graph";
import { MAIN_VIEW } from "../src/platform/api/view-graph";

const provenance = (path: string) => ({ ref: { hash: path, path }, status: "archive" }) as unknown as NonNullable<ResolvedComponent["geometry"]>["mesh"];
const component = (fields: Partial<ResolvedComponent> & { name: string; source: string }): ResolvedComponent => ({
  type: "entSkinnedMeshComponent", origin: { kind: "part", source: fields.source }, meshAppearance: "", chunkMask: "", overriddenBy: [], geometry: null,
  morphRegions: {}, appliedMorphs: [], meshAppearanceResolved: null, materials: [], notes: [], ...fields }) as ResolvedComponent;
const animated = (name: string, source: string, rig: string) => component({ name, source, type: "entAnimatedComponent",
  animated: { rig: provenance(rig), graph: provenance(rig.replace(".rig", ".animgraph")), controlBinding: "root", parentTransform: "root" } });

describe("which dangle component a part's mesh reads", () => {
  test("the animated component its skinning names, preferring the mesh's own part when several share the name (a CCXL pack)", () => {
    const partA = animated("hair_dangle", "pt1.ent", "pt1.rig"), partB = animated("hair_dangle", "pt2.ent", "pt2.rig");
    const mesh = component({ name: "hair_pt2", source: "pt2.ent", skinning: "hair_dangle" });
    expect(dangleOf({ components: [partA, partB, mesh] }, mesh).dangle).toMatchObject({ component: "hair_dangle", drivenBy: "root" });
    expect(dangleOf({ components: [partA, partB, mesh] }, mesh).dangle!.rig.ref.path).toBe("pt2.rig");
  });
  test("a mesh skinned to V's skeleton reads the one dangle component that skeleton controls (worn physics earrings), never a guess among several", () => {
    const earring = component({ name: "earring", source: "e.ent", skinning: "root" });
    expect(dangleOf({ components: [earring, animated("earrings_dangles", "e.ent", "e.rig")] }, earring).dangle).toMatchObject({ component: "earrings_dangles" });
    expect(dangleOf({ components: [earring, animated("a_dangle", "e.ent", "a.rig"), animated("b_dangle", "e.ent", "b.rig")] }, earring).dangle).toBeUndefined();
    expect(dangleOf({ components: [earring] }, earring).dangle).toBeUndefined();
    expect(dangleOf({ components: [] }, component({ name: "hair", source: "h.ent" })).dangle).toBeUndefined();
  });
});

describe("hair physics: one setting per scene", () => {
  const port = (dangles?: { parts: number; simulated: boolean }, available = true): MotionPort => ({ available, blink: { available: false },
    setIdle() {}, setIdlePaused() {}, setIdleContributions() {}, setBlink() {}, animateBlink() {}, ...(dangles ? { dangles: () => dangles } : {}) });
  const scene = () => { let on = false; return { physics: () => on, setPhysics: (enabled: boolean) => { on = enabled; } }; };

  test("is off by default and refuses to turn on, in plain words, when nothing on V has physics it can run", () => {
    const initial = freshWorkspace().preview;
    expect(new MotionActions(initial, port({ parts: 1, simulated: true }), scene()).snapshot().physics).toBe(false);
    expect(new MotionActions(initial, port(), scene()).capability({ kind: "motion.setPhysics", enabled: true }).reason).toBe(PHYSICS_NO_RIG);
    expect(new MotionActions(initial, port({ parts: 0, simulated: false }), scene()).capability({ kind: "motion.setPhysics", enabled: true }).reason).toBe(PHYSICS_NO_DANGLES);
    expect(new MotionActions(initial, port({ parts: 2, simulated: false }), scene()).capability({ kind: "motion.setPhysics", enabled: true }).reason).toBe(PHYSICS_UNSUPPORTED);
    // Turning it off always works.
    expect(new MotionActions(initial, port({ parts: 0, simulated: false }), scene()).capability({ kind: "motion.setPhysics", enabled: false }).available).toBe(true);
  });

  test("turning it on edits the scene setting", () => {
    const s = scene(), motion = new MotionActions(freshWorkspace().preview, port({ parts: 1, simulated: true }), s);
    motion.dispatch({ kind: "motion.setPhysics", enabled: true });
    expect(s.physics()).toBe(true);
    expect(motion.snapshot()).toMatchObject({ physics: true, physicsAvailable: true, physicsParts: 1 });
  });

  test("the scene node holds it and the workspace mirrors it only once set, so an untouched workspace keeps its bytes", () => {
    const preview = freshWorkspace().preview;
    const graph = createStudioViewGraph(preview);
    expect("physics" in previewMirror(graph)).toBe(false);
    graph.edit(MAIN_VIEW, "scene", { state: { physics: true } }, { label: "Hair physics on" });
    expect(previewMirror(graph).physics).toBe(true);
    // A stored workspace with it reads it back into the main view's scene node.
    expect(previewMirror(createStudioViewGraph({ ...preview, physics: true })).physics).toBe(true);
    expect(workspaceViewGraph({ ...preview, physics: true }, undefined).scenes[0]).toMatchObject({ physics: true });
  });
});
