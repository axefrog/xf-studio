import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defaultLocalSettings } from "../../src/local-settings";
import { LocalSettingsStore } from "../../src/local-settings-store";
import { parseCollection } from "../../src/preset-collection";
import { preparePackageCollection } from "../../src/package-filter";
import { desktopBuildIssue, runDesktopBuild } from "../build";
import { createDesktopServer } from "../server";

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-build-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const python = spawnSync("python", ["-c", "import sys; print(sys.executable)"],
  { encoding: "utf8" }).stdout.trim();
const fixture = JSON.parse(readFileSync(resolve(import.meta.dir,
  "../../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const fixtureWolvenKit = () => null;

function host(wrapper = "import time; time.sleep(30)\n") {
  const data = resolve(root, `data-${crypto.randomUUID()}`);
  const tools = resolve(root, `tools-${crypto.randomUUID()}`);
  const game = resolve(root, `game-${crypto.randomUUID()}`);
  const plate = resolve(root, `plate-${crypto.randomUUID()}`);
  const wk = resolve(root, `wk-${crypto.randomUUID()}.exe`);
  for (const path of [data, tools, game, plate, resolve(game, "bin/x64"), resolve(game, "archive/pc")])
    mkdirSync(path, { recursive: true });
  writeFileSync(resolve(game, "bin/x64/Cyberpunk2077.exe"), "MZ fixture");
  writeFileSync(wk, "MZ fixture");
  for (const name of ["xfas_eye_plate.mesh", "xfas_eye_plate.morphtarget"])
    writeFileSync(resolve(plate, name), "CR2W fixture");
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
  const settings = { ...defaultLocalSettings(), gameRoot: game, plateInput: plate,
    wolvenKitCli: wk, pythonExecutable: python };
  return { data, tools, settings, game };
}

test("Build readiness requires intact packaged tools, configured inputs and disjoint private roots", () => {
  const h = host();
  expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toBeNull();
  expect(desktopBuildIssue(h.settings, h.data, h.tools, () => "Unsupported CLI version.")).toBe("Unsupported CLI version.");
  expect(desktopBuildIssue({ ...h.settings, mo2Root: h.data }, h.data, h.tools, fixtureWolvenKit)).toContain("overlaps");
  expect(desktopBuildIssue({ ...h.settings, plateInput: null }, h.data, h.tools, fixtureWolvenKit)).toContain("plate");
  try {
    symlinkSync(h.game, resolve(h.data, "package-candidates"), process.platform === "win32" ? "junction" : "dir");
    expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toContain("linked path");
  } catch (error) {
    if (!String(error).includes("EPERM")) throw error;
  }
  writeFileSync(resolve(h.tools, "study/verify.py"), "tampered");
  expect(desktopBuildIssue(h.settings, h.data, h.tools, fixtureWolvenKit)).toContain("integrity");
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
  const result = await runDesktopBuild(fixture, h.settings, h.data, h.tools, 400, undefined, fixtureWolvenKit);
  expect(result).toMatchObject({ kind: "failure", code: "package_build_timeout" });
  await Bun.sleep(1200);
  expect(existsSync(marker)).toBe(false);
  expect(existsSync(resolve(h.data, "package-candidates"))).toBe(false);
});

test("an invalid collection is refused before starting the builder", async () => {
  const h = host();
  const result = await runDesktopBuild({ collectionPath: h.game }, h.settings, h.data, h.tools, 100,
    undefined, fixtureWolvenKit);
  expect(result).toMatchObject({ kind: "failure", code: "invalid_collection" });
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
    presets: prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance })),
    verifiedPresetCount: prepared.packaged.presets.length,
    files: files.map(([name, bytes]) => ({ path: `archive/pc/mod/${name}`, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") })),
    installed: false, gameRenderingVerified: false };
  const wrapper = `import argparse,hashlib,json,pathlib\n` +
    `p=argparse.ArgumentParser();p.add_argument('--collection');p.add_argument('--dist-root');a,_=p.parse_known_args()\n` +
    `final=pathlib.Path(a.dist_root)/'candidate-fixture';payload=final/'archive/pc/mod';payload.mkdir(parents=True)\n` +
    `m=json.loads(${JSON.stringify(JSON.stringify(manifest))});m['collectionSha256']=hashlib.sha256(pathlib.Path(a.collection).read_bytes()).hexdigest()\n` +
    files.map(([name, bytes]) => `(payload/${JSON.stringify(name)}).write_bytes(bytes.fromhex(${JSON.stringify(bytes.toString("hex"))}))\n`).join("") +
    `(final/'manifest.json').write_text(json.dumps(m))\n` +
    `print('XFS_PACKAGE_RESULT='+json.dumps({'package':str(final),'manifest':str(final/'manifest.json'),` +
    `'archiveSha256':m['files'][0]['sha256'],'presetCount':m['verifiedPresetCount'],` +
    `'originalPresetCount':m['originalPresetCount'],'omissions':m['omissions'],` +
    `'packagedCollectionSha256':m['packagedCollectionSha256'],'installed':False,'gameRenderingVerified':False}))\n`;
  const h = host(wrapper);
  const result = await runDesktopBuild(collection, h.settings, h.data, h.tools, 3000,
    undefined, fixtureWolvenKit);
  expect(result.kind).toBe("success");
  if (result.kind !== "success") return;
  expect(result.result.omissions).toEqual(prepared.omissions);
  expect(result.result.package).toStartWith(resolve(h.data, "package-candidates"));
  expect(existsSync(result.result.manifest)).toBe(true);
  expect(result.result.installed).toBe(false);
});
