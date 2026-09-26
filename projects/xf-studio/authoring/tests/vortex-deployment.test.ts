import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attributeVortexFile, combineVortexManifests, compareWithDeployment, parseVortexManifest, portableRelPath,
  vortexManifestModType, vortexManifestName, type VortexModIdentity } from "../src/vortex-deployment";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "vortex", name), "utf8");

test("manifest names follow Vortex's per-mod-type rule", () => {
  expect(vortexManifestName()).toBe("vortex.deployment.json");
  expect(vortexManifestName("dinput")).toBe("vortex.deployment.dinput.json");
  expect(vortexManifestModType("vortex.deployment.json")).toBe("");
  expect(vortexManifestModType("Vortex.Deployment.JSON")).toBe("");
  expect(vortexManifestModType("vortex.deployment.dinput.json")).toBe("dinput");
  expect(vortexManifestModType("vortex.deployment.json.x1y2.tmp")).toBeNull();
  expect(vortexManifestModType("vortex.deployment.msgpack")).toBeNull();
  expect(vortexManifestModType("other.json")).toBeNull();
});

test("relative paths become portable virtual paths and never escape", () => {
  expect(portableRelPath("archive\\pc\\mod\\a.archive")).toBe("archive/pc/mod/a.archive");
  expect(portableRelPath(".\\archive/pc/mod//a.xl")).toBe("archive/pc/mod/a.xl");
  expect(portableRelPath("..\\outside.archive")).toBeNull();
  expect(portableRelPath("C:\\abs\\file")).toBeNull();
});

test("parses a Cyberpunk deployment manifest and drops entries Vortex would ignore", () => {
  const manifest = parseVortexManifest(`\uFEFF${fixture("cyberpunk-hardlink.vortex.deployment.json")}`);
  expect(manifest.version).toBe(1);
  expect(manifest.deploymentMethod).toBe("hardlink_activator");
  expect(manifest.gameId).toBe("cyberpunk2077");
  expect(manifest.files.map(file => file.virtualPath)).toEqual([
    "archive/pc/mod/XF Test Shared.archive", "archive/pc/mod/xf_test_a.archive", "archive/pc/mod/xf_test_a.archive.xl",
    "archive/pc/mod/xf_test_b.archive", "bin/x64/plugins/cyber_engine_tweaks/mods/xf_test/init.lua"]);
  expect(manifest.issues).toEqual(["Entry 5 lacks a path, source mod or time; Vortex ignores such entries."]);
  expect(() => parseVortexManifest("[]")).toThrow();
  expect(() => parseVortexManifest(`{"version":1}`)).toThrow();
});

const identities = new Map<string, VortexModIdentity>([
  ["XF Test Mod B-9001-1-0-1727000000", { id: "XF Test Mod B-9001-1-0-1727000000", name: "XF Test Mod B", version: "1.0",
    nexus: { gameDomain: "cyberpunk2077", modId: 9001, fileId: 42 }, source: "nexus", enabled: true }],
  ["XF Test Mod A", { id: "XF Test Mod A", name: "XF Test Mod A", version: null, nexus: null, source: null, enabled: false }],
]);

test("attributes a deployed file to the winning mod, with Vortex's identity when known", () => {
  const deployment = combineVortexManifests([{ fileName: "vortex.deployment.json",
    manifest: parseVortexManifest(fixture("cyberpunk-hardlink.vortex.deployment.json")) }]);
  // The shared file was won by mod B; mod A's copy is not listed at all.
  const shared = attributeVortexFile(deployment, "archive/pc/mod/xf test shared.archive", 1727000000000, identities)!;
  expect(shared.modId).toBe("XF Test Mod B-9001-1-0-1727000000");
  expect(shared.label).toBe("XF Test Mod B");
  expect(shared.identity?.nexus?.modId).toBe(9001);
  expect(shared.state).toBe("deployed");
  // Without state, the staging folder name is the label.
  expect(attributeVortexFile(deployment, "archive/pc/mod/xf_test_a.archive", 1727000000500)?.label).toBe("XF Test Mod A");
  expect(attributeVortexFile(deployment, "archive/pc/mod/xf_test_a.archive", 1727100000000)?.state).toBe("changed");
  expect(attributeVortexFile(deployment, "archive/pc/mod/unmanaged.archive", 0)).toBeNull();
});

test("compares a direct-route scan with the deployment: unmanaged, missing, changed and stale", () => {
  const deployment = combineVortexManifests([{ fileName: "vortex.deployment.json",
    manifest: parseVortexManifest(fixture("cyberpunk-hardlink.vortex.deployment.json")) }]);
  const report = compareWithDeployment(deployment, [
    { virtualPath: "archive/pc/mod/XF Test Shared.archive", modifiedMs: 1727000000000 },
    { virtualPath: "archive/pc/mod/xf_test_a.archive", modifiedMs: 1727000000000 },
    { virtualPath: "archive/pc/mod/xf_test_a.archive.xl", modifiedMs: 1727999999999 },
    { virtualPath: "archive/pc/mod/Hand Installed.archive", modifiedMs: 1 },
    { virtualPath: "archive/pc/content/basegame_1_engine.archive", modifiedMs: 1 },
  ], ["archive/pc/"], identities);
  expect(report.attributed.map(row => row.attribution.modId)).toEqual(["XF Test Mod B-9001-1-0-1727000000", "XF Test Mod A", "XF Test Mod A"]);
  expect(report.unmanaged).toEqual(["archive/pc/content/basegame_1_engine.archive", "archive/pc/mod/Hand Installed.archive"]);
  // xf_test_b.archive is listed but gone; the CET file is outside the scanned folders, so it is not reported missing.
  expect(report.missing).toEqual([{ virtualPath: "archive/pc/mod/xf_test_b.archive", modId: "XF Test Mod B-9001-1-0-1727000000" }]);
  expect(report.changed).toEqual(["XF Test Mod A"]);
  // Mod A is deployed but disabled in the active profile, and mod C is deployed but no longer installed.
  expect(report.stale).toEqual([{ modId: "XF Test Mod A", reason: "disabled" }, { modId: "XF Test Mod C", reason: "not-installed" }]);
  // Without Vortex state no staleness can be judged.
  expect(compareWithDeployment(deployment, [], ["archive/pc/"]).stale).toEqual([]);
});

test("a path listed by two manifests keeps the first and is reported", () => {
  const one = parseVortexManifest(JSON.stringify({ version: 1, instance: "i", files: [{ relPath: "a\\b.archive", source: "M1", time: 1 }] }));
  const two = parseVortexManifest(JSON.stringify({ version: 1, instance: "i", files: [{ relPath: "A/B.archive", source: "M2", time: 1 }] }));
  const combined = combineVortexManifests([{ fileName: "vortex.deployment.json", manifest: one }, { fileName: "vortex.deployment.x.json", manifest: two }]);
  expect(combined.byPath.get("a/b.archive")?.file.source).toBe("M1");
  expect(combined.issues).toHaveLength(1);
  expect(combined.manifests.map(row => row.modType)).toEqual(["", "x"]);
});
