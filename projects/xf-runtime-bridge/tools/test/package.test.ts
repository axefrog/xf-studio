// What each package carries (tools/packaging.ts), staged into temporary folders with a stand-in DLL,
// and the test preload that keeps key input off. This file deliberately imports nothing from
// helpers.ts, so the first test proves bunfig.toml's preload ran (RB-41); its scratch folder comes from temp-dir.ts.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tempDir } from "./temp-dir.ts";
import { join, resolve } from "node:path";
import { OLD_PRESETS_FILE, PANEL_FILE, PLUGIN_DIR, PRESETS_FILE, stageVariant, variantConfig, VARIANTS, type Variant } from "../packaging.ts";

const projectDir = resolve(import.meta.dir, "..", "..");

describe("test preload", () => {
  test("key input is off in every test process, before any test file sets it itself", () => {
    expect(process.env.XFB_NO_INPUT).toBe("1");
    expect(readFileSync(join(projectDir, "bunfig.toml"), "utf8")).toMatch(/preload\s*=\s*\[\s*"\.\/tools\/test\/preload\.ts"\s*,\s*"\.\/tools\/test\/temp-dir-sweep\.ts"\s*\]/);
  });
});

describe("packages", () => {
  const work = tempDir("xfb-package-");
  const dll = join(work, "XFRuntimeBridge.dll");
  writeFileSync(dll, "stand-in DLL XFB_BUILD=0000000000000000000000000000000000000000;dirty=0");
  writeFileSync(join(work, "xfb_companion_probe.exe"), "stand-in companion probe");
  const staged = Object.fromEntries(
    VARIANTS.map((variant) => {
      const stageDir = join(work, variant);
      const manifest = stageVariant({ projectDir, variant, dll, stageDir, version: "0.0.0", commit: "0".repeat(40) });
      return [variant, { stageDir, manifest, config: readFileSync(join(stageDir, PLUGIN_DIR, "config.ini"), "utf8") }];
    }),
  ) as Record<Variant, { stageDir: string; manifest: ReturnType<typeof stageVariant>; config: string }>;

  test("0.8.7: only the -writes package carries the test probes (their scripts and the companion), the others none of them", () => {
    const probeFiles = (variant: Variant) => staged[variant].manifest.files.map((f) => f.path).filter((p) => /XFRuntimeBridgeProbe|xfb_companion_probe/.test(p));
    expect(probeFiles("default")).toEqual([]);
    expect(probeFiles("diagnostic")).toEqual([]);
    expect(probeFiles("writes").sort()).toEqual(
      [
        `${PLUGIN_DIR}/Scripts/XFRuntimeBridgeProbeEvents.reds`,
        `${PLUGIN_DIR}/Scripts/XFRuntimeBridgeProbePersist.reds`,
        `${PLUGIN_DIR}/Scripts/XFRuntimeBridgeProbeSave.reds`,
        `${PLUGIN_DIR}/xfb_companion_probe.exe`,
      ].sort(),
    );
    expect(staged.writes.manifest.test_probes.length).toBe(3);
    expect(staged.default.manifest.test_probes).toEqual([]);
    expect(staged.diagnostic.manifest.test_probes).toEqual([]);
    expect(staged.writes.config).toMatch(/^allow_test_hooks = true$/m);
    expect(staged.diagnostic.config).toMatch(/^allow_test_hooks = false$/m);
  });

  test("the default package has the bridge off, no camera presets, no panel, no carrier and every switch off", () => {
    const { stageDir, manifest, config } = staged.default;
    expect(existsSync(join(stageDir, PRESETS_FILE))).toBe(false);
    expect(existsSync(join(stageDir, PANEL_FILE))).toBe(false);
    expect(manifest.files.some((f) => f.path.includes("xf_photo_mode_presets"))).toBe(false);
    expect(manifest.files.some((f) => /live_pose|xfs_live|\.archive/.test(f.path))).toBe(false);
    expect(config).toMatch(/^enabled = false$/m);
    expect(config).toMatch(/^allow_writes = false$/m);
    expect(config).toMatch(/^allow_creator_leave = false$/m);
    expect(config).toMatch(/^allow_live_pose = false$/m);
    expect(config).toMatch(/^allow_test_hooks = false$/m);
    // Every permission switch is off. [ui] (0.5.3) holds display switches only (the ink panel, the CET label, nameplates),
    // which draw nothing while the bridge is off; they are checked separately.
    const [permissions, display = ""] = config.split(/^\[ui\]\s*$/m);
    expect(permissions).not.toMatch(/= true$/m);
    expect(display.split(/^\[log\]/m)[0]).toMatch(/^hud_panel = true\s*$/m);
    expect(manifest).toMatchObject({
      variant: "default",
      bridge_enabled: false,
      allow_writes: false,
      allow_creator_leave: false,
      allow_live_pose: false,
      allow_test_hooks: false,
      photo_mode_presets: null,
      cet_panel: false,
      write_classes: [],
      inventory_writes: false,
    });
  });

  test("the diagnostic package is on and read-only, with the test profile's camera presets", () => {
    const { stageDir, manifest, config } = staged.diagnostic;
    expect(existsSync(join(stageDir, PRESETS_FILE))).toBe(true);
    expect(config).toMatch(/^enabled = true$/m);
    expect(config).toMatch(/^allow_writes = false$/m);
    expect(config).toMatch(/^allow_creator_leave = false$/m);
    expect(config).toMatch(/^allow_live_pose = false$/m);
    expect(config).toMatch(/^allow_test_hooks = false$/m);
    expect(existsSync(join(stageDir, PANEL_FILE))).toBe(true);
    expect(manifest).toMatchObject({ bridge_enabled: true, allow_writes: false, allow_creator_leave: false, allow_live_pose: false, allow_test_hooks: false, cet_panel: true });
  });

  test("only the writes package allows writes and leaving the creator, and says so at the top", () => {
    const { stageDir, manifest, config } = staged.writes;
    expect(existsSync(join(stageDir, PRESETS_FILE))).toBe(true);
    expect(config).toMatch(/^allow_writes = true$/m);
    expect(config).toMatch(/^allow_creator_leave = true$/m);
    expect(config).toMatch(/^allow_live_pose = true$/m);
    expect(config).toMatch(/^allow_test_hooks = true$/m); // 0.8.4: test.save.delay (card row L1), this package only
    expect(config).toContain("THIS COPY ALLOWS WRITES");
    expect(existsSync(join(stageDir, PANEL_FILE))).toBe(true);
    expect(manifest.files.some((f) => /\.archive/.test(f.path))).toBe(false); // the carrier is its own test package
    expect(manifest).toMatchObject({ allow_writes: true, allow_creator_leave: true, allow_live_pose: true, allow_test_hooks: true, cet_panel: true, write_classes: ["photo", "world", "character", "save", "showroom", "player", "npc", "dm"], inventory_writes: false, dm_toolkit: true });
    // Bridge 0.4: saves and loading are allowed; V's inventory is not, until the maintainer approves it.
    expect(config).toMatch(/^allow_write_classes = photo, world, character, save, showroom, player, npc, dm$/m);
  });

  test("only --allow-inventory adds the inventory class to the writes package, and the manifest records it", () => {
    const stageDir = join(work, "writes-inventory");
    const manifest = stageVariant({ projectDir, variant: "writes", dll, stageDir, version: "0.0.0", commit: "0".repeat(40), allowInventory: true });
    expect(readFileSync(join(stageDir, PLUGIN_DIR, "config.ini"), "utf8")).toMatch(/^allow_write_classes = photo, world, character, inventory, save, showroom, player, npc, dm$/m);
    expect(manifest).toMatchObject({ inventory_writes: true, write_classes: ["photo", "world", "character", "inventory", "save", "showroom", "player", "npc", "dm"] });
    const diagnostic = stageVariant({ projectDir, variant: "diagnostic", dll, stageDir: join(work, "diag-inventory"), version: "0.0.0", commit: "0".repeat(40), allowInventory: true });
    expect(diagnostic).toMatchObject({ allow_writes: false, inventory_writes: false, write_classes: [] });
  });

  test("the camera presets are staged so TweakXL reads them last (after another mod's .tweak presets)", () => {
    expect(PRESETS_FILE).toMatch(/\/\^xf_photo_mode_presets\.yaml$/);
    expect(existsSync(join(staged.writes.stageDir, PRESETS_FILE))).toBe(true);
  });

  test("RB-65: the packages with presets tell whoever stages them to remove 0.3.x's presets file, and what the ^ file overrides", () => {
    for (const variant of ["diagnostic", "writes"] as const) {
      const notes = staged[variant].manifest.staging_notes.join(" ");
      expect(notes).toContain(OLD_PRESETS_FILE);
      expect(notes).toContain("std_preset_6..9");
      expect(existsSync(join(staged[variant].stageDir, OLD_PRESETS_FILE))).toBe(false);
    }
    expect(staged.default.manifest.staging_notes).toEqual([]);
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

  test("0.8.12: the live-direction toolkit's scripts ship in the -writes package only, never beside the distribution package's HUD", () => {
    const script = `${PLUGIN_DIR}/Scripts/XFRuntimeBridgeDm.reds`;
    expect(staged.writes.manifest.files.map((f) => f.path)).toContain(script);
    expect(existsSync(join(staged.writes.stageDir, script))).toBe(true);
    for (const variant of ["default", "diagnostic"] as const) {
      expect(staged[variant].manifest.files.map((f) => f.path)).not.toContain(script);
      expect(staged[variant].manifest.dm_toolkit).toBe(false);
      expect(staged[variant].manifest.write_classes).not.toContain("dm");
    }
    const source = readFileSync(join(projectDir, "redscript-dm", "XFRuntimeBridgeDm.reds"), "utf8");
    // The three wraps live there, not in the main scripts every package carries.
    for (const wrap of ["QuestTrackerGameController", "JournalNotificationQueue", "NewHudPhoneGameController"]) {
      expect(source).toContain(`@wrapMethod(${wrap})`);
      for (const name of readdirSync(join(projectDir, "redscript"))) {
        if (name.endsWith(".reds")) expect(readFileSync(join(projectDir, "redscript", name), "utf8"), name).not.toContain(`@wrapMethod(${wrap})`);
      }
    }
  });

  test("the project's own config.ini must keep every switch off", () => {
    // LF as variantConfig reads it (a Windows checkout gives the file CRLF).
    const base = readFileSync(join(projectDir, "native", "config", "config.ini"), "utf8").replace(/\r\n/g, "\n");
    expect(() => variantConfig(base.replace("allow_creator_leave = false", "allow_creator_leave = true"), "default")).toThrow(/allow_creator_leave/);
    expect(() => variantConfig(base.replace("allow_writes = false", "allow_writes = true"), "default")).toThrow(/allow_writes/);
    expect(() => variantConfig(base.replace("enabled = false", "enabled = true"), "default")).toThrow(/enabled/);
    expect(() => variantConfig(base.replace("allow_live_pose = false", "allow_live_pose = true"), "default")).toThrow(/allow_live_pose/);
    // 0.7: the overlay host is off in the project's config and in the default package, on in the test packages.
    expect(() => variantConfig(base.replace(/(\[overlay\]\n(?:;.*\n)*)enabled = false/, "$1enabled = true"), "default")).toThrow(/overlay/);
    expect(variantConfig(base, "default")).toMatch(/\[overlay\]\n(?:;.*\n)*enabled = false/);
    expect(variantConfig(base, "diagnostic")).toMatch(/\[overlay\]\n(?:;.*\n)*enabled = true/);
    expect(variantConfig(base, "writes")).toMatch(/\[bridge\]\n(?:;.*\n)*enabled = true/);
    rmSync(work, { recursive: true, force: true });
  });
});
