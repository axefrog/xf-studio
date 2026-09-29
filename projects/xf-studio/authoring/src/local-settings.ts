import { isAbsolute, normalize, resolve } from "node:path";
import { EYE_PLATE_HEAD_CHOICES, type EyePlateHead } from "./eye-plate-head-choice";

export const LOCAL_SETTINGS_SCHEMA = "xfs/local-settings-1" as const;
export type LaunchRoute = "direct" | "mo2";
export type InstallMode = "none" | "direct" | "mo2";
export type UpdateChannel = "stable" | "canary";
export type { EyePlateHead } from "./eye-plate-head-choice";

/** Private host configuration. Never embed this object in a recipe, collection or package manifest. */
export interface LocalSettings {
  schema: typeof LOCAL_SETTINGS_SCHEMA;
  revision: number;
  gameRoot: string | null;
  launchRoute: LaunchRoute;
  mo2Root: string | null;
  mo2ProfileId: string | null;
  manualModRoot: string | null;
  wolvenKitCli: string | null;
  sourceCache: { directory: string | null; maxBytes: number };
  preview: { cacheDirectory: string | null; outputDirectory: string | null };
  installMode: InstallMode;
  /**
   * `checkOnStart`: whether XF Studio looks for a newer version when it starts (on by default; Settings › Updates). It replaced
   * `checkAutomatically`, which earlier versions saved as off without anyone choosing it, so that value is dropped rather than kept.
   */
  updates: { channel: UpdateChannel; checkOnStart: boolean };
  /** "base-game" builds with the unmodified head when an installed head mod isn't supported yet. */
  eyePlateHead: EyePlateHead;
  /** Where the game's saves are, when the person chose a folder; null uses the detected Saved Games folder. */
  savesDirectory: string | null;
}

export type LocalSettingsDraft = Omit<LocalSettings, "schema" | "revision">;
export const defaultLocalSettings = (): LocalSettings => ({
  schema: LOCAL_SETTINGS_SCHEMA,
  revision: 0,
  gameRoot: null,
  launchRoute: "direct",
  mo2Root: null,
  mo2ProfileId: null,
  manualModRoot: null,
  wolvenKitCli: null,
  sourceCache: { directory: null, maxBytes: 2 * 1024 ** 3 },
  preview: { cacheDirectory: null, outputDirectory: null },
  installMode: "none",
  updates: { channel: "stable", checkOnStart: true },
  eyePlateHead: "installed",
  savesDirectory: null,
});

const object = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: readonly string[], name: string) => {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw Error(`${name} contains an unsupported field.`);
};
const choice = <T extends string>(value: unknown, choices: readonly T[], name: string): T => {
  if (typeof value !== "string" || !choices.includes(value as T)) throw Error(`${name} is invalid.`);
  return value as T;
};
const path = (value: unknown, name: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      /[\x00-\x1f]/.test(value) || !isAbsolute(value)) throw Error(`${name} must be an absolute path.`);
  return normalize(resolve(value));
};
const profile = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[^\\/.:\x00-\x1f][^\\/:\x00-\x1f]{0,127}$/.test(value) ||
      value === "." || value === ".." || value.trim() !== value || value.endsWith("."))
    throw Error("MO2 profile ID must be a single directory name.");
  return value;
};

/**
 * Fields that earlier Studio versions saved and that are now intentionally ignored.
 * `plateInput` pointed at a private plate folder; the expanded eye plate is now built in.
 * `pythonExecutable` ran the old Python package builder; Build now runs entirely in TypeScript.
 * `bunExecutable` chose the Bun that runs the builder; XF Studio uses its own (a developer can
 * still point the localhost server at another with `XFS_PACKAGE_BUN`).
 */
const RETIRED_FIELDS = ["plateInput", "pythonExecutable", "bunExecutable"] as const;
/** `updates.checkAutomatically` was saved as off by default while nothing used it or let anyone change it; `checkOnStart` replaced it. */
const RETIRED_UPDATE_FIELDS = ["checkAutomatically"] as const;

