import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defaultLocalSettings } from "../../src/local-settings";
import { LocalSettingsStore } from "../../src/local-settings-store";
import { parseCollection } from "../../src/preset-collection";
import { preparePackageCollection } from "../../src/package-filter";
import { BUILD_TOOLS_SCHEMA, builderEntry, desktopBuildIssue, probeBun, runDesktopBuild, type DesktopPlatePreparer } from "../build";
import { EyePlateError, type EyePlateManifest } from "../../src/eye-plate-service";
import { createDesktopServer } from "../server";

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-build-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fixture = JSON.parse(readFileSync(resolve(import.meta.dir,
  "../../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const fixtureWolvenKit = () => null;
const plateManifest = { schema: "xfs/eye-plate-cache-1", recipeId: "xfs-expanded-eye-plate", recipeRevision: 1,
  recipeSha256: "1".repeat(64), deriverVersion: 1, cacheKey: "2".repeat(64),
  source: { revisionId: "cp2077-2.31", label: "Cyberpunk 2077 2.31", meshDepotPath: "base\\head.mesh", morphDepotPath: "base\\head.morphtarget",
    meshSha256: "3".repeat(64), morphSha256: "4".repeat(64) },
  files: { mesh: { name: "xfs_eye_plate.mesh", sha256: "5".repeat(64), bytes: 1 }, morph: { name: "xfs_eye_plate.morphtarget", sha256: "6".repeat(64), bytes: 1 } },
  verification: {}, limits: [] } as unknown as EyePlateManifest;
/** Stands in for WolvenKit derivation; records the cache root the host chose. */
const fixturePlate = (seen: string[] = []): DesktopPlatePreparer => async (_settings, cacheRoot) => {
  seen.push(cacheRoot);
  const directory = resolve(cacheRoot, "fixture", "resources");
  mkdirSync(directory, { recursive: true });
  const manifestFile = resolve(cacheRoot, "fixture", "plate-manifest.json");
  writeFileSync(manifestFile, JSON.stringify(plateManifest));
  return { directory, meshFile: resolve(directory, "xfs_eye_plate.mesh"), morphFile: resolve(directory, "xfs_eye_plate.morphtarget"),
    manifestFile, manifest: plateManifest, reused: false };
};

/** The packaged builder is one Bun script; each test supplies a small stand-in for it. */
function host(builder = "await Bun.sleep(30_000);\n", toolPlacement: "sibling" | "installed" | "work" = "sibling") {
  const data = resolve(root, `data-${crypto.randomUUID()}`);
  const tools = toolPlacement === "installed" ? resolve(data, "app/Resources/app/build-tools") :
    toolPlacement === "work" ? resolve(data, "package-work/build-tools") :
      resolve(root, `tools-${crypto.randomUUID()}`);
  const game = resolve(root, `game-${crypto.randomUUID()}`);
  const wk = resolve(root, `wk-${crypto.randomUUID()}.exe`);
  for (const path of [data, tools, game, resolve(game, "bin/x64"), resolve(game, "archive/pc")])
    mkdirSync(path, { recursive: true });
  writeFileSync(resolve(game, "bin/x64/Cyberpunk2077.exe"), "MZ fixture");
  writeFileSync(wk, "MZ fixture");
  const path = resolve(tools, builderEntry);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, builder);
  const hashes = { [builderEntry]: createHash("sha256").update(readFileSync(path)).digest("hex") };
  writeFileSync(resolve(tools, "manifest.json"), JSON.stringify({ schema: BUILD_TOOLS_SCHEMA, files: hashes }));
  const settings = { ...defaultLocalSettings(), gameRoot: game, wolvenKitCli: wk };
  return { data, tools, settings, game };
}

test("Build readiness requires intact packaged tools, configured inputs and disjoint private roots", () => {
  const h = host();
  expect(probeBun(process.execPath)).toBeNull();
  expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toBeNull();
  expect(desktopBuildIssue({ ...h.settings, bunExecutable: h.settings.wolvenKitCli }, h.data, h.tools,
    fixtureWolvenKit)).toContain("cannot run");
  expect(desktopBuildIssue(h.settings, h.data, h.tools, () => "Unsupported CLI version.")).toBe("Unsupported CLI version.");
  expect(desktopBuildIssue({ ...h.settings, mo2Root: h.data }, h.data, h.tools, fixtureWolvenKit)).toContain("overlaps");
  if (process.platform === "win32")
    expect(desktopBuildIssue({ ...h.settings, mo2Root: h.data.toUpperCase() }, h.data, h.tools,
      fixtureWolvenKit)).toContain("overlaps");
  // No plate path exists any more: the built-in plate needs only the game and WolvenKit.
  expect(desktopBuildIssue({ ...h.settings, gameRoot: null }, h.data, h.tools, fixtureWolvenKit)).toContain("game directory");
  try {
    symlinkSync(h.game, resolve(h.data, "package-candidates"), process.platform === "win32" ? "junction" : "dir");
    expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toContain("linked path");
  } catch (error) {
    if (!String(error).includes("EPERM")) throw error;
  }
  writeFileSync(resolve(h.tools, builderEntry), "tampered");
  expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toContain("integrity");
  // The earlier Python tool bundle is no longer accepted.
  writeFileSync(resolve(h.tools, "manifest.json"), JSON.stringify({ schema: "xfs/desktop-build-tools-1", files: {} }));
  expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toContain("incomplete");
});

test("Build readiness needs no Python: a saved Python path is neither required nor checked", () => {
  const h = host();
  expect("pythonExecutable" in h.settings).toBe(false);
  const legacy = { ...h.settings, pythonExecutable: resolve(root, "missing", "python.exe") };
  expect(desktopBuildIssue(legacy, h.data, h.tools, fixtureWolvenKit)).toBeNull();
});

test("installed Electrobun tools may share userData while writable package roots stay separate", () => {
  const installed = host("// fixture\n", "installed");
  expect(desktopBuildIssue(installed.settings, installed.data, installed.tools, fixtureWolvenKit)).toBeNull();
  const overlap = host("// fixture\n", "work");
  expect(desktopBuildIssue(overlap.settings, overlap.data, overlap.tools, fixtureWolvenKit)).toContain("overlaps");
});

test("desktop capabilities and Local setup enable Build only for validated host inputs", async () => {
  const h = host();
  new LocalSettingsStore(h.data).save(h.settings, 0);
  const staticRoot = resolve(root, `static-${crypto.randomUUID()}`);
  mkdirSync(staticRoot);
  writeFileSync(resolve(staticRoot, "index.html"), "<!doctype html><title>fixture</title>");
  const app = createDesktopServer(staticRoot, h.data,
    { version: "0.0.1", channel: "dev", buildHash: "fixture", metadataStatus: "ready" },
    undefined, h.tools, fixtureWolvenKit);
  try {
    const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
    const base = `http://127.0.0.1:${app.port}`;
    expect((await (await fetch(base + "/api/desktop/capabilities", { headers: { Cookie: cookie } })).json()).packageBuild)
      .toBe(true);
    expect((await (await fetch(base + "/api/local-settings", { headers: { Cookie: cookie } })).json()).readiness.build.ready)
      .toBe(true);
    writeFileSync(resolve(h.tools, builderEntry), "tampered");
    expect((await (await fetch(base + "/api/desktop/capabilities", { headers: { Cookie: cookie } })).json()).packageBuild)
      .toBe(false);
  } finally { app.stop(); }
});

test("a desktop Build deadline stops the process tree and publishes no candidate", async () => {
  const marker = resolve(root, `survived-${crypto.randomUUID()}`);
  // The builder starts a grandchild (as it starts WolvenKit); stopping the tree must stop both.
  const childCode = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 1000);`;
  const h = host(`Bun.spawn([process.execPath, "-e", ${JSON.stringify(childCode)}]);\nawait Bun.sleep(30_000);\n`);
  const result = await runDesktopBuild(fixture, h.settings, h.data, h.tools, 400, undefined, fixtureWolvenKit, fixturePlate());
  expect(result).toMatchObject({ kind: "failure", code: "package_build_timeout" });
  await Bun.sleep(1200);
  expect(existsSync(marker)).toBe(false);
  expect(existsSync(resolve(h.data, "package-candidates"))).toBe(false);
});

test("an invalid collection is refused before starting the builder", async () => {
  const h = host();
  const seen: string[] = [];
  const result = await runDesktopBuild({ collectionPath: h.game }, h.settings, h.data, h.tools, 100,
    undefined, fixtureWolvenKit, fixturePlate(seen));
  expect(result).toMatchObject({ kind: "failure", code: "invalid_collection" });
  expect(seen).toEqual([]);
});

test("an unsupported game head stops Build with its explanation before the builder starts", async () => {
  const marker = resolve(root, `wrapper-${crypto.randomUUID()}`);
  const h = host(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
  const unsupported: DesktopPlatePreparer = async () => {
    throw new EyePlateError("plate_source_unsupported", "Update XF Studio to a version that supports your game.");
  };
  const result = await runDesktopBuild(fixture, h.settings, h.data, h.tools, 3000, undefined, fixtureWolvenKit, unsupported);
  expect(result).toEqual({ kind: "failure", code: "plate_source_unsupported", message: "Update XF Studio to a version that supports your game." });
  expect(existsSync(marker)).toBe(false);
  const slow: DesktopPlatePreparer = (_settings, _cache, signal) => new Promise((_, reject) =>
    signal.addEventListener("abort", () => reject(new EyePlateError("plate_cancelled", "cancelled"))));
  expect(await runDesktopBuild(fixture, h.settings, h.data, h.tools, 200, undefined, fixtureWolvenKit, slow))
    .toMatchObject({ kind: "failure", code: "package_build_timeout" });
  const cancel = new AbortController();
  const pending = runDesktopBuild(fixture, h.settings, h.data, h.tools, 3000, cancel.signal, fixtureWolvenKit, slow);
  cancel.abort();
  expect(await pending).toMatchObject({ kind: "failure", code: "package_build_cancelled" });
});

test("a matching staged result is promoted with partial-export identities and no install", async () => {
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  const parsed = parseCollection(collection);
  const prepared = preparePackageCollection(parsed);
  const namespace = prepared.plan.namespace;
  const archive = Buffer.from("archive fixture");
  const xl = Buffer.from("xl fixture");
  const files = [[`${namespace}.archive`, archive], [`${namespace}.archive.xl`, xl]] as const;
  const manifest = { schema: "xfs/local-package-1", collectionId: parsed.id,
    packagedCollectionSha256: createHash("sha256").update(JSON.stringify(prepared.packaged)).digest("hex"),
    originalPresetCount: parsed.presets.length, omissions: prepared.omissions, namespace,
    modName: prepared.plan.modName, selectorLabel: prepared.plan.selectorLabel,
    presets: prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance })),
    verifiedPresetCount: prepared.packaged.presets.length,
    files: files.map(([name, bytes]) => ({ path: `archive/pc/mod/${name}`, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") })),
    plate: { source: "derived", recipeId: plateManifest.recipeId, recipeRevision: plateManifest.recipeRevision,
      sourceRevision: plateManifest.source.revisionId, cacheKey: plateManifest.cacheKey,
      meshSha256: plateManifest.files.mesh.sha256, morphSha256: plateManifest.files.morph.sha256 },
    installed: false, gameRenderingVerified: false };
  // A stand-in builder that writes a matching staged candidate, as the real one does after verification.
  const builder = [
    `const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");`,
    `const arg = name => process.argv[process.argv.indexOf(name) + 1];`,
    `if (JSON.parse(fs.readFileSync(arg("--plate-manifest"), "utf8")).cacheKey !== ${JSON.stringify("2".repeat(64))} ||`,
    `  !fs.statSync(arg("--plate")).isDirectory() || arg("--app-root") !== ${JSON.stringify("TOOLS")}) process.exit(3);`,
    `fs.mkdirSync(arg("--build-root"), { recursive: true });`,
    `fs.writeFileSync(path.join(arg("--build-root"), "private-intermediate"), "fixture");`,
    `const final = path.join(arg("--dist-root"), "candidate-fixture"), payload = path.join(final, "archive", "pc", "mod");`,
    `fs.mkdirSync(payload, { recursive: true });`,
    `const m = ${JSON.stringify(manifest)};`,
    `m.collectionSha256 = createHash("sha256").update(fs.readFileSync(arg("--collection"))).digest("hex");`,
    ...files.map(([name, bytes]) => `fs.writeFileSync(path.join(payload, ${JSON.stringify(name)}), Buffer.from(${JSON.stringify(bytes.toString("hex"))}, "hex"));`),
    `fs.writeFileSync(path.join(final, "manifest.json"), JSON.stringify(m));`,
    `console.log("XFS_PACKAGE_RESULT=" + JSON.stringify({ package: final, manifest: path.join(final, "manifest.json"),`,
    `  modName: m.modName, selectorLabel: m.selectorLabel, archiveSha256: m.files[0].sha256, presetCount: m.verifiedPresetCount,`,
    `  originalPresetCount: m.originalPresetCount, omissions: m.omissions, packagedCollectionSha256: m.packagedCollectionSha256,`,
    `  plate: m.plate, installed: false, gameRenderingVerified: false }));`,
  ].join("\n");
  // The tools root is only known once the host exists; substitute it into the builder afterwards.
  const h = host("// placeholder\n");
  const entry = resolve(h.tools, builderEntry);
  writeFileSync(entry, builder.replace(JSON.stringify("TOOLS"), JSON.stringify(h.tools)));
  writeFileSync(resolve(h.tools, "manifest.json"), JSON.stringify({ schema: BUILD_TOOLS_SCHEMA,
    files: { [builderEntry]: createHash("sha256").update(readFileSync(entry)).digest("hex") } }));
  const seen: string[] = [];
  const result = await runDesktopBuild(collection, h.settings, h.data, h.tools, 3000,
    undefined, fixtureWolvenKit, fixturePlate(seen));
  expect(seen).toEqual([resolve(h.data, "plate-cache")]);
  expect(result.kind).toBe("success");
  if (result.kind !== "success") return;
  expect(result.result.omissions).toEqual(prepared.omissions);
  expect(result.result.package).toStartWith(resolve(h.data, "package-candidates"));
  expect(existsSync(result.result.manifest)).toBe(true);
  expect(result.result.installed).toBe(false);
  expect(readdirSync(resolve(h.data, "package-work"))).toEqual([]);
});

