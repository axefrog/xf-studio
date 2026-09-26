import { expect, test } from "bun:test";
import { archiveXlText, MERGED_MOD_NAME, mergeXlFragments, modNameIssue, PACKAGE_PLAN_1, PackagePlanConflict, parsePackagePlan,
  readPackagePlan, type ModPackagePlan } from "../src/platform/api";
import { collectionProducts, copyPackagePlan, editPackagePlan, normalizePackagePlan, packagePlanEditIssue, planProducts, productArchive,
  } from "../src/platform/core/package-plan";

const COLLECTION = "0ec3546e-3fac-43e7-8c19-a65d20383d41";
const OTHER = "11111111-2222-4333-8444-555555555555";
const EYES = { id: "eye-makeup", label: "Eye makeup", brand: "XF Eye Artistry" };
const LIPS = { id: "lips", label: "Lip makeup", brand: "XF Lip Artistry" };
const plan = (products: ModPackagePlan["products"]): ModPackagePlan => ({ schema: PACKAGE_PLAN_1, products });

test("the default: one product holding every exportable feature, named after its brand, with the collection's archive name", () => {
  expect(planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES] })).toEqual([
    { id: COLLECTION, isDefault: true, archive: `xfs_c${COLLECTION.replaceAll("-", "")}`, modName: "XF Eye Artistry", nameSource: "derived",
      features: ["eye-makeup"] }]);
  // Several features merge into one "XF Looks" mod by default.
  expect(planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES, LIPS] }).map(p => [p.modName, p.features]))
    .toEqual([[MERGED_MOD_NAME, ["eye-makeup", "lips"]]]);
  // No exportable feature, no product.
  expect(planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [] })).toEqual([]);
  // The default product's archive is byte-for-byte the name every eye-makeup build had; others are ID-based too.
  expect(productArchive(COLLECTION, COLLECTION)).toBe("xfs_c0ec3546e3fac43e78c19a65d20383d41");
  expect(productArchive(COLLECTION, OTHER)).toBe("xfs_m11111111222243338444555555555555");
});

test("splitting a feature into its own mod; names follow features until the person names a mod", () => {
  const split = planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES, LIPS],
    plan: plan([{ id: OTHER, features: ["lips"] }]) });
  expect(split.map(p => [p.id, p.archive, p.modName, p.features])).toEqual([
    [COLLECTION, `xfs_c${COLLECTION.replaceAll("-", "")}`, "XF Eye Artistry", ["eye-makeup"]],
    [OTHER, `xfs_m${OTHER.replaceAll("-", "")}`, "XF Lip Artistry", ["lips"]]]);
  const named = planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES, LIPS],
    plan: plan([{ id: COLLECTION, name: "My looks", features: [] }]) });
  expect(named[0]).toMatchObject({ modName: "My looks", nameSource: "plan", features: ["eye-makeup", "lips"] });
  // A product whose features no look holds right now is left out; its choice stays in the plan.
  expect(planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES], plan: plan([{ id: OTHER, features: ["lips"] }]) })
    .map(p => p.id)).toEqual([COLLECTION]);
});

test("two mods of one collection never share a folder name", () => {
  const products = planProducts({ collectionId: COLLECTION, collectionName: "Party", features: [EYES, LIPS],
    plan: plan([{ id: COLLECTION, name: "XF Night", features: [] }, { id: OTHER, name: "XF Night", features: ["lips"] }]) });
  expect(products.map(p => p.modName)).toEqual(["XF Night", "XF Night (Party)"]);
});

test("the clash suffix is a valid mod name: a collection name a folder can't hold falls back to a number (PIPE-91)", () => {
  const clash = plan([{ id: COLLECTION, name: "XF Night", features: [] }, { id: OTHER, name: "XF Night", features: ["lips"] }]);
  const names = (collectionName: string, current = clash) =>
    planProducts({ collectionId: COLLECTION, collectionName, features: [EYES, LIPS], plan: current }).map(p => p.modName);
  // A collection called "Party: 2/3?" would have made "XF Night (Party: 2/3?)", which no mod manager can use as a folder.
  expect(names("Party: 2/3?")).toEqual(["XF Night", "XF Night 2"]);
  expect(names("x".repeat(90))).toEqual(["XF Night", "XF Night 2"]);
  // A long name keeps within the limit when numbered.
  const long = "L".repeat(80);
  const numbered = names("Party: /", plan([{ id: COLLECTION, name: long, features: [] }, { id: OTHER, name: long, features: ["lips"] }]));
  expect(numbered[1]).toBe(`${"L".repeat(78)} 2`);
  for (const name of [...names("Party: 2/3?"), ...numbered]) expect(modNameIssue(name)).toBeUndefined();
});