/** Strict parsing is intentional: unknown fields could accidentally persist secrets. */
export function parseLocalSettings(value: unknown): LocalSettings {
  const root = object(value, "Settings");
  keys(root, ["schema", "revision", "gameRoot", "launchRoute", "mo2Root", "mo2ProfileId", "manualModRoot",
    "wolvenKitCli", "sourceCache", "preview", "installMode", "updates", "eyePlateHead", "savesDirectory"], "Settings");
  if (root.schema !== LOCAL_SETTINGS_SCHEMA) throw Error("Unsupported local settings version.");
  if (!Number.isSafeInteger(root.revision) || (root.revision as number) < 0) throw Error("Settings revision is invalid.");
  const cache = object(root.sourceCache, "Source cache");
  keys(cache, ["directory", "maxBytes"], "Source cache");
  if (!Number.isSafeInteger(cache.maxBytes) || (cache.maxBytes as number) < 64 * 1024 ** 2 ||
      (cache.maxBytes as number) > 1024 ** 4) throw Error("Source cache limit must be between 64 MiB and 1 TiB.");
  const preview = object(root.preview, "Preview");
  keys(preview, ["cacheDirectory", "outputDirectory"], "Preview");
  const updates = object(root.updates, "Updates");
  keys(updates, ["channel", "checkOnStart", ...RETIRED_UPDATE_FIELDS], "Updates");
  if (updates.checkOnStart !== undefined && typeof updates.checkOnStart !== "boolean") throw Error("Automatic update check preference is invalid.");
  return {
    schema: LOCAL_SETTINGS_SCHEMA,
    revision: root.revision as number,
    gameRoot: path(root.gameRoot, "Game root"),
    launchRoute: choice(root.launchRoute, ["direct", "mo2"], "Launch route"),
    mo2Root: path(root.mo2Root, "MO2 root"),
    mo2ProfileId: profile(root.mo2ProfileId),
    manualModRoot: path(root.manualModRoot, "Manual mod root"),
    wolvenKitCli: path(root.wolvenKitCli, "WolvenKit CLI"),
    sourceCache: { directory: path(cache.directory, "Source cache directory"), maxBytes: cache.maxBytes as number },
    preview: { cacheDirectory: path(preview.cacheDirectory, "Preview cache directory"),
      outputDirectory: path(preview.outputDirectory, "Preview output directory") },
    installMode: choice(root.installMode, ["none", "direct", "mo2"], "Install mode"),
    updates: { channel: choice(updates.channel, ["stable", "canary"], "Update channel"),
      // Settings saved before this choice existed check at start.
      checkOnStart: updates.checkOnStart === undefined ? true : updates.checkOnStart as boolean },
    // Settings saved before this choice existed use the head the game loads.
    eyePlateHead: root.eyePlateHead === undefined ? "installed" : choice(root.eyePlateHead, EYE_PLATE_HEAD_CHOICES, "Eye plate head"),
    // Settings saved before this choice existed use the detected saves folder.
    savesDirectory: root.savesDirectory === undefined ? null : path(root.savesDirectory, "Saves folder"),
  };
}

/**
 * Migrations: an early flat local draft, and retired fields in the current schema, which are
 * dropped without error (the next save no longer writes them).
 */
export function migrateLocalSettings(value: unknown): { settings: LocalSettings; migrated: boolean } {
  const input = object(value, "Settings");
  if (input.schema === LOCAL_SETTINGS_SCHEMA) {
    const updates = input.updates && typeof input.updates === "object" ? input.updates as Record<string, unknown> : null;
    const retired = [...RETIRED_FIELDS.filter(key => key in input), ...(updates ? RETIRED_UPDATE_FIELDS.filter(key => key in updates) : [])];
    const current = Object.fromEntries(Object.entries(input).filter(([key]) => !(RETIRED_FIELDS as readonly string[]).includes(key)));
    return { settings: parseLocalSettings(current), migrated: retired.length > 0 };
  }
  if (input.schema !== "xfs/local-settings-0") throw Error("Unsupported local settings version.");
  keys(input, ["schema", "gamePath", "mo2Path", "mo2Profile", "platePath", "wolvenKitPath"], "Legacy settings");
  const base = defaultLocalSettings();
  return { migrated: true, settings: parseLocalSettings({ ...base,
    gameRoot: input.gamePath ?? null, mo2Root: input.mo2Path ?? null,
    mo2ProfileId: input.mo2Profile ?? null,
    wolvenKitCli: input.wolvenKitPath ?? null,
    launchRoute: input.mo2Path ? "mo2" : "direct",
  }) };
}