test("Build readiness turns green once XF Studio's own WolvenKit is downloaded, and official pages open by name", async () => {
  const { makeZip } = await import("../../tests/zip-fixture");
  const { WOLVENKIT_RELEASE } = await import("../../src/wolvenkit-release");
  const files = { "WolvenKit.CLI.exe": "MZ fixture launcher", "WolvenKit.CLI.dll": "MZ fixture entry",
    "WolvenKit.CLI.runtimeconfig.json": JSON.stringify({ runtimeOptions: { framework: { name: "Microsoft.NETCore.App", version: "10.0.0" } } }) };
  const zip = makeZip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const feed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(new Blob([new Uint8Array(zip)])) });
  const h = host();
  const opened: string[] = [];
  const view = resolve(root, `static-${crypto.randomUUID()}`);
  mkdirSync(view, { recursive: true });
  writeFileSync(resolve(view, "index.html"), "<!doctype html><title>Studio</title>");
  const app = createDesktopServer(view, h.data, { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" },
    undefined, h.tools, fixtureWolvenKit, undefined, undefined, {
      openExternal: url => { opened.push(url); return true; },
      wolvenKit: { platform: "win32", findExisting: () => null, probeAfterInstall: false,
        dotnet: () => ({ root: "C:\dotnet", source: "default", frameworks: { "Microsoft.NETCore.App": ["10.0.12"] } }),
        release: { ...WOLVENKIT_RELEASE, url: `http://127.0.0.1:${feed.port}/wk.zip`, archiveBytes: zip.length, archiveSha256: sha(zip),
          files: 3, installedBytes: Object.values(files).reduce((sum, value) => sum + value.length, 0),
          executableSha256: sha(files["WolvenKit.CLI.exe"]), entryDllSha256: sha(files["WolvenKit.CLI.dll"]) } } });
  try {
    new LocalSettingsStore(h.data).save({ ...defaultLocalSettings(), gameRoot: h.game }, 0);
    const base = `http://127.0.0.1:${app.port}`;
    const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0]!;
    const read = { Cookie: cookie }, write = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
    const readiness = async () => (await (await fetch(base + "/api/local-settings", { headers: read })).json()).readiness.build;
    const before = await readiness();
    expect(before.ready).toBe(false);
    expect(before.issues.map((issue: { code: string }) => issue.code)).toEqual(["wolvenkit_unset"]);
    expect(before.issues[0].reason).toContain("download it for you");
    expect((await (await fetch(base + "/api/desktop/capabilities", { headers: read })).json()).packageBuild).toBe(false);
    expect((await fetch(base + "/api/desktop/wolvenkit")).status).toBe(403);
    expect(await (await fetch(base + "/api/desktop/wolvenkit", { headers: read })).json()).toMatchObject({ phase: "available", canInstall: true });
    const started = await fetch(base + "/api/desktop/wolvenkit", { method: "POST", headers: write,
      body: JSON.stringify({ action: "install", version: WOLVENKIT_RELEASE.version }) });
    expect(started.status).toBe(202);
    await app.wolvenKit.settled();
    expect(await (await fetch(base + "/api/desktop/wolvenkit", { headers: read })).json()).toMatchObject({ phase: "ready", source: "managed" });
    expect(await readiness()).toMatchObject({ ready: true, issues: [] });
    expect((await (await fetch(base + "/api/desktop/capabilities", { headers: read })).json()).packageBuild).toBe(true);
    // The saved settings still name no WolvenKit: the managed copy is a default, not a user choice.
    expect(new LocalSettingsStore(h.data).load().settings.wolvenKitCli).toBeNull();
    expect(existsSync(resolve(h.data, "tools", "wolvenkit", WOLVENKIT_RELEASE.version, "WolvenKit.CLI.exe"))).toBe(true);
    const open = (body: unknown) => fetch(base + "/api/desktop/open-link", { method: "POST", headers: write, body: JSON.stringify(body) });
    expect((await open({ link: "wolvenkit-licence" })).status).toBe(204);
    expect((await open({ link: "https://evil.example" })).status).toBe(400);
    expect((await open({ link: "wolvenkit-licence", url: "https://evil.example" })).status).toBe(400);
    expect(opened).toEqual([WOLVENKIT_RELEASE.licence.url]);
  } finally { app.stop(); feed.stop(true); }
});