test("renaming a mod to another mod's name is refused, not silently suffixed (PIPE-91)", () => {
  const products = planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES, LIPS],
    plan: plan([{ id: OTHER, features: ["lips"] }]) });
  expect(packagePlanEditIssue({ kind: "rename", productId: OTHER, name: " xf eye artistry " }, products, COLLECTION))
    .toBe("Another mod of this collection is already called “XF Eye Artistry”. Choose a different name.");
  // Its own current name, and any other name, are fine.
  expect(packagePlanEditIssue({ kind: "rename", productId: OTHER, name: "XF Lip Artistry" }, products, COLLECTION)).toBeUndefined();
  expect(packagePlanEditIssue({ kind: "rename", productId: OTHER, name: "XF Lips" }, products, COLLECTION)).toBeUndefined();
});

test("a feature in two mods is refused: its namespace may be present in only one XF mod", () => {
  const twice = plan([{ id: OTHER, features: ["lips"] }, { id: "22222222-2222-4333-8444-555555555555", features: ["lips"] }]);
  expect(() => planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES, LIPS], plan: twice }))
    .toThrow(PackagePlanConflict);
  const error = (() => { try { parsePackagePlan(twice); } catch (e) { return e as PackagePlanConflict; } })();
  expect(error).toBeInstanceOf(PackagePlanConflict);
  expect(error!.code).toBe("namespace_duplicated");
  expect(error!.message).toContain("can go into only one mod");
  // The person sees the feature's label, never its key (PIPE-93).
  const labelled = (() => { try { planProducts({ collectionId: COLLECTION, collectionName: "Looks", features: [EYES, LIPS], plan: twice }); }
    catch (e) { return e as PackagePlanConflict; } })();
  expect(labelled!.message).toStartWith("Lip makeup is in two mods.");
  expect(labelled!.message).not.toContain("lips");
});

test("a plan this build can't use is newer (a later schema, or fields it doesn't know) or damaged, never an exception (CORE-91)", () => {
  expect(readPackagePlan(plan([{ id: OTHER, features: ["lips"] }]))).toEqual({ plan: plan([{ id: OTHER, features: ["lips"] }]) });
  expect(readPackagePlan({ schema: "xfs/package-plan-2", products: [] })).toEqual({ issue: "newer" });
  // The planned per-feature selector labels are a newer build's field: kept whole rather than dropped.
  expect(readPackagePlan({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: ["lips"], selectorLabels: { lips: "Lips" } }] }))
    .toEqual({ issue: "newer" });
  expect(readPackagePlan({ schema: PACKAGE_PLAN_1, products: [], owner: "x" })).toEqual({ issue: "newer" });
  for (const damaged of [null, "plan", [], { schema: PACKAGE_PLAN_1, products: [{ id: "nope", features: [] }] }, { schema: "other" },
    plan([{ id: OTHER, features: ["lips"] }, { id: "22222222-2222-4333-8444-555555555555", features: ["lips"] }])])
    expect(readPackagePlan(damaged)).toEqual({ issue: "damaged" });
});

test("stored plans are validated and kept canonical: only what differs from the default", () => {
  expect(() => parsePackagePlan({ schema: PACKAGE_PLAN_1, products: [{ id: "nope", features: [] }] })).toThrow("damaged");
  expect(() => parsePackagePlan({ schema: "xfs/package-plan-9", products: [] })).toThrow("damaged");
  expect(() => parsePackagePlan(plan([{ id: OTHER, name: " padded", features: [] }]))).toThrow("damaged");
  expect(normalizePackagePlan(plan([{ id: COLLECTION, features: ["eye-makeup"] }, { id: OTHER, features: [] }]), COLLECTION)).toBeUndefined();
  expect(normalizePackagePlan(plan([{ id: COLLECTION, name: "Mine", features: ["eye-makeup"] }]), COLLECTION))
    .toEqual(plan([{ id: COLLECTION, name: "Mine", features: [] }]));
  // Mod names are folder names: the "XF " prefix is a default, never a rule.
  expect(modNameIssue("My looks")).toBeUndefined();
  expect(modNameIssue(" ")).toBe("Give the mod a name.");
  expect(modNameIssue("a/b")).toContain("can't contain");
  expect(modNameIssue("CON")).toContain("reserves");
});

