/**
 * XF Eye Artistry for a masculine V (male V plan phases 5–6): his own plate (audited recipe with the male head's native
 * seams), his own customization resource and `.app` beside the feminine ones, one texture set for both, the optional
 * masculine plate prerequisite, what Check and Build say when he can't be included, and the verifier's per-body checks.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { planCollection } from "../src/preset-collection";
import {
  appearanceResource, archiveXlDeclaration, customizationResource, HandleCounter, resourceJson, rewritePlateMorph, SELECTOR_OPTION_INDEX,
  selectorBodies, SELECTOR_VISUAL_TAG,
} from "../src/package-resources";
import { expectedPaths } from "../src/archive-inventory";
import { plateTopology, weldedSeams } from "../src/eye-plate-verify";
import { AUDIENCE_BOTH, AUDIENCE_FEMININE, CHECK_BUILD_DECIDES_NOTE, CHECK_MASCULINE_NOTE, EYE_MAKEUP_EXPORTER, MASCULINE_NOT_PREPARED,
  MASCULINE_WINDOW } from "../src/features/eye-makeup/export";
import { PLATE_REACH_UNCHECKED_NOTE, describePackageBuild } from "../src/package-filter";
import { EYE_PLATE_HEAD_SETTING } from "../src/eye-plate-head-choice";
import { EYE_PLATE_MASCULINE_PREREQUISITE, EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { checkArchiveXl, verifierBodies, VERIFIER_BODY_RULES, type VerifierPlan } from "../src/features/eye-makeup/verify/resource-checks";
import { EyePlateError, packagePlateRecord, type EyePlateManifest, type EyePlateTools } from "../src/eye-plate-service";
import { eyePlateRouteKeyFor, masculineEyePlatePrerequisite, masculineUnavailable, unreadArchives } from "../src/eye-plate-prerequisite";
import { testMasculineEyePlate } from "../src/package-server";
import { EyePlateCache, contentFingerprint } from "../src/eye-plate-cache";
import { EYE_PLATE_MASCULINE_RECIPE } from "../src/eye-plate-recipe";
import { runProductCommand, type ProductCommandOptions } from "../src/platform/export/product-builder";
import { verifyProductBuildResult } from "../src/platform/export/product-host";
import { checkProducts } from "../src/platform/export/product-check";
import type { PackageBuildResult } from "../src/platform/api";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/plate-uv-footprint-io";
import { eyeEntry, fakeEyeVerifier, fakeTools, fakeVerifierTools, FOOTPRINT, sha, writePlate } from "./fixtures/product-fixture";

const app = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(resolve(app, "../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-masculine-export-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const feminine = planCollection(fixture), both = planCollection(fixture, { masculine: true });
const depot = (path: string) => path.replaceAll("/", "\\");

test("a plan with the masculine V adds only his own customization, app and plate; everything else is the feminine plan's", () => {
  expect(feminine.masculine).toBeUndefined();
  const { masculine, ...rest } = both;
  expect(rest).toEqual(feminine);
  expect(masculine).toEqual({ app: `${feminine.depot}/xfs_collection_pma.app`, customization: `${feminine.depot}/xfs_collection_pma.inkcharcustomization`,
    mesh: `${feminine.depot}/models/xfs_eye_plate_pma.mesh`, morph: `${feminine.depot}/models/xfs_eye_plate_pma.morphtarget` });
  // Four more files; the textures are the same set.
  expect([...expectedPaths(both)].sort()).toEqual([...expectedPaths(feminine), ...Object.values(masculine!)].sort());
  expect(selectorBodies(feminine).map(body => body.body)).toEqual(["female"]);
  expect(selectorBodies(both).map(body => body.body)).toEqual(["female", "male"]);
  // ArchiveXL merges `female` into the feminine creator and `male` into the masculine one; both apps join the scope.
  expect(archiveXlDeclaration(both).split("\r\n")).toEqual(["customizations:", `  female: ${depot(both.customization)}`,
    `  male: ${depot(masculine!.customization)}`, "resource:", "  scope:", "    player_customization.app:", `      - ${depot(both.app)}`,
    `      - ${depot(masculine!.app)}`, ""]);
  expect(archiveXlDeclaration(feminine)).toBe(archiveXlDeclaration({ app: feminine.app, customization: feminine.customization }));
});

test("his resources bind his plate, carry the Male tag and sit after teeth in his creator; hers are byte for byte unchanged", () => {
  const [, male] = selectorBodies(both);
  const his = { app: appearanceResource(both, new HandleCounter(), male).Data.RootChunk, cc: customizationResource(both, new HandleCounter(), male).Data.RootChunk };
  const template = his.app.appearances[1].Data, option = his.cc.headCustomizationOptions[0].Data;
  expect(template.components[0].morphResource.DepotPath.$value).toBe(depot(male.morph));
  expect(template.components[0].name.$value).toBe(both.component);
  expect(template.visualTags.tags.map((tag: { $value: string }) => tag.$value)).toEqual(["Male"]);
  expect(option.index).toBe(541);
  expect(option.resource.DepotPath.$value).toBe(depot(male.app));
  // The same selector name, label, groups and looks as hers: each gender's creator is its own resource.
  const hers = customizationResource(both, new HandleCounter()).Data.RootChunk.headCustomizationOptions[0].Data;
  expect({ ...option, index: 0, resource: null }).toEqual({ ...hers, index: 0, resource: null });
  expect(hers.index).toBe(311);
  expect(rewritePlateMorph({ Data: { RootChunk: {} } }, both, male).Data.RootChunk.baseMesh.DepotPath.$value).toBe(depot(male.mesh));
  // The feminine resources of a plan that includes him are the feminine-only plan's, byte for byte.
  const bytes = (plan: typeof both) => { const handles = new HandleCounter(); return [resourceJson(appearanceResource(plan, handles)),
    resourceJson(customizationResource(plan, handles)), resourceJson(rewritePlateMorph({ Data: { RootChunk: {} } }, plan))]; };
  expect(bytes(both)).toEqual(bytes(feminine));
  // The verifier restates both rules on its own.
  expect(SELECTOR_VISUAL_TAG as Record<string, unknown>).toEqual({ female: VERIFIER_BODY_RULES.female.visualTag, male: VERIFIER_BODY_RULES.male.visualTag });
  expect(SELECTOR_OPTION_INDEX as Record<string, unknown>).toEqual({ female: VERIFIER_BODY_RULES.female.optionIndex, male: VERIFIER_BODY_RULES.male.optionIndex });
});

test("the verifier accepts exactly the planned bodies' declarations and the _pma naming rule", () => {
  const plan = both as unknown as VerifierPlan;
  expect(verifierBodies(plan).map(body => [body.body, body.app])).toEqual([["female", both.app], ["male", both.masculine!.app]]);
  expect(() => verifierBodies({ ...plan, masculine: { ...both.masculine!, app: both.app } })).toThrow("_pma twins");
  const parse = (text: string) => Bun.YAML.parse(text);
  checkArchiveXl(plan, parse(archiveXlDeclaration(both)));
  checkArchiveXl(feminine as unknown as VerifierPlan, parse(archiveXlDeclaration(feminine)));
  // A declaration without him, or his app missing from the scope, fails for a plan that includes him; and the reverse.
  expect(() => checkArchiveXl(plan, parse(archiveXlDeclaration(feminine)))).toThrow("exactly the female and male list");
  expect(() => checkArchiveXl(feminine as unknown as VerifierPlan, parse(archiveXlDeclaration(both)))).toThrow("exactly the female list");
  expect(() => checkArchiveXl(plan, parse(archiveXlDeclaration(both).replace(`      - ${depot(both.masculine!.app)}\r\n`, ""))))
    .toThrow("exactly the planned apps");
  // Beside another feature: each body's entries once.
  checkArchiveXl(plan, parse(archiveXlDeclaration(both)), false);
  expect(() => checkArchiveXl(plan, parse(archiveXlDeclaration(feminine)), false)).toThrow("male customization exactly once");
});

test("native seams: a slit between copies that never part is welded; the raw topology counts it, the strict rule refuses the pinch", () => {
  // Two quads (0-1-2-3 and 4-5-6-7) meeting along a slit: vertices 1/4 and 2/7 are copies at one position.
  const triangles = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]];
  const raw = plateTopology(triangles, 8);
  expect(raw).toEqual({ componentVertexCounts: [4, 4], boundaryEdges: 8, boundaryLoops: 2, nonManifoldEdges: 0 });
  const positions = ["a", "p", "q", "b", "p", "c", "d", "q"], same = Array(8).fill("deforms alike");
  expect(weldedSeams(triangles, same, positions)).toEqual({ weldedVertices: 2,
    topology: { componentVertexCounts: [6], boundaryEdges: 6, boundaryLoops: 1, nonManifoldEdges: 0 } });
  // Copies that deform differently (another skin byte or morph row) stay apart, and the half-welded slit pinches: refused.
  expect(() => weldedSeams(triangles, same.map((value, vertex) => vertex === 4 ? "other skin" : value), positions)).toThrow("closed loops");
  // A vertex on four boundary edges: the strict rule refuses it, the raw count accepts it.
  const pinched = [[0, 1, 2], [0, 3, 4]];
  expect(() => plateTopology(pinched, 5)).toThrow("closed loops");
  expect(plateTopology(pinched, 5, { pinches: "count" }).boundaryLoops).toBe(1);
});

/** A prepared masculine plate folder like the host's cache entry: his stem, 100 targets, the same footprint as the fixture plate. */
function writeMasculinePlate(dir: string, footprint = FOOTPRINT) {
  const plate = join(dir, "plate-pma");
  mkdirSync(plate, { recursive: true });
  writeFileSync(join(plate, "xfs_eye_plate_pma.mesh"), "masculine mesh fixture");
  writeFileSync(join(plate, "xfs_eye_plate_pma.morphtarget"), "masculine morph fixture");
  const manifest = { schema: "xfs/eye-plate-cache-1", recipeId: EYE_PLATE_MASCULINE_RECIPE.id, recipeRevision: EYE_PLATE_MASCULINE_RECIPE.revision,
    cacheKey: "d".repeat(64), source: { revisionId: "cp2077-2.31" }, verification: { morphTargets: 100 },
    files: { mesh: { sha256: sha("masculine mesh fixture") }, morph: { sha256: sha("masculine morph fixture") } }, uv: plateUvManifestRecord(footprint) };
  mkdirSync(join(dir, "pma"), { recursive: true });
  writeFileSync(join(dir, "pma", "plate-manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "pma", PLATE_UV_FILE), JSON.stringify(footprint));
  return { plate, manifestFile: join(dir, "pma", "plate-manifest.json"), manifest: manifest as unknown as EyePlateManifest };
}

function setup(masculine: "ready" | "none" | "unavailable") {
  const dir = resolve(root, crypto.randomUUID());
  const game = join(dir, "game"), tools = join(dir, "tools");
  for (const path of [game, tools]) mkdirSync(path, { recursive: true });
  writeFileSync(join(tools, "WolvenKit.CLI.exe"), "fixture");
  const hers = writePlate(dir), his = writeMasculinePlate(dir);
  writeFileSync(join(dir, "collection.json"), JSON.stringify(fixture));
  const calls: string[] = [], packed = new Map<string, string>(), verified: Parameters<ReturnType<typeof fakeEyeVerifier>["verify"]>[0][] = [];
  const hisValue = masculine === "ready" ? { directory: his.plate, manifest: his.manifestFile }
    : masculine === "unavailable" ? masculineUnavailable("plate_source_unsupported") : undefined;
  const options: ProductCommandOptions = { exporters: [eyeEntry(fakeEyeVerifier(verified))], collection: join(dir, "collection.json"),
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { directory: hers.plate, manifest: hers.manifestFile },
      ...hisValue ? { [EYE_PLATE_MASCULINE_PREREQUISITE]: hisValue } : {} },
    wolvenkit: join(tools, "WolvenKit.CLI.exe"), gamepath: game, appRoot: app, buildRoot: join(dir, "build"), distRoot: join(dir, "dist"),
    tools: () => fakeTools(calls, packed), verifierTools: () => fakeVerifierTools(packed) };
  // The host's own plan on the prepared plates (the result gate compares with it).
  const hostPlan = () => checkProducts({ collection: fixture, exporters: [eyeEntry()], diagnostics: false, preflight: false,
    collectionSha256: sha(JSON.stringify(fixture)), prerequisites: { [EYE_PLATE_PREREQUISITE]: { ...plateReachInput(FOOTPRINT), record: packagePlateRecord(hers.manifest as unknown as EyePlateManifest) },
      ...masculine === "ready" ? { [EYE_PLATE_MASCULINE_PREREQUISITE]: { ...plateReachInput(FOOTPRINT), record: packagePlateRecord(his.manifest) } }
        : hisValue ? { [EYE_PLATE_MASCULINE_PREREQUISITE]: hisValue } : {} } });
  return { dir, options, calls, verified, packed, his, hostPlan };
}
const staged = (result: PackageBuildResult, dir: string) => join(dir, "build", basename(result.products[0].package), "archive");
const tree = (base: string): Record<string, string> => Object.fromEntries(readdirSync(base, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => { const path = join(entry.parentPath, entry.name);
    return [path.slice(base.length + 1).replaceAll("\\", "/"), sha(readFileSync(path))]; }));

test("Build with his plate ready makes one mod for both bodies; her files are the feminine-only build's", async () => {
  const both = setup("ready"), alone = setup("none");
  const result = await runProductCommand(both.options) as PackageBuildResult;
  verifyProductBuildResult(result, both.hostPlan(), join(both.dir, "dist"));
  const [feature] = result.products[0].features;
  expect(feature.notes).toEqual([]);
  expect(feature.audience).toBe(AUDIENCE_BOTH);
  expect(feature.warnings).toBeUndefined();
  // The manifest records whom the mod is for.
  expect(JSON.parse(readFileSync(result.products[0].manifest, "utf8")).features[0].audience).toBe(AUDIENCE_BOTH);
  expect(feature.details).toMatchObject({ bodies: ["female", "male"], masculinePlate: { source: "derived", recipeId: EYE_PLATE_MASCULINE_RECIPE.id,
    cacheKey: "d".repeat(64), meshSha256: sha("masculine mesh fixture") } });
  const plan = planCollection(JSON.parse(readFileSync(join(both.dir, "collection.json"), "utf8")), { masculine: true });
  const xl = readFileSync(join(result.products[0].package, "archive", "pc", "mod", `${plan.namespace}.archive.xl`), "utf8");
  expect(xl).toBe(archiveXlDeclaration(plan));
  expect(result.products[0].verifiedUnpackedFiles).toBe(4 * 3 + 8);
  // His plate is read after hers, his resources are converted with hers, and the host packs once.
  expect(both.calls).toEqual(["serialize", "serialize", "import", "import", "deserialize", "deserialize", "deserialize", "pack"]);
  const record = JSON.parse(readFileSync(join(both.dir, "build", basename(result.products[0].package), "features", "eye-makeup", "build.json"), "utf8"));
  expect(record.masculine).toMatchObject({ plateStem: "xfs_eye_plate_pma", plateUv: { footprintSha256: plateReachInput(FOOTPRINT).sha256 } });
  expect(both.verified[0].prerequisites[EYE_PLATE_MASCULINE_PREREQUISITE]).toMatchObject({ morphTargets: 100,
    record: { meshSha256: sha("masculine mesh fixture") } });
  // Her resources and the shared textures are exactly what a feminine-only build writes; his four files are the only addition.
  const feminineOnly = await runProductCommand(alone.options) as PackageBuildResult;
  expect(feminineOnly.products[0].features[0].notes).toEqual([]);
  expect(feminineOnly.products[0].features[0].audience).toBe(AUDIENCE_FEMININE);
  expect(feminineOnly.products[0].features[0].warnings).toEqual([MASCULINE_NOT_PREPARED]);
  expect(feminineOnly.products[0].features[0].details.bodies).toEqual(["female"]);
  const withHim = tree(staged(result, both.dir)), withoutHim = tree(staged(feminineOnly, alone.dir));
  const added = Object.keys(withHim).filter(path => !(path in withoutHim)).sort();
  expect(added).toEqual(Object.values(plan.masculine!).sort());
  for (const [path, hash] of Object.entries(withoutHim)) expect(withHim[path]).toBe(hash);
  // His .app binds his plate; the fake conversion keeps the builder's JSON, so the bytes show it.
  expect(readFileSync(join(staged(result, both.dir), ...plan.masculine!.app.split("/")), "utf8")).toContain("xfs_eye_plate_pma.morphtarget");
}, 60_000);

test("Build says plainly when the mod is for a feminine V only, and why", async () => {
  const run = setup("unavailable");
  const result = await runProductCommand(run.options) as PackageBuildResult;
  verifyProductBuildResult(result, run.hostPlan(), join(run.dir, "dist"));
  const [feature] = result.products[0].features;
  expect(feature.notes).toEqual([]);
  expect(feature.audience).toBe(AUDIENCE_FEMININE);
  expect(feature.warnings).toEqual([{ text: "This game version's masculine V head is new to XF Studio; update XF Studio to include him." }]);
  // The manifest and the Build message carry the same reason and step.
  expect(JSON.parse(readFileSync(result.products[0].manifest, "utf8")).features[0]).toMatchObject({ audience: AUDIENCE_FEMININE, warnings: feature.warnings });
  expect(describePackageBuild(result)).toContain(feature.warnings![0].text);
  expect(feature.details.bodies).toEqual(["female"]);
  expect(result.products[0].verifiedUnpackedFiles).toBe(4 * 3 + 4);
}, 60_000);

test("Check: his plate ready, not yet known, unavailable, or on other texture coordinates", () => {
  const plan = (his: unknown, hers: unknown = plateReachInput(FOOTPRINT)) => EYE_MAKEUP_EXPORTER.plan({ collection: fixture, diagnostics: false,
    prerequisites: { [EYE_PLATE_PREREQUISITE]: hers, ...his === undefined ? {} : { [EYE_PLATE_MASCULINE_PREREQUISITE]: his } } });
  const ready = plan(plateReachInput(FOOTPRINT));
  expect(ready.check.notes).toEqual([]);
  expect(ready.check.audience).toBe(AUDIENCE_BOTH);
  expect(ready.check.details.bodies).toEqual(["female", "male"]);
  expect(ready.inventory).toEqual(expect.arrayContaining(Object.values(ready.plan.masculine!)));
  expect(ready.xl.customizations?.male).toEqual([ready.plan.masculine!.customization]);
  // Before a Build prepared his plate for this route, Check plans on including him and says Build checks his head.
  const unknown = plan(undefined);
  expect(unknown.check.notes).toEqual([CHECK_MASCULINE_NOTE]);
  expect(unknown.check.audience).toBe(AUDIENCE_BOTH);
  // Before any plate was prepared: one note says both things Build still decides.
  const blind = EYE_MAKEUP_EXPORTER.plan({ collection: fixture, diagnostics: false, prerequisites: {} });
  expect(blind.check.notes).toEqual([CHECK_BUILD_DECIDES_NOTE]);
  expect(blind.check.notes).not.toContain(PLATE_REACH_UNCHECKED_NOTE);
  expect(unknown.check.details.bodies).toEqual(["female", "male"]);
  const unavailable = plan(masculineUnavailable("plate_source_modded"));
  expect(unavailable.check.notes).toEqual([]);
  expect(unavailable.check.audience).toBe(AUDIENCE_FEMININE);
  expect(unavailable.check.warnings).toEqual([{ text: masculineUnavailable("plate_source_modded").unavailable.message, next: "settings.game" }]);
  expect(unavailable.plan.masculine).toBeUndefined();
  expect(unavailable.xl.customizations?.male).toBeUndefined();
  const other = { ...FOOTPRINT, window: { ...FOOTPRINT.window, u0: FOOTPRINT.window.u0 + 0.01 } };
  const shifted = plan({ footprint: other, sha256: "e".repeat(64) });
  expect(shifted.check.warnings).toEqual([MASCULINE_WINDOW]);
  expect(shifted.check.details.bodies).toEqual(["female"]);
  // Every reason is one sentence of about 100 characters, the reason then the step, naming him "the masculine V" and never
  // the developer's words for his head; the head-choice step says it covers both V's and names the setting as Settings does.
  const reasons = ["plate_source_missing", "plate_source_unsupported", "plate_source_modded", "plate_source_incomplete", "plate_tool_failed"]
    .map(code => masculineUnavailable(code).unavailable).concat([masculineUnavailable("plate_source_incomplete", ["broken_head.archive"]).unavailable]);
  for (const { message } of [...reasons, { message: MASCULINE_WINDOW.text }]) {
    expect(message).toMatch(/^[A-Z][^;]*; [^;]*[.]$/); // one sentence: the reason; the step
    expect(message.length).toBeLessThanOrEqual(150);
    expect(message).toContain("masculine V");
    expect(message).not.toMatch(/male player head|male head|texture coordinates|plate|This mod is for/);
  }
  expect(masculineUnavailable("plate_source_modded").unavailable).toMatchObject({ next: "settings.game" });
  expect(masculineUnavailable("plate_source_modded").unavailable.message).toContain(`“${EYE_PLATE_HEAD_SETTING.options["base-game"]}” for both V's`);
  expect(MASCULINE_WINDOW.text).toContain(`“${EYE_PLATE_HEAD_SETTING.options["base-game"]}” for both V's`);
  // An unreadable mod is named (from the failure's detail, `name: error` per archive), with the step that clears it.
  expect(unreadArchives(new EyePlateError("plate_source_incomplete", "x", "broken_head.archive: bad index: 3\nother.archive: gone"))).toEqual(["broken_head.archive", "other.archive"]);
  expect(unreadArchives(new EyePlateError("plate_source_modded", "x", "a.archive: y"))).toEqual([]);
  // An unreadable mod is named, with the step that clears it.
  expect(masculineUnavailable("plate_source_incomplete", ["broken_head.archive"]).unavailable.message).toContain("“broken_head.archive”");
  expect(masculineUnavailable("plate_source_incomplete", ["broken_head.archive"]).unavailable.message).toContain("reinstall or remove it");
});

test("the masculine plate prerequisite never stops a Build: a failure becomes the reason he is left out; cancelling still cancels", async () => {
  const dir = resolve(root, crypto.randomUUID()), game = join(dir, "game"), cacheRoot = join(dir, "cache");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  const failing: EyePlateTools = { async extract() { throw Object.assign(Error("unbundle failed"), { output: "log" }); },
    async serialize() { throw Error("unused"); }, async deserialize() { throw Error("unused"); } };
  const options = { route: { gameRoot: game, launchRoute: "direct" as const }, cacheRoot, wolvenKitCli: join(dir, "WolvenKit.CLI.exe"), tools: () => failing };
  const prerequisite = masculineEyePlatePrerequisite(options);
  const prepared = await prerequisite.prepare(new AbortController().signal);
  // No head in this game folder: he is left out with that reason, and the Build goes on.
  expect(prepared.plan).toEqual(masculineUnavailable("plate_source_missing"));
  expect(prepared.builder).toEqual(prepared.plan);
  const controller = new AbortController();
  controller.abort();
  await expect(prerequisite.prepare(controller.signal)).rejects.toMatchObject({ code: "plate_cancelled" });
  // The developer plate override has no masculine plate.
  expect((await masculineEyePlatePrerequisite({ ...options, override: dir }).prepare(new AbortController().signal)).plan)
    .toEqual(masculineUnavailable("plate_override"));
  // Check reads his last recorded outcome for this route: a head XF Studio hasn't checked is reported, a tool failure is not.
  const status = (code: string) => new EyePlateCache(cacheRoot, EYE_PLATE_MASCULINE_RECIPE).writeStatus({ recipeId: EYE_PLATE_MASCULINE_RECIPE.id,
    recipeRevision: EYE_PLATE_MASCULINE_RECIPE.revision, state: code === "plate_source_unsupported" ? "unsupported" : "failed", code, message: code,
    gameRoot: game, contentFingerprint: contentFingerprint(game, EYE_PLATE_MASCULINE_RECIPE.source.archiveDirectory), cacheName: null,
    routeKey: eyePlateRouteKeyFor(options) });
  status("plate_source_unsupported");
  expect(prerequisite.cached()).toEqual(masculineUnavailable("plate_source_unsupported"));
  status("plate_tool_failed");
  expect(prerequisite.cached()).toBeNull();
  // His status is his own file: the feminine plate's status.json is untouched.
  expect(readdirSync(cacheRoot).filter(name => name.startsWith("status")).sort()).toEqual([`status-${EYE_PLATE_MASCULINE_RECIPE.id}.json`]);
});

test("an isolated test server's masculine plate stand-in gives one fixed outcome, and only for a plate code", async () => {
  expect(testMasculineEyePlate(undefined)).toBeNull();
  expect(testMasculineEyePlate("on")).toBeNull();
  const standIn = testMasculineEyePlate("plate_source_modded")!;
  expect(standIn.cached()).toEqual(masculineUnavailable("plate_source_modded"));
  expect((await standIn.prepare(new AbortController().signal)).plan).toEqual(masculineUnavailable("plate_source_modded"));
  // The server offers it only when isolated (server.ts reads it under `state.isolated`).
  expect(readFileSync(resolve(app, "server.ts"), "utf8")).toContain("state.isolated ? testMasculineEyePlate(process.env.XFS_TEST_MASCULINE_PLATE) : null");
});
