// What goes into each XF Runtime Bridge package, apart from zipping and the provenance gate
// (tools/package.ts does both). Kept separate so tools/test/package.test.ts can stage every variant
// into a temporary folder and check its contents without a clean tree or a real build (RB-41).
//
// Layout inside each package (paths relative to the game folder, i.e. an MO2 mod root):
//   red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll
//   red4ext/plugins/XFRuntimeBridge/config.ini
//   red4ext/plugins/XFRuntimeBridge/Scripts/*.reds       (added to redscript by the plugin)
//   r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml     (TweakXL)
//   r6/tweaks/XFRuntimeBridge/^xf_photo_mode_presets.yaml (TweakXL; diagnostic and writes packages only; the
//                                                         "^" makes TweakXL read it last, after other mods' presets)
//   bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/init.lua   (CET)
//   bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/panel.lua  (CET panel; diagnostic and writes packages only)
// The live-pose carrier is a separate test package (tools/live-pose/build-carrier.ts), never in these.
//   red4ext/plugins/XFRuntimeBridge/THIRD_PARTY_NOTICES.txt  (nlohmann/json and RED4ext.SDK, MIT)
//   red4ext/plugins/XFRuntimeBridge/manifest.json        (versions and SHA-256 of every other file)

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export type Variant = "default" | "diagnostic" | "writes";
export const VARIANTS: readonly Variant[] = ["default", "diagnostic", "writes"];
export const SUFFIX: Record<Variant, string> = { default: "", diagnostic: "-diagnostic", writes: "-writes" };
export const DESCRIBE: Record<Variant, string> = {
  default: "bridge OFF",
  diagnostic: "bridge ON, read-only",
  writes: "bridge ON, WRITES ALLOWED (dedicated test profile only)",
};

export const PLUGIN_DIR = "red4ext/plugins/XFRuntimeBridge";
// The leading "^" puts the file in TweakXL's last-priority group, read after every other tweak file
// (TweakXL 1.11.4 src/App/Tweaks/Declarative/TweakImporter.cpp:184-188). Session 3 found the test
// profile's Portrait Enhancer .tweak file overriding the XF presets (its presets 5-9 roll the camera 90
// degrees); read last, the XF values win.
export const PRESETS_FILE = "r6/tweaks/XFRuntimeBridge/^xf_photo_mode_presets.yaml";
/** The presets file's name before 0.4.0; a manual upgrade leaves it behind (RB-65), so staging removes it. */
export const OLD_PRESETS_FILE = "r6/tweaks/XFRuntimeBridge/xf_photo_mode_presets.yaml";
/**
 * What whoever stages a test package must do or know beyond copying its files (RB-65); in the manifest,
 * the README's packaging notes and the test card's restage step.
 */
export const STAGING_NOTES: readonly string[] = [
  `Replace the mod's files rather than copying over them, and make sure ${OLD_PRESETS_FILE} (0.3.x's name) is gone: with both present TweakXL still reads the new file last, but the leftover is confusing.`,
  `${PRESETS_FILE} is read after every other tweak file, so for the whole profile it overrides any other mod's photo_mode.std_preset_6..9 (Portrait Enhancer's among them); stage this package only in the dedicated test profile.`,
];
export const CET_DIR = "bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge";
export const PANEL_FILE = `${CET_DIR}/panel.lua`;

export const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

/** The variant's config.ini, from the project's (which must keep every switch off). */
/**
 * The -writes package's write classes: inventory only with --allow-inventory (the maintainer's approval); showroom (XF Finish
 * Showroom's test heads and lights, bridge 0.5) in every -writes build, which only the dedicated test profile stages.
 */
export const WRITES_CLASSES = (options: { allowInventory?: boolean } = {}) =>
  options.allowInventory ? ["photo", "world", "character", "inventory", "save", "showroom"] : ["photo", "world", "character", "save", "showroom"];

export function variantConfig(base: string, variant: Variant, options: { allowInventory?: boolean } = {}): string {
  let config = base;
  if (/^allow_writes = true$/m.test(config)) throw new Error("native/config/config.ini must keep allow_writes = false");
  if (/^allow_creator_leave = true$/m.test(config)) throw new Error("native/config/config.ini must keep allow_creator_leave = false");
  if (!/^allow_live_pose = false$/m.test(config)) throw new Error("native/config/config.ini must keep allow_live_pose = false");
  if (!/^enabled = false$/m.test(config)) throw new Error("native/config/config.ini must keep enabled = false");
  if (variant !== "default") {
    config = config.replace(/^enabled = false$/m, "enabled = true");
    if (!/^enabled = true$/m.test(config)) throw new Error(`${variant} config did not enable the bridge`);
  }
  if (variant === "writes") {
    config = config.replace(/^allow_writes = false$/m, "allow_writes = true");
    if (!/^allow_writes = true$/m.test(config)) throw new Error("writes config did not allow writes");
    if (!/^allow_write_classes = photo, world, character$/m.test(config)) throw new Error("the project's config.ini must list photo, world and character");
    // Bridge 0.4: manual saves and loading (the maintainer's request after session 3) join the three classes.
    // The inventory class stays off: it needs the maintainer's approval, and the coordinator adds it to the
    // staged config.ini (or packages with --allow-inventory) only once given.
    config = config.replace(/^allow_write_classes = photo, world, character$/m, `allow_write_classes = ${WRITES_CLASSES(options).join(", ")}`);
    // Approved for the test profile (26 September 2026): the bridge may press Confirm and Back in the
    // character creator, in sessions that end by loading the safety save.
    config = config.replace(/^allow_creator_leave = false$/m, "allow_creator_leave = true");
    if (!/^allow_creator_leave = true$/m.test(config)) throw new Error("writes config did not allow leaving the creator");
    // The live-posing experiment (research/animation/pose-editor-design.md §7.4, question Q6's default):
    // writing the XF carrier clip's keys, in the test profile only, with the separate carrier test package.
    config = config.replace(/^allow_live_pose = false$/m, "allow_live_pose = true");
    if (!/^allow_live_pose = true$/m.test(config)) throw new Error("writes config did not allow the live-pose carrier");
    const warning = "; THIS COPY ALLOWS WRITES: stage it only in the dedicated XF test MO2 profile, never an everyday one.";
    config = config.replace(/^(\[bridge\])$/m, `${warning}\n$1`);
    if (!config.includes(warning)) throw new Error("writes config lost its warning");
  }
  return config;
}

