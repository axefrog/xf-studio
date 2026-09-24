import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defaultLocalSettings } from "../../src/local-settings";
import { LocalSettingsStore } from "../../src/local-settings-store";
import { parseCollection } from "../../src/preset-collection";
import { preparePackageCollection } from "../../src/package-filter";
import { desktopBuildIssue, probeBun, runDesktopBuild, type DesktopPlatePreparer } from "../build";
import { EyePlateError, type EyePlateManifest } from "../../src/eye-plate-service";
import { createDesktopServer } from "../server";

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-build-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const python = spawnSync("python", ["-c", "import sys; print(sys.executable)"],
  { encoding: "utf8" }).stdout.trim();
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

function host(wrapper = "import time; time.sleep(30)\n", toolPlacement: "sibling" | "installed" | "work" = "sibling") {
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
  const files = ["build_collection_package.py", "study/build.py", "study/verify.py", "study/mip_maps.py",
    "study/archive_inventory.py", "app/tools/preflight.js", "app/tools/bake.js"];
  const hashes: Record<string, string> = {};
  for (const name of files) {
    const path = resolve(tools, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, name === files[0] ? wrapper : "# fixture\n");
    hashes[name] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  writeFileSync(resolve(tools, "manifest.json"), JSON.stringify({ schema: "xfs/desktop-build-tools-1", files: hashes }));
  const settings = { ...defaultLocalSettings(), gameRoot: game,
    wolvenKitCli: wk, pythonExecutable: python };
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
  writeFileSync(resolve(h.tools, "study/verify.py"), "tampered");
  expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toContain("integrity");
});

test("installed Electrobun tools may share userData while writable package roots stay separate", () => {
  const installed = host("# fixture\n", "installed");
  expect(desktopBuildIssue(installed.settings, installed.data, installed.tools, fixtureWolvenKit)).toBeNull();
  const overlap = host("# fixture\n", "work");
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
    writeFileSync(resolve(h.tools, "study/verify.py"), "tampered");
    expect((await (await fetch(base + "/api/desktop/capabilities", { headers: { Cookie: cookie } })).json()).packageBuild)
      .toBe(false);
  } finally { app.stop(); }
});

test("a desktop Build deadline stops the process tree and publishes no candidate", async () => {
  const marker = resolve(root, `survived-${crypto.randomUUID()}`);
  const childCode = `import time,pathlib; time.sleep(1); pathlib.Path(${JSON.stringify(marker)}).write_text('survived')`;
  const wrapper = `import subprocess,sys,time\nsubprocess.Popen([sys.executable,'-c',${JSON.stringify(childCode)}])\ntime.sleep(30)\n`;
  const h = host(wrapper);
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
  const h = host(`import pathlib\npathlib.Path(${JSON.stringify(marker)}).write_text('ran')\n`);
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
  const wrapper = `import argparse,hashlib,json,pathlib\n` +
    `p=argparse.ArgumentParser();p.add_argument('--collection');p.add_argument('--dist-root');p.add_argument('--build-root');p.add_argument('--plate');p.add_argument('--plate-manifest');a,_=p.parse_known_args()\n` +
    `assert json.loads(pathlib.Path(a.plate_manifest).read_text())['cacheKey']=='${"2".repeat(64)}' and pathlib.Path(a.plate).is_dir()\n` +
    `work=pathlib.Path(a.build_root);work.mkdir(parents=True);(work/'private-intermediate').write_text('fixture')\n` +
    `final=pathlib.Path(a.dist_root)/'candidate-fixture';payload=final/'archive/pc/mod';payload.mkdir(parents=True)\n` +
    `m=json.loads(${JSON.stringify(JSON.stringify(manifest))});m['collectionSha256']=hashlib.sha256(pathlib.Path(a.collection).read_bytes()).hexdigest()\n` +
    files.map(([name, bytes]) => `(payload/${JSON.stringify(name)}).write_bytes(bytes.fromhex(${JSON.stringify(bytes.toString("hex"))}))\n`).join("") +
    `(final/'manifest.json').write_text(json.dumps(m))\n` +
    `print('XFS_PACKAGE_RESULT='+json.dumps({'package':str(final),'manifest':str(final/'manifest.json'),` +
    `'modName':m['modName'],'selectorLabel':m['selectorLabel'],` +
    `'archiveSha256':m['files'][0]['sha256'],'presetCount':m['verifiedPresetCount'],` +
    `'originalPresetCount':m['originalPresetCount'],'omissions':m['omissions'],` +
    `'packagedCollectionSha256':m['packagedCollectionSha256'],'plate':m['plate'],'installed':False,'gameRenderingVerified':False}))\n`;
  const h = host(wrapper);
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
