/**
 * The collection's package-plan actions (feature-module platform §6): `package.rename`, `package.assign`,
 * `package.split` and `package.merge`, through the application with eye makeup alone, and through the collection
 * actions with a synthetic second exporting feature; the plan's persistence (only a non-default plan is stored, in
 * either collection schema, readable by 0.1.0-alpha.1) and its dirty state.
 */
import { expect, test } from "bun:test";
import { CollectionActions } from "../src/collection-actions";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import type { EditorSnapshot } from "../src/collection-session";
import { collectionDraft, type DocumentModel } from "../src/collection-workspace";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import { PartRegistry } from "../src/platform/core/document";
import { COLLECTION_1, COLLECTION_2, PACKAGE_PLAN_1, type LookCollection } from "../src/platform/api";
import { recipeFile, readRecipe } from "../src/recipe-schema";
import { initialRecipe } from "./fixtures/eye-region";
import { HAIR } from "./fixtures/hair-feature";
import { alphaParseCollection } from "./fixtures/alpha-0.1.0/collection-list";
import { emptyMemory } from "../src/collection-workspace";

const ID = "0ec3546e-3fac-43e7-8c19-a65d20383d41";
const NEW = "11111111-2222-4333-8444-555555555555";
const recipe = () => readRecipe(initialRecipe());
const collection = () => ({ schema: COLLECTION_1, id: ID, name: "Looks",
  presets: [{ id: "f25f8eb1-8a83-4f65-a111-b83086382c18", name: "One", revision: 1, recipe: recipeFile(recipe())! }] });

function service(value: unknown = collection(), model: DocumentModel = STUDIO_DOCUMENTS) {
  let editor: EditorSnapshot = { recipe: recipe(), ...emptyMemory() };
  let saved: LookCollection | undefined;
  const transport: CollectionTransport = { list: async () => [{ id: ID, name: "Looks", count: 1, revision: 1, updatedAt: "now" }],
    get: async () => ({ collection: model.parts.readCollection(value, true), revision: 1, updatedAt: "now" }),
    save: async (next, revision) => { saved = structuredClone(next); return { collection: next, revision: (revision ?? 0) + 1, updatedAt: "now" }; },
    package: async () => { throw Error("unused"); } };
  const svc = new CollectionService(model, collectionDraft(value, model, 1), { selected: "", name: "" }, () => editor, next => editor = next, transport,
    () => ({ recipe: editor.recipe, revision: 0 }));
  return { svc, saved: () => saved };
}

test("with eye makeup alone there is one mod, named XF Eye Artistry; it can be renamed and named back, never split", async () => {
  const f = service();
  await f.svc.execute({ kind: "initialize" });
  expect(f.svc.summary().draft!.products).toEqual([{ id: ID, isDefault: true, modName: "XF Eye Artistry", nameSource: "derived",
    features: [{ id: "eye-makeup", label: "Eye makeup" }] }]);
  // Splitting needs a second feature; the refusal says so plainly.
  expect(f.svc.actionCapability({ kind: "package.split", feature: "eye-makeup" }))
    .toMatchObject({ available: false, code: "unavailable", reason: "Eye makeup is already a mod of its own." });
  expect(f.svc.actionCapability({ kind: "package.rename", productId: ID, modName: "a/b" })).toMatchObject({ available: false, code: "invalid_value" });
  expect(f.svc.persistence()?.dirty).toBe(false);
  f.svc.dispatch({ kind: "package.rename", productId: ID, modName: "My looks" });
  expect(f.svc.summary().draft!.products[0]).toMatchObject({ modName: "My looks", nameSource: "plan" });
  // A mod name is part of the collection: the draft now has unsaved changes.
  expect(f.svc.persistence()).toMatchObject({ dirty: true, structureDirty: true, dirtyPresets: [] });
  expect(f.svc.snapshot()!.collection.packagePlan).toEqual({ schema: PACKAGE_PLAN_1, products: [{ id: ID, name: "My looks", features: [] }] });
  // Saved as collection-1 with the plan beside it, which the released 0.1.0-alpha.1 reads (and ignores).
  expect((await f.svc.execute({ kind: "save" })).ok).toBe(true);
  const stored = STUDIO_PARTS.writeMinimal(f.saved()!);
  expect(stored.schema).toBe(COLLECTION_1);
  expect(stored.packagePlan).toEqual({ schema: PACKAGE_PLAN_1, products: [{ id: ID, name: "My looks", features: [] }] });
  expect(alphaParseCollection(JSON.parse(JSON.stringify(stored)), false, value => value as never).presets).toHaveLength(1);
  expect(STUDIO_PARTS.readCollection(JSON.parse(JSON.stringify(stored))).packagePlan).toEqual(stored.packagePlan);
  // An empty name goes back to the default: the plan disappears again.
  f.svc.dispatch({ kind: "package.rename", productId: ID, modName: "" });
  expect(f.svc.snapshot()!.collection.packagePlan).toBeUndefined();
  expect(f.svc.summary().draft!.products[0]).toMatchObject({ modName: "XF Eye Artistry", nameSource: "derived" });
});

