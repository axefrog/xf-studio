import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { CHARACTER_DETAIL_SCHEMA, parseCharacterDetail, parseCoreDetail, parseRenderDetail, RENDER_DETAIL_SCHEMA, type CharacterDetail } from "../src/render-detail";

const sha = (c: string) => c.repeat(64);
const resource = (file: string, c = "a") => ({ file, sha256: sha(c), sources: [{ depotPath: "base\\x.mesh", archive: "basegame.archive", provider: "Installed game" }] });
const texture = () => ({ ...resource(`${sha("b")}.png`, "b"), depotPath: "base\\t.xbm", width: 4, height: 2, isGamma: true });
const character = (): CharacterDetail => ({
  schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: sha("c"), origin: "game-files",
  character: { source: "save", bodyGender: "female" }, provenance: { label: "Your game's installed files", notes: [], tool: "WolvenKit CLI 9.0.1" },
  components: [{ id: "hair:hair:1", slot: "hair", option: "hair_color1", definition: "brown", component: "hair",
    geometry: { ...resource(`${sha("d")}.glb`, "d"), depotPath: "base\\hair.mesh", depotHash: "1", morphTargets: false },
    renderChunks: 3, chunks: [0, 1], materials: [
      { chunk: 0, name: "long", template: "base\\materials\\hair.mt", scalars: { AlphaCutoff: 0 }, colours: {},
        textures: { Strand_Alpha: texture() }, profiles: { HairProfile: { depotPath: "base\\p.hp", archive: "mod.archive", sha256: null, sampleCount: 127,
          id: [{ value: 0.5, color: [1, 2, 3] }], rootToTip: [{ value: 0, color: [4, 5, 6] }] } } },
      { chunk: 1, name: "cap", template: "base\\materials\\mesh_decal_gradientmap_recolor.mt", scalars: {}, colours: { DiffuseColor: [255, 255, 255, 255] },
        textures: {}, profiles: {} }] }],
  slots: [{ slot: "brows", state: "none", label: "None" }, { slot: "lashes", state: "unavailable", label: "brown", message: "Your V's eyelashes aren't shown." },
    { slot: "hair", state: "shown", label: "brown" }],
});
const core = () => ({ schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: "k", origin: "game-files", provenance: { label: "l", notes: [] },
  geometry: { ...resource("head.glb"), nodes: { head: "head", plate: "makeup_plate", eyes: "eyes" }, morphs: [] },
  textures: Object.fromEntries(["head.albedo", "head.normal", "head.roughness", "eyes.albedo"].map(slot => [slot, resource("head-color.png")])) });

describe("render record versions", () => {
  test("v2 carries the character record; parsing is strict and lossless", () => {
    const record = character();
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(parseRenderDetail(record)).toEqual(record);
  });

  test("v1 stays the core head, and a v2 reader accepts it under either version", () => {
    expect(parseRenderDetail(core())).toMatchObject({ detail: "core-head" });
    expect(parseCoreDetail({ ...core(), schema: CHARACTER_DETAIL_SCHEMA })).toMatchObject({ detail: "core-head" });
    expect(() => parseRenderDetail({ ...core(), schema: "xfs/render-detail-3" })).toThrow("unsupported record version");
    // A character record is never read as v1.
    expect(() => parseCharacterDetail({ ...character(), schema: RENDER_DETAIL_SCHEMA })).toThrow();
  });

  test("shapes the loader must never see are refused", () => {
    const bad = (mutate: (record: CharacterDetail) => void) => { const record = character(); mutate(record); return () => parseCharacterDetail(record); };
    expect(bad(r => { r.components[0]!.materials[0]!.chunk = 2; })).toThrow("hidden chunk");
    expect(bad(r => { r.components[0]!.chunks = [0, 0]; })).toThrow("twice");
    expect(bad(r => { r.components[0]!.chunks = [5]; })).toThrow();
    expect(bad(r => { r.components[0]!.geometry.file = "../x.glb"; })).toThrow("plain asset file name");
    expect(bad(r => { (r.components[0]!.materials[0]!.textures.Strand_Alpha as { isGamma?: boolean }).isGamma = undefined; })).toThrow("colour flag");
    expect(bad(r => { r.components[0]!.materials[1]!.colours.DiffuseColor = [256, 0, 0, 0]; })).toThrow();
    expect(bad(r => { r.components[0]!.materials[0]!.profiles.HairProfile!.sampleCount = 1; })).toThrow();
    expect(bad(r => { r.slots = r.slots.slice(1); })).toThrow("slot outcomes");
    expect(bad(r => { r.slots[0] = { slot: "brows", state: "shown", label: "x" }; })).toThrow("shown without components");
    expect(bad(r => { (r.character as { source: string }).source = "ui"; })).toThrow();
  });
});

// The brows, lashes and hair rendering path must follow resolved data only: no mod names, no saved
// appearance hashes or definitions, no per-mod manifests or developer-prepared asset paths. Piercings
// still use their manifests (a documented follow-on), so their lines are the only exception in scene.ts.
describe("rendering boundary", () => {
  const RENDERING_PATH = ["scene", "render-detail", "render-templates", "character-detail-plan", "character-detail-request",
    "character-detail-service", "character-detail-host", "character-detail-server", "character-detail-loader", "character-detail-actions",
    "character-material-adapters", "browser-character-detail-device", "brow-material", "hair-shading", "hair-colour-model",
    "browser-head-attachment", "browser-scene-preview-ports", "material-template"];
  const PER_MOD = /arkhe|icxrus|softnatural|mel_ccxl|meluminary|island_dancer|alliekat|preemhair|eagul|\bprc\b|kala|brown_ombre|ash_brown|10_brown|38_ash|05_brown|\/assets\/(?:brows|lashes|hair)\b|brows\.glb|lashes\.glb|local-hair-assets|lash-profile-preview|brow-preview-1|\b\d{17,20}\b/i;
  test("no per-mod identifiers remain in the brows, lashes and hair rendering path", () => {
    for (const name of RENDERING_PATH) {
      const lines = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8").split("\n");
      const offending = lines.map((line, index) => ({ line, index })).filter(({ line }) => PER_MOD.test(line) &&
        !(name === "scene" && /piercing|prc/i.test(line)) && !/^\s*(?:\/\/|\/?\*)/.test(line));
      expect(offending.map(({ line, index }) => `${name}.ts:${index + 1}: ${line.trim()}`)).toEqual([]);
    }
  });

  test("the removed per-mod manifest modules stay removed and nothing imports the study fixture", () => {
    const files = readdirSync(new URL("../src/", import.meta.url));
    for (const gone of ["hair-preview.ts", "lash-profile.ts", "depot-resolution.ts"]) expect(files).not.toContain(gone);
    for (const name of RENDERING_PATH)
      expect(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8")).not.toContain("brow-study-fixture");
  });
});
