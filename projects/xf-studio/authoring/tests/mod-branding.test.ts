import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { EYE_MAKEUP_MOD, isEyeMakeupModFolder } from "../src/mod-branding";
import { planCollection } from "../src/preset-collection";
import { preflightPackageCollection } from "../src/package-preflight";
import { createModInstallTransport } from "../src/mod-install-transport";
import { defaultLocalSettings } from "../src/local-settings";

const authoring = resolve(import.meta.dir, "..");
const hq = resolve(authoring, "../../..");
const fixture = JSON.parse(readFileSync(resolve(hq, "experiments/005-preset-collection/editor-collection.json"), "utf8"));

test("the eye-makeup export is branded XF Eye Artistry, distinct from the XF Studio app", () => {
  expect(EYE_MAKEUP_MOD.modName).toBe("XF Eye Artistry");
  expect(EYE_MAKEUP_MOD.selectorLabel).toBe(EYE_MAKEUP_MOD.modName);
  expect(EYE_MAKEUP_MOD.legacyModFolders).toEqual(["XF Studio"]);
  expect(Object.isFrozen(EYE_MAKEUP_MOD) && Object.isFrozen(EYE_MAKEUP_MOD.legacyModFolders)).toBe(true);
  expect(isEyeMakeupModFolder("xf eye artistry") && isEyeMakeupModFolder("XF STUDIO")).toBe(true);
  // The old development selector is a different mod.
  expect(isEyeMakeupModFolder("XF Eye Artistry CCXL - Dev")).toBe(false);
});

test("the selector label, Check result and MO2 install folder all come from the single constant", () => {
  const plan = planCollection(fixture);
  expect(plan.selectorLabel).toBe(EYE_MAKEUP_MOD.selectorLabel);
  expect(plan.modName).toBe(EYE_MAKEUP_MOD.modName);
  // Branding never enters resource identities.
  for (const value of [plan.namespace, plan.selector, plan.component, plan.app, plan.customization])
    expect(value).not.toContain(EYE_MAKEUP_MOD.modName);
  const check = preflightPackageCollection(fixture);
  expect([check.modName, check.selectorLabel]).toEqual([EYE_MAKEUP_MOD.modName, EYE_MAKEUP_MOD.selectorLabel]);

  const root = mkdtempSync(join(tmpdir(), "xfs-branding-"));
  try {
    const game = join(root, "game"), mo2 = join(root, "mo2"), store = join(root, "candidates");
    mkdirSync(join(game, "bin", "x64"), { recursive: true }); mkdirSync(join(game, "archive", "pc"), { recursive: true });
    writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
    mkdirSync(join(mo2, "mods"), { recursive: true }); mkdirSync(join(mo2, "profiles", "Test"), { recursive: true });
    writeFileSync(join(mo2, "profiles", "Test", "modlist.txt"), "");
    mkdirSync(store);
    const settings = { ...defaultLocalSettings(), gameRoot: game, mo2Root: mo2, mo2ProfileId: "Test",
      launchRoute: "mo2" as const, installMode: "mo2" as const };
    const payload = join(store, "c", "archive", "pc", "mod");
    mkdirSync(payload, { recursive: true });
    const files = ["xfs_test.archive", "xfs_test.archive.xl"].map(name => {
      writeFileSync(join(payload, name), name);
      return { path: `archive/pc/mod/${name}`, sha256: createHash("sha256").update(name).digest("hex"), bytes: name.length };
    });
    writeFileSync(join(store, "c", "manifest.json"), JSON.stringify({ schema: "xfs/local-package-1", namespace: "xfs_test",
      verifiedUnpackedFiles: 2, installed: false, gameRenderingVerified: false, files }));
    const transport = createModInstallTransport({ candidateStore: store, receiptsRoot: join(root, "receipts"), settings });
    const preview = transport.preflight("c");
    expect(relative(join(mo2, "mods"), preview.target).split(/[\\/]/)[0]).toBe(EYE_MAKEUP_MOD.modName);
    expect(preview.activation).toContain(EYE_MAKEUP_MOD.modName);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the Python builder and verifiers read branding from the plan instead of keeping a copy", () => {
  const sources = {
    build: readFileSync(resolve(hq, "experiments/005-preset-collection/build.py"), "utf8"),
    verify: readFileSync(resolve(hq, "experiments/005-preset-collection/verify.py"), "utf8"),
    shimmer: readFileSync(resolve(hq, "experiments/011-shimmer-plate-comparison/build.py"), "utf8"),
    wrapper: readFileSync(resolve(authoring, "tools/build_collection_package.py"), "utf8"),
  };
  expect(sources.build).toContain("'localizedName':plan['selectorLabel']");
  expect(sources.verify).toContain("option['localizedName']==plan['selectorLabel']");
  expect(sources.shimmer).toContain("{plan['modName']} Shimmer diagnostic");
  expect(sources.wrapper).toContain("'modName': summary['modName'], 'selectorLabel': summary['selectorLabel']");
  for (const [name, source] of Object.entries(sources))
    expect({ name, literal: /XF (?:Studio|Eye Artistry)['"\s·]/.test(source.replace(/"""[\s\S]*?"""/g, "")) })
      .toEqual({ name, literal: false });
});

test("no TypeScript module outside mod-branding spells the mod name", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|js)$/.test(name) ? [path] : [];
  });
  const offenders = [...files(join(authoring, "src")), ...files(join(authoring, "tools")),
    ...files(join(authoring, "desktop")).filter(file => !/node_modules|build-tools|[\\/]\.hutch[\\/]|[\\/]build[\\/]|[\\/]static[\\/]/.test(file))]
    .filter(file => !file.endsWith("mod-branding.ts"))
    .filter(file => /XF Eye Artistry(?! CCXL - Dev)/.test(readFileSync(file, "utf8")))
    .map(file => relative(authoring, file));
  expect(offenders).toEqual([]);
});
