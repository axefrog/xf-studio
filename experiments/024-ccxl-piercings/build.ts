// Experiment 024: build and verify the scripted CCXL piercing probe "XF Piercings Probe" (see README.md).
//
//   bun experiments/024-ccxl-piercings/build.ts [--resolver-cache ABSOLUTE_DIR]
//
// Heavy (opens the launch route and reads the head morph target): run it under tools/memory_guard.py.
// The game folder, launch route (direct or MO2 profile) and WolvenKit come from XF Studio's saved setup, or
// XFS_RESOLVER_GAME_ROOT / XFS_RESOLVER_MO2_ROOT / XFS_RESOLVER_MO2_PROFILE / XFS_WOLVENKIT_CLI. Read-only towards the
// game and the mod manager: WolvenKit extracts the head, two vanilla piercing banks and the creator resources into this
// experiment's ignored generated/ folder. Output: generated/<run>/package/archive/pc/mod/XF Piercings Probe.archive(.xl)
// and generated/<run>/build.json. Never installs or stages anything.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type CcoResource, readCco } from "../../projects/xf-studio/authoring/src/cco-model";
import { loadCreatorCatalogue } from "../../projects/xf-studio/authoring/src/cc-catalogue-host";
import { ccoPath } from "../../projects/xf-studio/authoring/src/character-resolver";
import { depotHash, refFromPath } from "../../projects/xf-studio/authoring/src/depot-path";
import { createInstalledHeadSource } from "../../projects/xf-studio/authoring/src/eye-plate-head-resolver";
import { createWolvenKitEyePlateTools } from "../../projects/xf-studio/authoring/src/eye-plate-wolvenkit";
import { installations } from "../../projects/xf-studio/authoring/src/installation-registry";
import { LocalSettingsStore } from "../../projects/xf-studio/authoring/src/local-settings-store";
import { createWolvenKitPackageTools } from "../../projects/xf-studio/authoring/src/package-build-wolvenkit";
import { listGeneratedFiles, verifyProductArchive } from "../../projects/xf-studio/authoring/src/platform/export/product-verifier";
import { createWolvenKitVerifierTools } from "../../projects/xf-studio/authoring/src/verifier-wolvenkit";
import { wolvenKitIdentity } from "../../projects/xf-studio/authoring/src/wolvenkit-cli";
import {
  anchorRows, appDocument, BANKS, CUSTOMIZATION, customizationDocument, decodeChunk, DEPOT, HEAD, headWinding, MATERIALS, meshPath,
  MOD_NAME, MORPHS, morphPath, PIECES, pieceMeshDocument, pieceMorphDocument, pieceRenderBlob, plannedPaths, resourceJson, ROWS, rowDelta,
  solvePiece, xlText,
} from "./fixture";
import { type Check, verifyAdditive, verifyResources } from "./verify";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const here = import.meta.dir, generated = join(here, "generated");
const settings = (() => { try { return new LocalSettingsStore().load().settings; } catch { return null; } })();
const gameRoot = process.env.XFS_RESOLVER_GAME_ROOT ?? settings?.gameRoot;
const cli = process.env.XFS_WOLVENKIT_CLI ?? settings?.wolvenKitCli;
const mo2Root = process.env.XFS_RESOLVER_MO2_ROOT ?? (settings?.launchRoute === "mo2" ? settings.mo2Root : null);
const profile = process.env.XFS_RESOLVER_MO2_PROFILE ?? (settings?.launchRoute === "mo2" ? settings.mo2ProfileId : null);
if (!gameRoot || !cli) { console.error("Set the game folder and WolvenKit in XF Studio's setup (or the XFS_RESOLVER_* variables) first."); process.exit(2); }
const cacheDir = resolve(option("resolver-cache") ?? join(generated, "resolver-cache"));
const run = join(generated, new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, ""));
if (existsSync(run)) throw Error(`Run folder exists: ${run}`);
const log = (message: string) => console.error(`[024] ${message}`);
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
const depotFile = (root: string, depot: string) => join(root, ...depot.replaceAll("\\", "/").split("/"));
const started = performance.now();