test("plan edits: rename, split, assign and merge, each back to the default when nothing differs", () => {
  const features = [EYES, LIPS];
  const products = (current?: ModPackagePlan) => planProducts({ collectionId: COLLECTION, collectionName: "Looks", features, plan: current });
  let current: ModPackagePlan | undefined;
  expect(packagePlanEditIssue({ kind: "split", feature: "lips", newId: OTHER }, products(current), COLLECTION)).toBeUndefined();
  current = editPackagePlan(current, { kind: "split", feature: "lips", newId: OTHER }, products(current), COLLECTION);
  expect(current).toEqual(plan([{ id: OTHER, features: ["lips"] }]));
  expect(packagePlanEditIssue({ kind: "split", feature: "lips", newId: "33333333-2222-4333-8444-555555555555" }, products(current), COLLECTION,
    { lips: "Lip makeup" })).toBe("Lip makeup is already a mod of its own.");
  current = editPackagePlan(current, { kind: "rename", productId: OTHER, name: "XF Lips Only" }, products(current), COLLECTION);
  expect(products(current).map(p => p.modName)).toEqual(["XF Eye Artistry", "XF Lips Only"]);
  current = editPackagePlan(current, { kind: "assign", feature: "eye-makeup", productId: OTHER }, products(current), COLLECTION);
  expect(products(current).map(p => [p.id, p.features])).toEqual([[OTHER, ["eye-makeup", "lips"]]]);
  current = editPackagePlan(current, { kind: "merge", productId: OTHER, intoId: COLLECTION }, products(current), COLLECTION);
  expect(current).toBeUndefined();
  expect(packagePlanEditIssue({ kind: "rename", productId: COLLECTION, name: "" }, products(current), COLLECTION)).toBe("Give the mod a name.");
  expect(packagePlanEditIssue({ kind: "assign", feature: "hair", productId: COLLECTION }, products(current), COLLECTION))
    .toBe("This collection has no hair to package.");
  current = editPackagePlan(current, { kind: "rename", productId: COLLECTION, name: "Mine" }, products(current), COLLECTION);
  expect(editPackagePlan(current, { kind: "rename", productId: COLLECTION, name: null }, products(current), COLLECTION)).toBeUndefined();
});

test("a saved copy's mods are all the copy's own: its default mod and every split-off mod get new IDs (PIPE-89)", () => {
  const copy = "44444444-2222-4333-8444-555555555555", fresh = "55555555-2222-4333-8444-555555555555";
  const ids = [OTHER, fresh];
  // A fresh ID that collides with one already in use is drawn again.
  expect(copyPackagePlan(plan([{ id: COLLECTION, name: "Mine", features: [] }, { id: OTHER, name: "Lips", features: ["lips"] }]), COLLECTION, copy,
    () => ids.shift()!)).toEqual(plan([{ id: copy, name: "Mine", features: [] }, { id: fresh, name: "Lips", features: ["lips"] }]));
  // So the copy's split-off mod has its own archive, and never hides the original's in the mod manager.
  expect(productArchive(copy, fresh)).not.toBe(productArchive(COLLECTION, OTHER));
  expect(copyPackagePlan(undefined, COLLECTION, copy, () => fresh)).toBeUndefined();
  // A plan this build can't read is kept as it came.
  const kept = { kept: { schema: "xfs/package-plan-2" }, issue: "newer" as const };
  expect(copyPackagePlan(kept, COLLECTION, copy, () => fresh)).toEqual(kept);
});

test("an in-memory collection's products come from the exporting features its looks hold", () => {
  const collection = { id: COLLECTION, name: "Looks", presets: [{ parts: { "eye-makeup": {} } }, { parts: { hair: {} } }] };
  expect(collectionProducts(collection, [EYES, LIPS]).map(p => p.features)).toEqual([["eye-makeup"]]);
});

test("ArchiveXL fragments merge in product order and write the exact declaration text", () => {
  const eyes = { customizations: { female: ["axefrog/a/xfs_collection.inkcharcustomization"] }, scope: { "player_customization.app": ["axefrog/a/xfs_collection.app"] } };
  // One feature: exactly the text every eye-makeup candidate has had (CRLF, scalar female entry, list scope).
  expect(archiveXlText(mergeXlFragments([eyes]))).toBe("customizations:\r\n  female: axefrog\\a\\xfs_collection.inkcharcustomization\r\n" +
    "resource:\r\n  scope:\r\n    player_customization.app:\r\n      - axefrog\\a\\xfs_collection.app\r\n");
  const lips = { customizations: { female: ["axefrog/b/lips.inkcharcustomization"] }, scope: { "player_customization.app": ["axefrog/b/lips.app"] } };
  const merged = archiveXlText(mergeXlFragments([eyes, lips]));
  expect(merged).toContain("  female:\r\n    - axefrog\\a\\xfs_collection.inkcharcustomization\r\n    - axefrog\\b\\lips.inkcharcustomization\r\n");
  expect(Bun.YAML.parse(merged)).toEqual({ customizations: { female: ["axefrog\\a\\xfs_collection.inkcharcustomization", "axefrog\\b\\lips.inkcharcustomization"] },
    resource: { scope: { "player_customization.app": ["axefrog\\a\\xfs_collection.app", "axefrog\\b\\lips.app"] } } });
  expect(() => mergeXlFragments([eyes, eyes])).toThrow("same ArchiveXL entry");
  expect(() => archiveXlText({})).toThrow("at least one entry");
});