test("a collection without a plan stores exactly what it stored before", () => {
  const read = STUDIO_PARTS.readCollection(collection());
  expect(read).not.toHaveProperty("packagePlan");
  expect(JSON.stringify(STUDIO_PARTS.writeMinimal(read))).not.toContain("packagePlan");
  // A default-only plan is dropped on read, so it never makes a collection look different.
  const defaulted = STUDIO_PARTS.readCollection({ ...collection(), packagePlan: { schema: PACKAGE_PLAN_1, products: [{ id: ID, features: [] }] } });
  expect(defaulted).not.toHaveProperty("packagePlan");
  expect(() => STUDIO_PARTS.readCollection({ ...collection(), packagePlan: { schema: PACKAGE_PLAN_1, products: [{ id: "x", features: [] }] } }))
    .toThrow("damaged");
});

test("with two exporting features: split into its own mod, rename, assign back and merge, as collection actions", () => {
  const hair = { ...HAIR, exports: { exporterId: "hair/stub", brand: "XF Hair Artistry", selectorLabel: "XF Hair", selector: "vanilla" as const } };
  const model: DocumentModel = { parts: new PartRegistry([EYE_MAKEUP, hair]), live: STUDIO_DOCUMENTS.live };
  const value = { schema: COLLECTION_2, id: ID, name: "Looks", presets: [{ id: "f25f8eb1-8a83-4f65-a111-b83086382c18", name: "One", revision: 1,
    parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-1", body: recipeFile(recipe())! }, hair: { schema: "xfs/hair-part-1", body: { colour: "#112233", strands: [1] } } } }] };
  let editor: EditorSnapshot = { recipe: recipe(), ...emptyMemory() };
  const ids = [NEW];
  const actions = new CollectionActions(model, collectionDraft(value, model), () => editor, next => { editor = next; }, () => ids.shift()!);
  const products = () => actions.summary().products.map(p => [p.modName, p.features.map(f => f.id)]);
  expect(products()).toEqual([["XF Looks", ["eye-makeup", "hair"]]]);
  actions.dispatch({ kind: "package.split", feature: "hair" });
  expect(products()).toEqual([["XF Eye Artistry", ["eye-makeup"]], ["XF Hair Artistry", ["hair"]]]);
  expect(actions.summary().products[1].id).toBe(NEW);
  actions.dispatch({ kind: "package.rename", productId: NEW, modName: "XF Hair Only" });
  expect(products()).toEqual([["XF Eye Artistry", ["eye-makeup"]], ["XF Hair Only", ["hair"]]]);
  expect(actions.check({ kind: "package.assign", feature: "hair", productId: NEW }))
    .toMatchObject({ available: false, reason: "Hair is already in that mod." });
  actions.dispatch({ kind: "package.assign", feature: "eye-makeup", productId: NEW });
  expect(products()).toEqual([["XF Hair Only", ["eye-makeup", "hair"]]]);
  actions.dispatch({ kind: "package.merge", productId: NEW, intoId: ID });
  expect(products()).toEqual([["XF Looks", ["eye-makeup", "hair"]]]);
  expect(actions.view().collection.packagePlan).toBeUndefined();
  // A collection-2 draft writes its plan beside its looks.
  actions.dispatch({ kind: "package.split", feature: "hair", newId: "22222222-2222-4333-8444-555555555555" });
  expect(model.parts.writeMinimal(actions.view().collection as LookCollection)).toMatchObject({ schema: COLLECTION_2,
    packagePlan: { schema: PACKAGE_PLAN_1, products: [{ id: "22222222-2222-4333-8444-555555555555", features: ["hair"] }] } });
});
