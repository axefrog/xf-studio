import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STUDIO_OWNERS, STUDIO_REGISTRY, STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import { IDLE_UNAVAILABLE, MotionActions } from "../src/motion-actions";
import { actionTable, familyId, featureId, type SystemFamily } from "../src/platform/api";
import { Registry } from "../src/platform/core/registry";
import { RECIPE_ACTION_KINDS } from "../src/engines/layered-makeup/recipe-actions";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { StudioApplication } from "../src/studio-application";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "./fixtures/eye-region";

function fixture() {
  const workspace = freshWorkspace();
  return createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
}

test("the registry reproduces the pre-platform catalogue exactly (golden snapshot)", () => {
  // Captured from the application before migration step 1; any ID, order, scope or policy churn fails here.
  const golden = JSON.parse(readFileSync(new URL("./golden/studio-registry.json", import.meta.url), "utf8"));
  const { app } = fixture();
  expect({ actionKinds: app.actionKinds(), actionDescriptors: app.actionDescriptors(), registry: app.registry() })
    .toEqual(golden);
  expect(JSON.stringify(app.actionDescriptors())).toBe(JSON.stringify(ACTION_DESCRIPTORS));
});

test("every action is owned by exactly one registered owner", () => {
  // Synchronous owners hold the action table; the async families (library requests, file workflows) route beside it.
  const owned = STUDIO_OWNERS.filter(owner => !("async" in owner)).flatMap(owner => Object.keys(owner.actions));
  const all = STUDIO_OWNERS.flatMap(owner => Object.keys(owner.actions));
  expect(new Set(all).size).toBe(all.length);
  expect(owned).toEqual(Object.keys(ACTION_DESCRIPTORS));
  for (const kind of owned) {
    const route = STUDIO_REGISTRY.route(kind);
    expect(route.ok).toBe(true);
    if (route.ok) expect(route.qualified).toBe(`${route.owner.id}/${kind}`);
  }
  expect(STUDIO_REGISTRY.route("layer.setColor")).toMatchObject({ ok: true, qualified: "eye-makeup/layer.setColor" });
  expect(STUDIO_REGISTRY.route("history.undo")).toMatchObject({ ok: true, qualified: "history/history.undo" });
  expect(STUDIO_REGISTRY.route("hair.setColor")).toEqual({ ok: false, code: "unknown_action", kind: "hair.setColor" });
  expect(EYE_MAKEUP).toMatchObject({ owner: "feature", id: "eye-makeup", api: 1, stage: "stable" });
  expect(STUDIO_REGISTRY.entries().filter(entry => entry.ownerKind === "feature").map(entry => entry.owner))
    .toEqual(Object.keys(EYE_MAKEUP.actions).map(() => "eye-makeup"));
});

test("derived kind sets equal the sets StudioApplication used to keep by hand", () => {
  const kinds = (owner: string) => [...STUDIO_REGISTRY.kinds(owner)].sort();
  const all = Object.keys(ACTION_DESCRIPTORS);
  // Before step 1: `recipeKinds = RECIPE_ACTION_KINDS` plus the two literal layer kinds.
  expect(kinds("eye-makeup")).toEqual([...RECIPE_ACTION_KINDS, "layer.edit", "layer.setEnabled"].sort());
  // Before step 1: `COLLECTION_KIND_TABLE`.
  expect(kinds("collection")).toEqual(["collection.importRecipe", "collection.open", "collection.rename",
    "collection.undoOpen", "package.assign", "package.merge", "package.rename", "package.split", "preset.edit", "preset.select"]);
  // Before step 1: literal comparisons and `startsWith` prefixes, with saved-V as the final fallback.
  expect(kinds("history")).toEqual(["history.jumpTo", "history.redo", "history.undo"]);
  expect(kinds("preview")).toEqual(all.filter(kind => kind.startsWith("preview.") || kind.startsWith("camera.")).sort());
  expect(kinds("motion")).toEqual(all.filter(kind => kind.startsWith("motion.")).sort());
  expect(kinds("quality")).toEqual(all.filter(kind => kind.startsWith("quality.")).sort());
  expect(kinds("savedV")).toEqual(["savedV.clear", "savedV.load", "savedV.restore"]);
  // Before step 1: the selection set, from descriptor effect over the recipe kinds.
  expect(STUDIO_REGISTRY.kinds("eye-makeup").filter(kind => STUDIO_REGISTRY.descriptor(kind)?.effect === "selection").sort())
    .toEqual(["field.select", "layer.select", "point.select"]);
  // Scene gating and thrown-error codes replace the old prefix checks.
  expect(STUDIO_OWNERS.filter(owner => owner.owner === "system" && owner.needsScene).map(owner => owner.id as string))
    .toEqual(["preview", "motion", "savedV"]);
  // Every creator choice for the shown V has one owner, the character context (CORE-58); it needs no scene, so a change before the
  // preview is ready is refused as not ready (CORE-64).
  expect(kinds("characterContext")).toEqual(["character.clearPreparedFiles", "character.hideOwnMakeup", "character.keepChanges", "character.loadPreset", "character.loadSave", "character.redo",
    "character.redoClothing", "character.reset", "character.resetAll", "character.retry", "character.setClothing", "character.setClothingArea", "character.setOption",
    "character.setOptions", "character.undo", "character.undoClothing", "character.useDefault"]);
  expect(STUDIO_OWNERS.filter(owner => owner.owner === "system" && owner.thrown === "unavailable").map(owner => owner.id as string))
    .toEqual(["preview", "motion", "quality"]);
});

