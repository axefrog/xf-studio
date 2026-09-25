import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planCollection } from "../src/preset-collection";
import {
  appearanceResource, archiveXlDeclaration, componentId, customizationResource, HandleCounter, resourceJson,
  rewritePlateMesh, rewritePlateMorph,
} from "../src/package-resources";
import { plateUvWindow, uvTransformConstants } from "../src/plate-uv-window";

const plan = planCollection(JSON.parse(readFileSync(resolve(import.meta.dir,
  "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8")));
const plateMesh = () => ({ Header: {}, Data: { RootChunk: { appearances: [{ HandleId: "0" }], materialEntries: [],
  localMaterialBuffer: { materials: [], rawData: "old", rawDataHeaders: [1] }, renderResourceBlob: { kept: true } } } });

test("handle numbering follows the Python builder: mesh appearances, component bindings, app definitions, selector", () => {
  const handles = new HandleCounter();
  const mesh = rewritePlateMesh(plateMesh(), plan, handles, uvTransformConstants(plateUvWindow({ uMin: .27, uMax: .73, vMin: .67, vMax: .82 }))).Data.RootChunk;
  expect(mesh.appearances.map((a: { HandleId: string }) => a.HandleId)).toEqual(["10000", "10001", "10002", "10003"]);
  expect(mesh.appearances[0].Data.chunkMaterials[0].$value).toBe(plan.presets[0].appearance + "@preset");
  expect(mesh.appearances[1].Data.chunkMaterials).toEqual([]);
  expect(mesh.renderResourceBlob).toEqual({ kept: true });
  expect(mesh.localMaterialBuffer).toMatchObject({ rawData: null, rawDataHeaders: [] });
  const app = appearanceResource(plan, handles).Data.RootChunk;
  const component = app.appearances[1].Data.components[0];
  expect([component.parentTransform.HandleId, component.skinning.HandleId]).toEqual(["10004", "10005"]);
  expect(app.appearances.map((a: { HandleId: string }) => a.HandleId)).toEqual(["10006", "10007"]);
  const cc = customizationResource(plan, handles).Data.RootChunk;
  expect(cc.headCustomizationOptions[0].HandleId).toBe("10008");
  expect(cc.headCustomizationOptions[0].Data.localizedName).toBe(plan.selectorLabel);
  expect(cc.headCustomizationOptions[0].Data.definitions.map((d: { index: number }) => d.index)).toEqual([0, 1, 2, 3, 4]);
});

test("the morph target points at the collection mesh and the component ID is the stable SHA-256 prefix", () => {
  const morph = rewritePlateMorph({ Data: { RootChunk: {} } }, plan).Data.RootChunk;
  expect(morph.baseMesh.DepotPath.$value).toBe(plan.mesh.replaceAll("/", "\\"));
  expect(morph.baseMeshAppearance.$value).toBe(plan.presets[0].appearance);
  const id = componentId(plan.component);
  // The value the Python builder computed for this fixture: an unsigned 64-bit integer beyond 2^53, kept as a string.
  expect(id).toBe("17706479484054453710");
  expect(componentId(plan.component + "x")).not.toBe(id);
});

test("an unbranded plan is refused and the ArchiveXL declaration keeps the historical CRLF bytes", () => {
  expect(() => customizationResource({ ...plan, selectorLabel: "Eye makeup" } as unknown as typeof plan, new HandleCounter())).toThrow("XF-branded");
  const xl = archiveXlDeclaration(plan);
  expect(xl.split("\r\n")).toEqual(["customizations:", "  female: " + plan.customization.replaceAll("/", "\\"), "resource:",
    "  scope:", "    player_customization.app:", "      - " + plan.app.replaceAll("/", "\\"), ""]);
});

test("resource JSON is compact with non-ASCII escaped, as the Python builder wrote it", () => {
  expect(resourceJson({ name: "Verification — metallic copy", n: 1 })).toBe('{"name":"Verification \\u2014 metallic copy","n":1}\n');
  expect(JSON.parse(resourceJson({ name: "é😀" }))).toEqual({ name: "é😀" });
});
