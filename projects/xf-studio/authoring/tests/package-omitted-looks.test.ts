/**
 * CORE-34: the export and package capability is based on the draft's eye-makeup view, and looks or
 * parts left out (a look without eye makeup, another feature's part with no exporter) are reported in
 * Check, Build and the manifest, never dropped silently.
 */
import { expect, test } from "bun:test";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import type { EditorSnapshot } from "../src/collection-session";
import { collectionDraft } from "../src/collection-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { describePackageCheck, originalPresetCount } from "../src/package-filter";
import { COLLECTION_2 } from "../src/platform/api";
import { emptyRecipe } from "../src/engines/layered-makeup/recipe";
import { NO_EXPORTER_REASON, NO_EYE_MAKEUP_REASON, parseCollection } from "../src/preset-collection";
import { EYE_MAKEUP_PART_2 } from "../src/recipe-schema";
import { fixedId } from "./fixtures/workspace-v1-fixtures";
import { initialRecipe } from "./fixtures/eye-region";
import { readRecipe as parseRecipe } from "../src/recipe-schema";
import { preparePackageCollection } from "./fixtures/eye-exporter";
import { realCheck } from "./fixtures/package-results";

const EYE = "eye-makeup", hair = { schema: "xfs/hair-part-3", body: { strands: 2 } };
const eye = () => ({ schema: EYE_MAKEUP_PART_2, body: parseRecipe(initialRecipe()) });
/** Two eye-makeup looks (one also has a hair part) and one hair-only look. */
const collection = () => ({ schema: COLLECTION_2, id: fixedId(50), name: "Mixed", presets: [
  { id: fixedId(51), name: "Eyes", revision: 1, parts: { [EYE]: eye() } },
  { id: fixedId(52), name: "Eyes and hair", revision: 1, parts: { [EYE]: eye(), hair } },
  { id: fixedId(53), name: "Hair only", revision: 1, parts: { hair } },
] });

function service(value: unknown, recipe = parseRecipe(initialRecipe())) {
  let editor: EditorSnapshot = { recipe, active: 0, selected: 0, history: [] };
  let sent: unknown;
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("unused"); },
    save: async () => { throw Error("unused"); },
    package: async (_action, input) => { sent = input; return realCheck(JSON.parse(JSON.stringify(input))); } };
  const draft = collectionDraft(value, STUDIO_DOCUMENTS);
  const svc = new CollectionService(STUDIO_DOCUMENTS, draft, { selected: "", name: "" }, () => editor, next => editor = next, transport,
    () => ({ recipe: editor.recipe, revision: 0 }));
  return { svc, sent: () => sent };
}

test("Check, Build and the manifest report looks without eye makeup and other features' parts", async () => {
  const f = service(collection());
  const outcome = await f.svc.execute({ kind: "package", action: "check" });
  expect(outcome.ok).toBe(true);
  // The Studio sends the whole draft in its stored form; each exporter on the host reads its own part.
  const sent = f.sent() as { schema: string; presets: { name: string }[] };
  expect(sent.schema).toBe(COLLECTION_2);
  expect(sent.presets.map(preset => preset.name)).toEqual(["Eyes", "Eyes and hair", "Hair only"]);
  const check = realCheck(JSON.parse(JSON.stringify(sent)));
  expect(check.originalPresetCount).toBe(3);
  // Parts no exporter packages are the platform's to report; a look without eye makeup is eye makeup's.
  expect(check.omissions).toEqual([
    { kind: "part", presetId: fixedId(52), presetName: "Eyes and hair", feature: "hair", reason: NO_EXPORTER_REASON },
    { kind: "part", presetId: fixedId(53), presetName: "Hair only", feature: "hair", reason: NO_EXPORTER_REASON },
  ]);
  expect(check.products[0].features[0].omissions).toEqual([
    { kind: "preset", presetId: fixedId(53), presetName: "Hair only", reason: NO_EYE_MAKEUP_REASON },
  ]);
  // The report is not content: the packaged copy (and its hash) never carries it.
  const prepared = preparePackageCollection(sent);
  expect(prepared.packaged).not.toHaveProperty("omitted");
  expect(originalPresetCount(prepared.source)).toBe(3);
  const text = describePackageCheck(check);
  expect(text).toContain("left out the hair part of preset “Eyes and hair”");
  expect(text).toContain("omitted whole preset “Hair only” because it has no eye makeup");
  expect(outcome.ok && outcome.result.kind === "packageCheck" && outcome.result.result.originalPresetCount).toBe(3);
});

test("a collection-2 file read directly lists what it leaves out; the list validates and round-trips through collection-1", () => {
  const view = parseCollection(collection());
  expect(view.omitted).toHaveLength(3);
  expect(parseCollection(JSON.parse(JSON.stringify(view)))).toEqual(view);
  expect(() => parseCollection({ ...view, omitted: [{ presetId: "not-a-uuid", presetName: "x", reason: "y" }] })).toThrow("omitted");
  expect(() => parseCollection({ ...view, omitted: [] })).toThrow("omitted");
  // An eye-makeup-only collection has no list at all, so its packaged bytes and hashes are unchanged.
  const only = collection(); only.presets = only.presets.slice(0, 1);
  expect(parseCollection(only)).not.toHaveProperty("omitted");
});

test("package and build-plan capability need a look with eye makeup; a collection export does not", () => {
  const hairOnly = { ...collection(), presets: [collection().presets[2]] };
  const empty = service(hairOnly, emptyRecipe());
  for (const kind of ["package", "exportPlan"] as const)
    expect(empty.svc.capability(kind === "package" ? { kind, action: "check" } : { kind }))
      .toMatchObject({ available: false, code: "invalid_value", reason: expect.stringContaining("eye makeup") });
  expect(empty.svc.capability({ kind: "exportCollection" })).toEqual({ available: true });
  // The live editor's layers count for the selected look: stashing them gives it an eye-makeup part.
  expect(service(hairOnly).svc.capability({ kind: "package", action: "check" })).toEqual({ available: true });
});
