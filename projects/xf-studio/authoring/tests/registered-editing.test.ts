/**
 * Eye makeup's registered behaviour is the only way its part changes:
 * - CORE-31: dispatched actions, form controls and gesture frames all run the registered spec or
 *   gesture provider and publish through the eye-makeup port.
 * - CORE-32: an action records an Undo entry by its Undo policy (variant first), never by its effect,
 *   and context-menu options report the policy of the variant they edit.
 * - CORE-33: apply is pure and deterministic for every one of the 29 kinds: the host supplies the
 *   IDs of new items, so the same state and action always give the same result.
 */
import { expect, test } from "bun:test";
import { STUDIO_COMPOSITION, STUDIO_OWNERS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { EYE_MAKEUP, assignEyeMakeupIds } from "../src/features/eye-makeup";
import { undoPolicyOf, type ActionSpec, type FeatureActionSpec } from "../src/platform/api";
import { Registry } from "../src/platform/core/registry";
import { type Recipe } from "../src/engines/layered-makeup/recipe";
import type { EyeMakeupAction, EyeMakeupState } from "../src/eye-makeup-model";
import { createTrustedAuthoringCore, type StudioComposition } from "../src/trusted-authoring-core";
import { glitterRecipe, opticsRecipe } from "./fixtures/workspace-v1-fixtures";
import { readRecipe as parseRecipe } from "../src/recipe-schema";
import { freshWorkspace } from "./fixtures/eye-region";

type Spec = FeatureActionSpec<Recipe, EyeMakeupState["editor"], EyeMakeupAction>;
const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

/** Game-matched Glossy and Colour-shift, classic, irregular and direct Glitter, and an earlier-study Glossy: every action has a target. */
function mixedRecipe(): Recipe {
  const optics = opticsRecipe("p"), glitter = glitterRecipe("g");
  const earlier = { ...optics.layers[3], finish: "glossy" as const };
  return parseRecipe({ ...optics, layers: [...optics.layers.slice(0, 3), earlier, glitter.layers[1], glitter.layers[2]] });
}

/** A composition whose eye-makeup module counts its apply and gesture calls. */
function counted(overrides: Record<string, Partial<ActionSpec>> = {}) {
  const calls = { apply: 0, gestures: 0 };
  const actions = Object.fromEntries(Object.entries(EYE_MAKEUP.actions).map(([kind, spec]) => [kind, { ...spec, ...overrides[kind],
    apply: (state: never, action: never) => { calls.apply++; return (spec as Spec).apply(state, action); } }]));
  const module = { ...EYE_MAKEUP, actions, gestures: { apply: (part: never, edit: never) => { calls.gestures++; return EYE_MAKEUP.gestures!.apply(part, edit); } } };
  const registry = new Registry(STUDIO_OWNERS.map(owner => owner.id === EYE_MAKEUP.id ? module : owner) as never);
  const composition: StudioComposition = { registry, documents: STUDIO_COMPOSITION.documents, region: STUDIO_COMPOSITION.region };
  let ids = 0;
  const core = createTrustedAuthoringCore(freshWorkspace(mixedRecipe()), { resetStack: () => {}, selectedCollection: () => "draft",
    newId: () => `host-${++ids}` }, composition);
  return { core, calls };
}

test("dispatch, form controls and gesture frames all run the registered apply and gestures (CORE-31)", () => {
  const { core, calls } = counted();
  const layer = core.document.recipe.layers[0];
  expect(core.app.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: 0.3 }).ok).toBe(true);
  expect(calls.apply).toBe(1);
  expect(core.app.controlBegin("opacity", layer.id)).toBe(true);
  expect(core.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.4 })).toEqual({ ok: true, result: true });
  expect(core.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.5 })).toEqual({ ok: true, result: true });
  core.app.controlCommit("opacity");
  expect(calls.apply).toBe(3);
  // One Undo entry for the dispatch, one for the whole control transaction.
  expect(core.document.undoDepth).toBe(2);
  expect(core.app.beginGesture("uv", layer.id)).toBe(true);
  const live = core.document.recipe.layers[0];
  expect(core.app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: live.points[0].u + 0.004 } })).toBe(true);
  core.app.endGesture("uv");
  expect(calls.gestures).toBe(1);
  expect(core.document.undoDepth).toBe(3);
  // Stack edits too: the former AuthoringLayerActions path is gone.
  expect(core.app.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(calls.apply).toBe(4);
  expect(core.document.recipe.layers.at(-1)!.id).toBe("host-1");
});

test("Undo is recorded by the action's Undo policy, not by its effect (CORE-32)", () => {
  // A content action registered with Undo policy `none` records nothing; the effect-based rule would have.
  const setColor = EYE_MAKEUP.actions["layer.setColor"];
  const { core } = counted({ "layer.setColor": { descriptor: { ...setColor.descriptor, undo: "none" } } });
  const layer = core.document.recipe.layers[0];
  expect(core.app.dispatch({ kind: "layer.setColor", layerId: layer.id, color: "#123456" }).ok).toBe(true);
  expect(core.document.recipe.layers[0].color).toBe("#123456");
  expect(core.document.undoDepth).toBe(0);
  expect(core.app.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: 0.2 }).ok).toBe(true);
  expect(core.document.undoDepth).toBe(1);
  // Selections have policy none and record nothing.
  expect(core.app.dispatch({ kind: "layer.select", layerId: core.document.recipe.layers[2].id }).ok).toBe(true);
  expect(core.document.undoDepth).toBe(1);
});