test("the registry refuses duplicate owners and doubly owned kinds", () => {
  const family = (id: string, kinds: Record<string, true>): SystemFamily => ({ owner: "system", id: familyId(id), label: id,
    actions: actionTable<{ kind: string }, string>(ACTION_DESCRIPTORS as never, kinds) });
  expect(() => new Registry([family("a", { "camera.front": true }), family("a", { "quality.set": true })])).toThrow("registered twice");
  expect(() => new Registry([family("a", { "camera.front": true }), family("b", { "camera.front": true })])).toThrow("owned by both");
  expect(() => featureId("Eye Makeup")).toThrow();
  expect(() => familyId("history/undo")).toThrow();
});

test("routing is exhaustive: every owner needs a handler and unknown kinds are refused, never routed to a fallback", () => {
  const core = fixture();
  const services = (core.app as unknown as { services: ConstructorParameters<typeof StudioApplication>[0] }).services;
  const extra: SystemFamily = { owner: "system", id: familyId("extra"), label: "Extra",
    actions: actionTable<{ kind: string }, string>({ "extra.do": ACTION_DESCRIPTORS["camera.front"] } as never, { "extra.do": true }) };
  expect(() => new StudioApplication(services, new Registry([...STUDIO_OWNERS, extra]))).toThrow("do not match");
  expect(() => new StudioApplication(services, new Registry(STUDIO_OWNERS.slice(1)))).toThrow("do not match");
  // Before step 1 an unknown kind fell through to the saved-V service (or threw reading its descriptor).
  const unknown = { kind: "hair.setColor" } as never;
  expect(core.app.capability(unknown)).toEqual({ available: false, code: "invalid_value", reason: "Unknown command." });
  expect(core.app.dispatch(unknown)).toEqual({ ok: false, code: "invalid_value", message: "Unknown command." });
  expect(core.app.contextCapability({ kind: "viewport" }, unknown)).toMatchObject({ available: false, code: "invalid_value" });
});

test("reason codes are structured where refusals are decided, not read from message text (CORE-15)", () => {
  const source = readFileSync(new URL("../src/studio-application.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/reason(?:\?)?\.includes\(|function reasonCode|startsWith\("(?:preview|camera|motion|quality|savedV)\./);
  // A device error whose text never says "unavailable" is still an unavailable asset.
  const { app } = fixture();
  const motion = new MotionActions(freshWorkspace().preview, { available: false, error: "Idle clip failed to decode.", blink: { available: false },
    setIdle() {}, setIdlePaused() {}, setIdleContributions() {}, setBlink() {}, animateBlink() {} });
  app.attach({ motion });
  // The rig's own error goes to the diagnostics log; the refusal is plain (UI-88).
  expect(app.capability({ kind: "motion.setIdle", enabled: true }))
    .toEqual({ available: false, code: "asset_unavailable", reason: IDLE_UNAVAILABLE });
});

test("every exporting feature has an exporter and an independent verifier in the host composition, and nothing else does (§7 rule 7)", async () => {
  const { STUDIO_OWNERS } = await import("../src/compose/studio-registry");
  const { STUDIO_EXPORTERS } = await import("../src/compose/exporters");
  const exporting = STUDIO_OWNERS.filter(owner => owner.owner === "feature" && owner.exports)
    .map(owner => owner as { id: string; label: string; exports: import("../src/platform/api").ExportInfo });
  expect(exporting.map(feature => feature.id)).toEqual(["eye-makeup"]);
  expect(STUDIO_EXPORTERS.map(entry => entry.exporter.feature)).toEqual(exporting.map(feature => feature.id));
  for (const feature of exporting) {
    const entry = STUDIO_EXPORTERS.find(item => item.exporter.feature === feature.id)!;
    expect(entry.exporter.id).toBe(feature.exports.exporterId);
    expect(entry.verifier.exporterId).toBe(feature.exports.exporterId);
    expect(entry.exporter.info).toEqual(feature.exports);
    expect(entry.exporter.label).toBe(feature.label);
  }
});