export type StageOptions = {
  projectDir: string;
  variant: Variant;
  /** The DLL to package (build/Release/XFRuntimeBridge.dll; tests pass a stand-in). */
  dll: string;
  stageDir: string;
  version: string;
  /** The commit the DLL was built from (its build marker). */
  commit: string;
  /** -writes only: also allow the inventory write class (only with the maintainer's approval). */
  allowInventory?: boolean;
};

export type StagedFile = { path: string; bytes: number; sha256: string };
export type Manifest = {
  name: string;
  version: string;
  variant: Variant;
  bridge_enabled: boolean;
  allow_writes: boolean;
  write_classes: string[];
  /** Whether inventory.equip / inventory.unequip can run (the inventory write class); needs the maintainer's approval. */
  inventory_writes: boolean;
  allow_creator_leave: boolean;
  allow_live_pose: boolean;
  photo_mode_presets: string | null;
  /** Steps and consequences for staging by hand (RB-65); empty for the default package, which carries no presets. */
  staging_notes: string[];
  cet_panel: boolean;
  commit: string;
  source_tree_clean: true;
  built_for: Record<string, string>;
  files: StagedFile[];
};

/** Writes one variant's install layout into stageDir (emptied first) and returns its manifest. */
export function stageVariant(options: StageOptions): Manifest {
  const { projectDir, variant, dll, stageDir } = options;
  rmSync(stageDir, { recursive: true, force: true });
  const put = (from: string, to: string) => {
    const target = join(stageDir, to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(from, target);
  };

  put(dll, `${PLUGIN_DIR}/XFRuntimeBridge.dll`);
  put(join(projectDir, "native", "THIRD_PARTY_NOTICES.txt"), `${PLUGIN_DIR}/THIRD_PARTY_NOTICES.txt`);
  const config = variantConfig(readFileSync(join(projectDir, "native", "config", "config.ini"), "utf8"), variant, { allowInventory: options.allowInventory });
  mkdirSync(join(stageDir, PLUGIN_DIR), { recursive: true });
  writeFileSync(join(stageDir, PLUGIN_DIR, "config.ini"), config);
  for (const name of readdirSync(join(projectDir, "redscript"))) {
    if (name.endsWith(".reds")) put(join(projectDir, "redscript", name), `${PLUGIN_DIR}/Scripts/${name}`);
  }
  put(join(projectDir, "tweaks", "xf_runtime_bridge.yaml"), "r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml");
  // XF photo-mode camera presets (photo_mode.std_preset_6..9) for repeatable framing: approved for the
  // test profile only (26 September 2026), so only the diagnostic and writes packages carry them;
  // the distribution package must not, since they replace four of the player's presets.
  if (variant !== "default") put(join(projectDir, "tweaks", "test-profile", "xf_photo_mode_presets.yaml"), PRESETS_FILE);
  put(join(projectDir, "cet", "xf_runtime_bridge", "init.lua"), `${CET_DIR}/init.lua`);
  // The in-game panel (reconnect after the kill switch, pause changes): test builds only. Without it the
  // distribution package's CET layer shows its plain status window.
  if (variant !== "default") put(join(projectDir, "cet", "xf_runtime_bridge", "panel.lua"), PANEL_FILE);

  const files = listFiles(stageDir).map((path) => ({
    path: relative(stageDir, path).replaceAll("\\", "/"),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }));
  const manifest: Manifest = {
    name: "XF Runtime Bridge",
    version: options.version,
    variant,
    bridge_enabled: variant !== "default",
    allow_writes: variant === "writes",
    write_classes: variant === "writes" ? WRITES_CLASSES({ allowInventory: options.allowInventory }) : [],
    inventory_writes: variant === "writes" && options.allowInventory === true,
    allow_creator_leave: variant === "writes",
    allow_live_pose: variant === "writes",
    photo_mode_presets: variant !== "default" ? "photo_mode.std_preset_6..9 (XF full body, face, eyes, head and shoulders)" : null,
    staging_notes: variant !== "default" ? [...STAGING_NOTES] : [],
    cet_panel: variant !== "default",
    commit: options.commit, // read from the DLL's build marker; equals HEAD at packaging time
    source_tree_clean: true,
    built_for: {
      game: "2.31 (3.0.80.51928)",
      red4ext: "1.30.0 (SDK 1.0.0)",
      redscript: "0.5.31",
      cet: "1.37.1",
      tweakxl: "1.11.4 (optional; the data marker and the test profile's camera presets need it)",
      codeware: "1.20.5 (optional; only photo.enter's research route needs it)",
    },
    files,
  };
  writeFileSync(join(stageDir, PLUGIN_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