// 1. The route and what it loads: the head the game is expected to use, the vanilla banks and finishes.
const route = { gameRoot, launchRoute: (mo2Root ? "mo2" : "direct") as "mo2" | "direct", mo2Root, mo2ProfileId: profile, manualModRoot: null, wolvenKitCli: cli };
log(`opening the ${route.launchRoute} route`);
const installation = await installations.acquire({ ...route, cacheDir, log });
const { plan } = await createInstalledHeadSource(route, cacheDir).resolve({ meshDepotPath: HEAD.mesh, morphDepotPath: HEAD.morph });
if (!plan.mesh || !plan.morph) throw Error("The female player head was not found on this route.");
if (plan.patches.length) throw Error(`An .xl patch changes the head (${plan.patches.map(p => p.declaredBy).join(", ")}); this probe does not apply patches.`);
const baseCopy = (depot: string) => {
  const found = installation.depot.lookup(depotHash(depot)).candidates.find(c => c.group === "content" || c.group === "ep1");
  if (!found) throw Error(`No base-game copy of ${depot}.`);
  return { name: found.name, group: found.group, provider: found.providerName, file: found.id };
};
const winner = (depot: string) => {
  const found = installation.depot.lookup(depotHash(depot)).winner;
  return found ? { name: found.name, group: found.group, provider: found.providerName } : null;
};
const materials = Object.fromEntries(Object.entries(MATERIALS).map(([finish, depot]) => [finish, { depot, winner: winner(depot) }]));
for (const [finish, item] of Object.entries(materials)) if (!item.winner) throw Error(`The vanilla ${finish} piercing material is not installed: ${item.depot}`);

// 2. Extract (one WolvenKit call per archive) and serialize.
const wanted = [
  { key: "headMesh", depot: HEAD.mesh, archive: plan.mesh.archive.file, entry: plan.mesh.entryPath },
  { key: "headMorph", depot: HEAD.morph, archive: plan.morph.archive.file, entry: plan.morph.entryPath },
  ...Object.entries(BANKS).map(([key, depot]) => ({ key, depot, archive: baseCopy(depot).file, entry: depot })),
];
const eyeTools = createWolvenKitEyePlateTools(cli), packageTools = createWolvenKitPackageTools(cli);
const byArchive = new Map<string, string[]>();
for (const item of wanted) byArchive.set(item.archive, [...(byArchive.get(item.archive) ?? []), item.entry]);
const sources = join(run, "source"), docs: Record<string, Json> = {}, sourceHashes: Record<string, string> = {};
let archiveIndex = 0;
for (const [archive, entries] of byArchive) {
  const out = join(sources, String(archiveIndex++));
  mkdirSync(out, { recursive: true });
  log(`extracting ${entries.length} resource(s)`);
  await eyeTools.extract({ archive, depotPaths: entries, outDir: out });
  for (const item of wanted.filter(w => w.archive === archive)) {
    const file = depotFile(out, item.entry);
    if (!existsSync(file)) throw Error(`WolvenKit did not extract ${item.entry}.`);
    sourceHashes[item.key] = sha256(readFileSync(file));
    const jsonDir = join(run, "source-json", item.key);
    mkdirSync(jsonDir, { recursive: true });
    docs[item.key] = readJson(await eyeTools.serialize({ file, outDir: jsonDir }));
  }
}

// 3. Solve the pieces and write the resources as WolvenKit JSON.
const headBlob = docs.headMesh.Data.RootChunk.renderResourceBlob.Data;
const head = decodeChunk(headBlob, 0), winding = headWinding(head);
const morphBase = decodeChunk(docs.headMorph.Data.RootChunk.blob.Data.baseBlob.Data, 0);
if (morphBase.count !== head.count || morphBase.positions.some((p, v) => p.some((c, k) => c !== head.positions[v][k])))
  throw Error("The head mesh and the head morph's base geometry differ.");