test("context-menu input options report the Undo policy of the variant they edit (CORE-32)", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(mixedRecipe()), { resetStack: () => {}, selectedCollection: () => "draft" },
    STUDIO_COMPOSITION);
  const layer = core.document.recipe.layers[0];
  let checked = 0;
  for (const hit of [{ kind: "point" as const, layerId: layer.id, index: 0 }, { kind: "shape" as const, layerId: layer.id },
    { kind: "field" as const, layerId: layer.id, fieldId: layer.fields[0].id }]) {
    for (const option of core.app.contextQuery(hit as never).options) {
      const kind = "action" in option ? option.action.kind : option.actionKind;
      const variant = "action" in option ? undefined : option.variant;
      const expected = "action" in option ? STUDIO_REGISTRY.undoPolicy(option.action)
        : undoPolicyOf(STUDIO_REGISTRY.descriptor(kind)!, { kind, command: { kind: variant } } as { kind: string });
      expect({ kind, variant, undo: option.undo }).toEqual({ kind, variant, undo: expected });
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(5);
});

test("apply is pure and deterministic for all 29 eye-makeup kinds once the host supplies new IDs (CORE-33)", () => {
  const part = mixedRecipe();
  const [gloss, shift, glit, earlier, irr, dir] = part.layers.map(layer => layer.id);
  const field = part.layers[0].fields[0].id;
  const actions: EyeMakeupAction[] = [
    { kind: "layer.select", layerId: glit }, { kind: "point.select", layerId: gloss, index: 1 }, { kind: "point.remove", layerId: gloss, index: 1 },
    { kind: "path.edit", layerId: gloss, command: { kind: "enable-bezier" } },
    { kind: "field.select", layerId: gloss, fieldId: field }, { kind: "field.add", layerId: gloss },
    { kind: "field.remove", layerId: gloss, fieldId: field }, { kind: "field.clear", layerId: gloss, fieldId: field },
    { kind: "field.setReach", layerId: gloss, fieldId: field, radius: 0.04 },
    { kind: "pigment.edit", layerId: gloss, command: { kind: "point-strength", index: 0, value: 0.5 } },
    { kind: "softness.edit", layerId: gloss, command: { kind: "uniform-softness", value: 0.01 } },
    { kind: "layer.setColor", layerId: gloss, color: "#123456" }, { kind: "layer.setOpacity", layerId: gloss, opacity: 0.3 },
    { kind: "layer.setSymmetry", layerId: gloss, symmetry: false }, { kind: "layer.setFinish", layerId: shift, finish: "glitter" },
    { kind: "layer.useGameOptics", layerId: earlier }, { kind: "layer.setShift", layerId: shift, key: "strength", value: 0.2 },
    { kind: "glitter.selectModel", layerId: glit, model: "direct" }, { kind: "glitter.setClassic", layerId: glit, key: "density", value: 0.3 },
    { kind: "glitter.setIrregular", layerId: irr, key: "count", value: 150000 },
    { kind: "glitter.setDirect", layerId: dir, key: "density", value: 0.5 },
    { kind: "point.move", layerId: gloss, index: 0, u: 0.4, v: 0.3 }, { kind: "point.insert", layerId: gloss, u: 0.4, v: 0.25 },
    { kind: "point.setTangent", layerId: gloss, index: 0, side: "in", du: 0.001, dv: 0 },
    { kind: "shape.transform", layerId: gloss, command: { kind: "rotate", radians: 0.1 } },
    { kind: "field.setOrigin", layerId: gloss, fieldId: field, u: 0.37, v: 0.23 },
    { kind: "field.setVector", layerId: gloss, fieldId: field, du: 0.001, dv: 0 },
    { kind: "layer.edit", command: { kind: "add" } }, { kind: "layer.edit", command: { kind: "duplicate", id: gloss } },
    { kind: "layer.setEnabled", id: gloss, enabled: false },
  ];
  const kinds = new Set<string>();
  for (const action of actions) {
    const spec = STUDIO_REGISTRY.route(action.kind) as unknown as { ok: true; spec: Spec };
    const state: EyeMakeupState = deepFreeze({ part: structuredClone(part), editor: { active: 0, selected: 0, fieldSelection: {}, choices: {} } });
    const before = JSON.stringify(state);
    let n = 0;
    const concrete = spec.spec.assignIds?.(action, () => `new-${++n}`) ?? action;
    const capability = spec.spec.capability(state, concrete);
    expect({ kind: action.kind, capability }).toEqual({ kind: action.kind, capability: { available: true } });
    const first = spec.spec.apply(state, concrete), second = spec.spec.apply(state, concrete);
    // Pure (the frozen state is untouched) and deterministic (the same result twice, IDs included).
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    kinds.add(action.kind);
  }
  expect([...kinds].sort()).toEqual([...STUDIO_REGISTRY.kinds(EYE_MAKEUP.id)].sort());
  expect(kinds.size).toBe(29);
  // Without its host-supplied ID an action that creates an item is refused by apply, never given a random one.
  const state: EyeMakeupState = { part, editor: { active: 0, selected: 0, fieldSelection: {}, choices: {} } };
  expect(() => (EYE_MAKEUP.actions["field.add"] as unknown as Spec).apply(state, { kind: "field.add", layerId: gloss })).toThrow("needs the new item's ID");
  expect(assignEyeMakeupIds({ kind: "field.add", layerId: gloss, fieldId: "kept" }, () => "other")).toEqual(
    { kind: "field.add", layerId: gloss, fieldId: "kept" });
});
