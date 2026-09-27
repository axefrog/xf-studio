/**
 * The masculine V's core head (male V plan phase 1): his own preview-core recipe and preview-only plate selection, served beside the
 * feminine core under `pma/`, prepared on first use through the same host, and loaded when the shown V is masculine.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EYE_PLATE_RECIPE, idListSha256, selectedFaceIds } from "../src/eye-plate-recipe";
import { createGameAssetExporter } from "../src/game-asset-export";
import { HeadLoadError } from "../src/head-load-error";
import { PreviewCoreHost, type PreviewCoreState } from "../src/preview-core-host";
import {
  coreAssetName, parseCoreAssetName, PREVIEW_CORE_ASSET_NAMES, PREVIEW_CORE_FILES, PREVIEW_CORE_MALE_RECIPE, PREVIEW_CORE_RECIPE, PREVIEW_CORE_RECIPES,
  PREVIEW_MASCULINE_PLATE_RECIPE, previewCoreRecipeSha256,
} from "../src/preview-core-recipe";
import { createPreviewCoreHandler } from "../src/preview-core-server";
import { PreviewCoreCache, previewCoreReadiness } from "../src/preview-core-service";
import { PreviewPreparationActions, type PreviewState } from "../src/preview-preparation";
import { coreDetailUrl, CORE_DETAIL_URL } from "../src/render-detail";
import { USER_FACING_JARGON } from "../src/alpha-availability";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "xfs-masculine-core-"));
  roots.push(root);
  const game = join(root, "game"), cli = join(root, "WolvenKit.CLI.exe");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  writeFileSync(cli, "");
  return { game, cli, cacheRoot: join(root, "cache") };
}

test("the masculine core is his own head, eyes (chunk 2) and plate cut; the feminine core's identity is unchanged", () => {
  expect(PREVIEW_CORE_RECIPES.female).toEqual({ recipe: PREVIEW_CORE_RECIPE, plate: EYE_PLATE_RECIPE });
  expect(PREVIEW_CORE_RECIPES.male).toEqual({ recipe: PREVIEW_CORE_MALE_RECIPE, plate: PREVIEW_MASCULINE_PLATE_RECIPE });
  const male = PREVIEW_CORE_MALE_RECIPE, plate = PREVIEW_MASCULINE_PLATE_RECIPE;
  expect(male).toMatchObject({ body: "male", plateRecipeId: plate.id, head: { appearance: "01_ca_pale", chunk: 0 },
    eye: { surfaceMesh: "submesh_02_LOD_1", chunk: 2, appearance: "gradient_brown" } });
  expect(male.eye.meshDepotPath).toContain("player_man_average");
  expect(plate.source.meshDepotPath).toContain("player_man_average\\h0_000_pma_c__basehead");
  // The plan's §4.1 rule: the masculine head's triangles over the feminine plate's UVs (as many as the feminine plate), all 100 targets.
  expect(plate.selection).toMatchObject({ faceCount: EYE_PLATE_RECIPE.selection.faceCount, morphTargetCount: 100, vertexCount: 1627 });
  expect(idListSha256(selectedFaceIds(plate))).toBe(plate.selection.faceIdsSha256);
  // The audited 2.31 masculine sources (the plan's provenance).
  expect(plate.source.supported.map(item => [item.meshSha256, item.morphSha256])).toEqual([[
    "034db61306fea1a6c96546360f37115640b68a0fd211e10f484697db6bb25766", "e68817d2ddc4b6cac831bb7287f0d9a7287a6f91c70ae8fa5e6e1f6a78db9c1b"]]);
  expect(plate.output.stem).not.toBe(EYE_PLATE_RECIPE.output.stem);
  // Leaving `body` out of the identity keeps every cached feminine preview valid (the hash is the one before the masculine core existed).
  const { body: _body, ...before } = PREVIEW_CORE_RECIPE;
  expect(previewCoreRecipeSha256(PREVIEW_CORE_RECIPE, EYE_PLATE_RECIPE))
    .toBe(previewCoreRecipeSha256({ ...before, body: "male" } as typeof PREVIEW_CORE_RECIPE, EYE_PLATE_RECIPE));
});

test("the masculine plate is preview only: nothing but the preview core recipe reads it", () => {
  const src = resolve(import.meta.dir, "..", "src");
  const readers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.ts$/.test(entry.name) && /eye-plate-recipe-pma\.json|PREVIEW_MASCULINE_PLATE_RECIPE|PREVIEW_CORE_RECIPES/.test(readFileSync(path, "utf8")))
        readers.push(path.slice(src.length + 1).replaceAll("\\", "/"));
    }
  };
  walk(src);
  expect(readers.sort()).toEqual(["preview-core-host.ts", "preview-core-recipe.ts", "preview-core-service.ts"]);
});

test("each body's core is served under its own names: the feminine at the top, the masculine under pma/", () => {
  expect(coreDetailUrl("female")).toBe(CORE_DETAIL_URL);
  expect(coreDetailUrl("male")).toBe("/assets/pma/preview-core.json");
  expect(PREVIEW_CORE_ASSET_NAMES).toEqual([...PREVIEW_CORE_FILES, ...PREVIEW_CORE_FILES.map(file => `pma/${file}`)]);
  expect(parseCoreAssetName("head.glb")).toEqual({ body: "female", file: "head.glb" });
  expect(parseCoreAssetName(coreAssetName("male", "head.glb"))).toEqual({ body: "male", file: "head.glb" });
  for (const name of ["pma/../head.glb", "pma/settings.json", "pwa/head.glb", "pma/pma/head.glb", "PMA/head.glb", ""]) expect(parseCoreAssetName(name)).toBeNull();
});

test("each body keeps its own status in the one cache, so preparing one never unreadies the other", () => {
  const { game, cacheRoot } = setup();
  const female = new PreviewCoreCache(cacheRoot), male = new PreviewCoreCache(cacheRoot, PREVIEW_CORE_MALE_RECIPE);
  female.writeStatus({ recipeId: PREVIEW_CORE_RECIPE.id, recipeRevision: PREVIEW_CORE_RECIPE.revision, deriverVersion: 3, state: "unsupported",
    code: "preview_source_unsupported", message: "female", gameRoot: game, contentFingerprint: "x", cacheName: null });
  male.writeStatus({ recipeId: PREVIEW_CORE_MALE_RECIPE.id, recipeRevision: 1, deriverVersion: 3, state: "missing", code: "preview_source_missing",
    message: "male", gameRoot: game, contentFingerprint: "y", cacheName: null });
  expect(female.readStatus()?.message).toBe("female");
  expect(male.readStatus()?.message).toBe("male");
  expect(readdirSync(cacheRoot).sort()).toEqual(["status-xfs-preview-core-male-average.json", "status.json"]);
  expect(previewCoreReadiness(cacheRoot, game, PREVIEW_CORE_MALE_RECIPE)).toEqual({ state: "none" });
});

test("the host prepares the masculine core on request, apart from the feminine one, and serves only a ready body's files", async () => {
  const { game, cli, cacheRoot } = setup();
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const exported: string[][] = [];
  const host = new PreviewCoreHost({ cacheRoot, settings: () => ({ gameRoot: game, wolvenKitCli: cli }),
    exporter: () => createGameAssetExporter(join(cacheRoot, "exports"), async ({ depotPaths }) => { exported.push([...depotPaths]); await gate; },
      { contains: () => new Set() }) });
  expect(host.snapshot("male")).toMatchObject({ body: "male", phase: "idle", canPrepare: true });
  expect(host.snapshot("male").message).toMatch(/masculine V's head/);
  expect(host.prepare("male")).toMatchObject({ body: "male", phase: "preparing", canCancel: true });
  // The feminine core isn't the one being prepared; it waits for the masculine run rather than starting a second.
  expect(host.snapshot()).toMatchObject({ body: "female", phase: "idle", canPrepare: false });
  expect(host.prepare().phase).toBe("idle");
  expect(host.assetPath("pma/head.glb")).toBeNull();
  release();
  await host.settled();
  expect(exported.flat().some(path => path.includes("player_man_average"))).toBe(true);
  expect(exported.flat().some(path => path.includes("player_female_average"))).toBe(false);
  const blocked = host.snapshot("male");
  expect(blocked).toMatchObject({ phase: "blocked", code: "preview_source_missing" });
  expect(blocked.message).toMatch(/male player head/);
  expect(host.snapshot()).toMatchObject({ phase: "idle", canPrepare: true });
  for (const state of [blocked, host.snapshot("male")]) expect(USER_FACING_JARGON.test(state.message)).toBe(false);
});

test("the endpoint takes an optional body on reads and requests, and nothing else", async () => {
  const { game, cacheRoot } = setup();
  const calls: string[] = [];
  const host = new PreviewCoreHost({ cacheRoot, settings: () => ({ gameRoot: game, wolvenKitCli: null }) });
  for (const method of ["prepare", "rebuild", "cancel"] as const) {
    const original = host[method].bind(host);
    host[method] = ((body?: "female" | "male") => { calls.push(`${method}:${body ?? "-"}`); return original(body); }) as never;
  }
  const handler = createPreviewCoreHandler(host);
  const url = "http://127.0.0.1:4317/api/preview-core";
  expect(((await (await handler(new Request(`${url}?body=male`))).json()) as PreviewCoreState).body).toBe("male");
  expect((await handler(new Request(`${url}?body=robot`))).status).toBe(400);
  const post = (body: unknown) => handler(new Request(url, { method: "POST", headers: { Origin: "http://127.0.0.1:4317", "Content-Type": "application/json" },
    body: JSON.stringify(body) }));
  await post({ action: "prepare", body: "male" });
  await post({ action: "cancel", body: "male" });
  await post({ action: "rebuild" });
  // Rebuild prepares the same body again once its entry is set aside.
  expect(calls).toEqual(["prepare:male", "cancel:male", "rebuild:female", "prepare:female"]);
  expect((await post({ action: "prepare", body: "robot" })).status).toBe(400);
  expect((await post({ action: "prepare", body: "male", gameRoot: "C:\\" })).status).toBe(400);
});

const state = (patch: Partial<PreviewState>): PreviewState => ({ schema: "xfs/preview-core-state-1", phase: "idle", message: "Ready.", code: null, needs: [],
  progress: null, lastDurationSeconds: null, canPrepare: true, canCancel: false, ...patch });
const instant = { set: (run: () => void) => { queueMicrotask(run); return 0; }, clear: () => {} };

test("before a masculine head loads, the page has his core prepared (with progress), or learns plainly that it can't be", async () => {
  const calls: string[] = [];
  const replies = [state({ body: "male" }), state({ body: "male", phase: "preparing", canPrepare: false, canCancel: true, message: "Preparing his head…",
    progress: { index: 2, total: 5, label: "Building" } }), state({ body: "male", phase: "ready", canPrepare: false })];
  const actions = new PreviewPreparationActions(async (action, body) => { calls.push(`${action}:${body ?? "-"}`); return { ok: true, data: replies.shift() }; }, 1, instant);
  const pending: [string, number | null][] = [];
  await actions.ensureBody("male", (message, progress) => pending.push([message, progress]));
  expect(calls).toEqual(["refresh:male", "prepare:male", "refresh:male"]);
  expect(pending).toEqual([["Preparing his head…", 0.5]]);
  // The feminine core is the one the setup service follows: nothing to ask.
  await actions.ensureBody("female");
  expect(calls.length).toBe(3);
  // A game version XF Studio doesn't support: one more try, then a typed refusal carrying the host's plain words.
  const refusing = new PreviewPreparationActions(async () => ({ ok: true, data: state({ body: "male", phase: "blocked", message: "A newer game patch." }) }), 1, instant);
  const error = await refusing.ensureBody("male").catch(caught => caught);
  expect(error).toBeInstanceOf(HeadLoadError);
  expect(error).toMatchObject({ code: "body_unavailable", message: "A newer game patch." });
  const offline = new PreviewPreparationActions(async () => { throw Error("offline"); }, 1, instant);
  expect(await offline.ensureBody("male").catch(caught => caught.code)).toBe("body_unavailable");
});

test("a head follows only its own body's V: another body's details and facial shape wait for that body's head", async () => {
  const { followCharacter } = await import("../src/character-follow");
  const asked: string[] = [], faces: unknown[] = [];
  let request = { schema: "xfs/character-request-7", source: "default", bodyGender: "male" } as const;
  let view = { bodyGender: "male", faceMorphs: [{ region: "eyes", target: "h051" }] };
  const listeners = new Set<() => void>();
  const release = followCharacter({ headBody: "male",
    context: { detailRequest: () => request as never, view: () => view as never, viewCurrent: () => true, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    details: { setCharacter: async next => { asked.push(next.bodyGender); } }, savedV: { subscribe: () => () => {} }, setFaceMorphs: morphs => faces.push(morphs) });
  expect(asked).toEqual(["male"]);
  expect(faces).toEqual([[{ region: "eyes", target: "h051" }]]);
  request = { ...request, bodyGender: "female" } as never;
  view = { bodyGender: "female", faceMorphs: [] };
  for (const listener of listeners) listener();
  expect(asked).toEqual(["male"]);
  expect(faces.length).toBe(1);
  release();
});