const banks = { ears: docs.ears.Data.RootChunk.renderResourceBlob.Data, nose: docs.nose.Data.RootChunk.renderResourceBlob.Data };
const pieces = PIECES.map(spec => solvePiece(spec, head, decodeChunk(banks[spec.calibration.bank], spec.calibration.chunk), winding));
const models = join(run, "models-json"), creator = join(run, "creator-json");
for (const dir of [models, creator]) mkdirSync(dir, { recursive: true });
const blobs = new Map(pieces.map(piece => [piece.spec.id, pieceRenderBlob(headBlob, head, piece)]));
for (const piece of pieces)
  writeFileSync(join(models, `${piece.spec.stem}.mesh.json`), resourceJson(pieceMeshDocument(docs.headMesh, blobs.get(piece.spec.id), piece)));
for (const spec of MORPHS)
  writeFileSync(join(models, `${spec.stem}.morphtarget.json`),
    resourceJson(pieceMorphDocument(docs.headMorph, blobs.get(spec.piece), pieces.find(p => p.spec.id === spec.piece)!, spec)));
for (const row of ROWS) writeFileSync(join(creator, `${row.app.slice(row.app.lastIndexOf("/") + 1)}.json`), resourceJson(appDocument(row)));
writeFileSync(join(creator, `${CUSTOMIZATION.slice(CUSTOMIZATION.lastIndexOf("/") + 1)}.json`), resourceJson(customizationDocument()));

// 4. Convert into the staging tree, pack, name the archive and write its declaration.
const staging = join(run, "archive");
const step = async (name: string, go: () => Promise<{ exitCode: number; log: string }>) => {
  const result = await go();
  mkdirSync(join(run, "logs"), { recursive: true });
  writeFileSync(join(run, "logs", `${name}.log`), result.log, "utf8");
  log(`${name} complete`);
};
for (const dir of [depotFile(staging, `${DEPOT}/models`), depotFile(staging, DEPOT)]) mkdirSync(dir, { recursive: true });
await step("deserialize-models", () => packageTools.deserialize(models, depotFile(staging, `${DEPOT}/models`)));
await step("deserialize-creator", () => packageTools.deserialize(creator, depotFile(staging, DEPOT)));
const files = listGeneratedFiles(staging);
if (JSON.stringify(files.map(f => f.path)) !== JSON.stringify(plannedPaths())) throw Error(`Staging holds ${files.map(f => f.path).join(", ")}`);
const packageDir = join(run, "package", "archive", "pc", "mod");
mkdirSync(packageDir, { recursive: true });
await step("pack", () => packageTools.pack(staging, packageDir));
if (readdirSync(packageDir).join() !== "archive.archive") throw Error("WolvenKit did not produce exactly one packed archive.");
const archive = join(packageDir, `${MOD_NAME}.archive`), xl = archive + ".xl";
renameSync(join(packageDir, "archive.archive"), archive);
writeFileSync(xl, xlText(), "utf8");
const archiveSha256 = sha256(readFileSync(archive)), xlSha256 = sha256(readFileSync(xl));

// 5. Verify independently: the product verifier unbundles a copy; every member is serialized again and checked.
const verifierTools = createWolvenKitVerifierTools(cli, gameRoot);
const unpacked = verifyProductArchive({ archive, xl, archiveSha256, files, declaration: xlText(), features: 1, tools: verifierTools, work: join(run, "verify") });
const members = new Map<string, Json>();
for (const file of unpacked.files) {
  const out = join(run, "verify", "json", ...dirname(file.path).split("/"));
  mkdirSync(out, { recursive: true });
  const result = verifierTools.serialize(depotFile(unpacked.root, file.path), out);
  const json = join(out, file.path.slice(file.path.lastIndexOf("/") + 1) + ".json");
  if (result.exitCode !== 0 || !existsSync(json)) throw Error(`WolvenKit could not serialize ${file.path}: ${result.stdout.slice(-800)}`);
  members.set(file.path, readJson(json));
}
const checks: Check[] = verifyResources({ members, xl: unpacked.xl, headMesh: docs.headMesh, headMorph: docs.headMorph, pieces });

