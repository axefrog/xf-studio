// What each package carries (tools/packaging.ts), staged into temporary folders with a stand-in DLL,
// and the test preload that keeps key input off. This file deliberately imports nothing from
// helpers.ts, so the first test proves bunfig.toml's preload ran (RB-41).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PLUGIN_DIR, PRESETS_FILE, stageVariant, variantConfig, VARIANTS, type Variant } from "../packaging.ts";

const projectDir = resolve(import.meta.dir, "..", "..");

describe("test preload", () => {
  test("key input is off in every test process, before any test file sets it itself", () => {
    expect(process.env.XFB_NO_INPUT).toBe("1");
    expect(readFileSync(join(projectDir, "bunfig.toml"), "utf8")).toMatch(/preload\s*=\s*\[\s*"\.\/tools\/test\/preload\.ts"\s*\]/);
  });
});

describe("packages", () => {
  const work = mkdtempSync(join(tmpdir(), "xfb-package-"));
  const dll = join(work, "XFRuntimeBridge.dll");
  writeFileSync(dll, "stand-in DLL XFB_BUILD=0000000000000000000000000000000000000000;dirty=0");
  const staged = Object.fromEntries(
    VARIANTS.map((variant) => {
      const stageDir = join(work, variant);
      const manifest = stageVariant({ projectDir, variant, dll, stageDir, version: "0.0.0", commit: "0".repeat(40) });
      return [variant, { stageDir, manifest, config: readFileSync(join(stageDir, PLUGIN_DIR, "config.ini"), "utf8") }];
    }),
  ) as Record<Variant, { stageDir: string; manifest: ReturnType<typeof stageVariant>; config: string }>;

  test("the default package has the bridge off, no camera presets and allow_creator_leave off", () => {
    const { stageDir, manifest, config } = staged.default;
    expect(existsSync(join(stageDir, PRESETS_FILE))).toBe(false);
    expect(manifest.files.some((f) => f.path.includes("xf_photo_mode_presets"))).toBe(false);
    expect(config).toMatch(/^enabled = false$/m);
    expect(config).toMatch(/^allow_writes = false$/m);
    expect(config).toMatch(/^allow_creator_leave = false$/m);
    expect(config).not.toMatch(/= true$/m);
    expect(manifest).toMatchObject({ variant: "default", bridge_enabled: false, allow_writes: false, allow_creator_leave: false, photo_mode_presets: null, write_classes: [] });
  });

  test("the diagnostic package is on and read-only, with the test profile's camera presets", () => {
    const { stageDir, manifest, config } = staged.diagnostic;
    expect(existsSync(join(stageDir, PRESETS_FILE))).toBe(true);
    expect(config).toMatch(/^enabled = true$/m);
    expect(config).toMatch(/^allow_writes = false$/m);
    expect(config).toMatch(/^allow_creator_leave = false$/m);
    expect(manifest).toMatchObject({ bridge_enabled: true, allow_writes: false, allow_creator_leave: false });
  });

  test("only the writes package allows writes and leaving the creator, and says so at the top", () => {
    const { stageDir, manifest, config } = staged.writes;
    expect(existsSync(join(stageDir, PRESETS_FILE))).toBe(true);
    expect(config).toMatch(/^allow_writes = true$/m);
    expect(config).toMatch(/^allow_creator_leave = true$/m);
    expect(config).toContain("THIS COPY ALLOWS WRITES");
    expect(manifest).toMatchObject({ allow_writes: true, allow_creator_leave: true, write_classes: ["photo", "world", "character"] });
  });

  test("every package carries the same plugin, scripts and notices, and a manifest hashing each file", () => {
    for (const variant of VARIANTS) {
      const { stageDir, manifest } = staged[variant];
      const paths = manifest.files.map((f) => f.path);
      for (const needed of [`${PLUGIN_DIR}/XFRuntimeBridge.dll`, `${PLUGIN_DIR}/THIRD_PARTY_NOTICES.txt`, `${PLUGIN_DIR}/Scripts/XFRuntimeBridgeActions.reds`, `${PLUGIN_DIR}/config.ini`]) {
        expect(paths, `${variant} ${needed}`).toContain(needed);
      }
      expect(JSON.parse(readFileSync(join(stageDir, PLUGIN_DIR, "manifest.json"), "utf8")).files).toEqual(manifest.files);
    }
  });

  test("the project's own config.ini must keep every switch off", () => {
    const base = readFileSync(join(projectDir, "native", "config", "config.ini"), "utf8");
    expect(() => variantConfig(base.replace("allow_creator_leave = false", "allow_creator_leave = true"), "default")).toThrow(/allow_creator_leave/);
    expect(() => variantConfig(base.replace("allow_writes = false", "allow_writes = true"), "default")).toThrow(/allow_writes/);
    expect(() => variantConfig(base.replace("enabled = false", "enabled = true"), "default")).toThrow(/enabled/);
    rmSync(work, { recursive: true, force: true });
  });
});
