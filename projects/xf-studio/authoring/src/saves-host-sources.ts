/**
 * Where the Save Explorer's host endpoints read from, composed from the host's own settings (both the localhost server and the desktop
 * app use this, handing the result to the feature's handler): the Saved Games folder, the compiled script bundles the launch route
 * actually loads, and the engine type list the Studio ships. A host adapter over the environment, the registry and the settings; it
 * names no feature (the handler's source shape is structural).
 *
 * The game's saves live in `<Saved Games>\CD Projekt Red\Cyberpunk 2077`, where Saved Games is the Windows known folder
 * `FOLDERID_SavedGames` ({4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}). A redirected folder is read from the user's shell folders in the
 * registry (a `REG_EXPAND_SZ` with `%USERPROFILE%`-style variables), else it is `%USERPROFILE%\Saved Games`. No user path is stored:
 * the host resolves it per request, and `XFS_SAVES_DIR` (localhost only) points an isolated server at another folder.
 *
 * Script names follow the game's own resolution, not a mod's name: redscript writes the modded bundle as
 * `r6/cache/final.redscripts.modded` beside the game's `final.redscripts` [source: redscript `scc` at 3ca666c]; under MO2 the winning
 * copy of each file is the overwrite folder's, then the enabled mod with the highest priority, then the game folder (as MO2's virtual
 * file system resolves it). The modded bundle comes first, because it is what the game runs when present.
 */
import { join, win32 } from "node:path";
import { readFileSync } from "node:fs";
import type { LocalSettings } from "./local-settings";
import { parseMo2Modlist } from "./mo2-instance";
import { readConfiguredMo2Instance, createWindowsDetectionHost } from "./install-detection-host";
import { engineTypes } from "./native/rtti-type-source";
import type { EngineTypes } from "./engines/red-object/type-oracle";

export const SHELL_FOLDERS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
const SAVED_GAMES_ID = "{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}";

/** Expand `%NAME%` variables from `env`; null when one is unset. */
export function expandEnvironment(value: string, env: (name: string) => string | undefined): string | null {
  let missing = false;
  const out = value.replace(/%([^%]+)%/g, (_, name: string) => { const found = env(name); if (found === undefined) missing = true; return found ?? ""; });
  return missing ? null : out;
}

/** The Saved Games value from `reg query` output of the shell folders key, or null. */
export function savedGamesFromRegistry(output: string | null): string | null {
  if (!output) return null;
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\{[0-9A-Fa-f-]+\})\s+REG_(?:EXPAND_)?SZ\s+(.+)$/);
    if (match && match[1]!.toUpperCase() === SAVED_GAMES_ID.toUpperCase()) return match[2]!.trim();
  }
  return null;
}

/** The game's saves folder: the override, else the registry's Saved Games, else the profile's; null off Windows or without a profile. */
export async function cyberpunkSavesFolder(host: { platform: string; env(name: string): string | undefined; registry?(key: string): Promise<string | null> },
  override?: string): Promise<string | null> {
  if (override) return override;
  if (host.platform !== "win32") return null;
  const env = (name: string) => host.env(name) ?? host.env(name.toUpperCase());
  const registered = savedGamesFromRegistry(await host.registry?.(SHELL_FOLDERS_KEY).catch(() => null) ?? null);
  const expanded = registered ? expandEnvironment(registered, env) : null;
  const profile = env("USERPROFILE");
  const savedGames = expanded && /^[A-Za-z]:[\\/]/.test(expanded) ? expanded : profile ? win32.join(profile, "Saved Games") : null;
  return savedGames ? win32.join(savedGames, "CD Projekt Red", "Cyberpunk 2077") : null;
}

const BUNDLES = [join("r6", "cache", "final.redscripts.modded"), join("r6", "cache", "final.redscripts")];

/** The folders that can provide a game file, highest priority first: MO2's overwrite and enabled mods (when that is the route), then the game. */
export function gameFileProviders(settings: Pick<LocalSettings, "gameRoot" | "launchRoute" | "mo2Root" | "mo2ProfileId">): string[] {
  const out: string[] = [];
  if (settings.launchRoute === "mo2" && settings.mo2Root && settings.mo2ProfileId) {
    try {
      const instance = readConfiguredMo2Instance(settings.mo2Root);
      const modlist = parseMo2Modlist(readFileSync(join(instance.paths.profiles, settings.mo2ProfileId, "modlist.txt"), "utf8"));
      out.push(instance.paths.overwrite);
      for (const entry of [...modlist.entries].sort((a, b) => b.priority - a.priority))
        if (entry.enabled && entry.kind !== "separator") out.push(join(instance.paths.mods, entry.name));
    } catch { /* An unreadable instance falls back to the game folder alone. */ }
  }
  if (settings.gameRoot) out.push(settings.gameRoot);
  return out;
}

/** The script bundles to try, most effective first: for each bundle name, the first provider that has it. */
export function scriptBundleCandidates(providers: readonly string[], exists: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const bundle of BUNDLES) {
    const winner = providers.map(provider => join(provider, bundle)).find(exists);
    if (winner) out.push(winner);
  }
  return out;
}

/** The saves handler's sources (structurally `SavesHostSources` of features/save-explorer/host/saves-server.ts). */
export type SavesSources = { root(): Promise<string | null>; scriptBundles(): readonly string[]; engine(): EngineTypes };

export function savesHostSources(options: { settings(): LocalSettings; env?: NodeJS.ProcessEnv; allowOverride: boolean; exists(path: string): boolean }): SavesSources {
  const env = options.env ?? process.env;
  const host = createWindowsDetectionHost(env);
  return {
    root: () => cyberpunkSavesFolder(host, options.allowOverride ? env.XFS_SAVES_DIR || undefined : undefined),
    scriptBundles: () => { try { return scriptBundleCandidates(gameFileProviders(options.settings()), options.exists); } catch { return []; } },
    engine: () => engineTypes(),
  };
}