log("reading the installed creator resources and labels");
const graph = installation.graph, ep1 = installation.plan.ep1Installed;
const baseRef = refFromPath(ccoPath("female", ep1));
const baseLoaded = await graph.load(baseRef, "inkcharcustomization");
if (!baseLoaded) throw Error("The installed female creator resource was not found.");
const customs: CcoResource[] = [];
for (const custom of graph.xl.customizations.female) {
  const loaded = await graph.load(refFromPath(custom.path), "inkcharcustomization");
  if (loaded) customs.push(readCco(loaded.root, custom.path));
}
const catalogue = (await loadCreatorCatalogue({ installation, gameRoot, wolvenKitCli: cli, cacheDir, log }, "female")).catalogue;
const labels = new Set(catalogue.options.flatMap(o => [o.label.text, ...o.choices.map(c => c.label.text)]).map(l => l.toLowerCase()));
const takenPaths = plannedPaths().filter(p => installation.depot.lookup(depotHash(p)).winner);
checks.push(...verifyAdditive({ base: readCco(baseLoaded.root, "base game"), fix: graph.xl.fixes.get(baseRef.hash), customs, labels, takenPaths },
  readCco(members.get(CUSTOMIZATION).Data.RootChunk, "probe")));

// 6. Record.
const morphHeader = docs.headMorph.Data.RootChunk.blob.Data.header;
const record = {
  experiment: "024-ccxl-piercings", modName: MOD_NAME, depot: DEPOT, bodyGender: "female",
  wolvenKit: wolvenKitIdentity(cli)?.version ?? null,
  route: { launchRoute: route.launchRoute, profile: route.mo2ProfileId, ep1Installed: ep1, customizations: customs.length },
  sources: {
    headMesh: { depot: HEAD.mesh, archive: plan.mesh.archive.name, group: plan.mesh.archive.group, provider: plan.mesh.archive.provider, sha256: sourceHashes.headMesh },
    headMorph: { depot: HEAD.morph, archive: plan.morph.archive.name, group: plan.morph.archive.group, provider: plan.morph.archive.provider, sha256: sourceHashes.headMorph },
    banks: Object.fromEntries(Object.entries(BANKS).map(([key, depot]) => [key, { depot, ...(({ file: _file, ...rest }) => rest)(baseCopy(depot)), sha256: sourceHashes[key] }])),
    materials,
    headWinding: winding,
  },
  pieces: pieces.map(piece => ({
    id: piece.spec.id, site: piece.spec.site, shape: piece.spec.shape, calibration: piece.calibration, anchor: piece.anchor,
    vertices: piece.geometry.positions.length, triangles: piece.geometry.indices.length / 3, boundsMm: piece.boundsMm,
    movingTargets: anchorRows(docs.headMorph, piece.anchor.vertex).map(r => ({ target: r.name, region: r.region,
      deltaMm: rowDelta(morphHeader, r.target, r.row).map(v => Math.round(v * 1e6) / 1e3) })),
  })),
  rows: ROWS,
  resources: unpacked.files,
  archive: { file: `${MOD_NAME}.archive`, bytes: unpacked.archiveBytes, sha256: archiveSha256 },
  xl: { file: `${MOD_NAME}.archive.xl`, sha256: xlSha256, text: xlText() },
  checks, installed: false, staged: false, gameRenderingVerified: false,
  seconds: Math.round((performance.now() - started) / 100) / 10,
};
writeFileSync(join(run, "build.json"), JSON.stringify(record, null, 1) + "\n", "utf8");
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.id}: ${c.detail}`);
console.log(`\narchive ${record.archive.file} ${record.archive.bytes} bytes sha256 ${archiveSha256}\nxl ${record.xl.file} sha256 ${xlSha256}\nrun ${run}`);
if (checks.some(c => !c.ok)) { console.error("Verification failed."); process.exit(1); }
