/**
 * Who made each installed mod, as its mod manager records it: the Character panel groups a row's choices by maker (cc-panel.ts `groups`,
 * cc-controls backlog 4a). Host-only (reads Vortex's state); the answer is keyed by the provider name the resolver gives each archive,
 * which is the mod name in the creator catalogue's provenance.
 *
 * - **Vortex** records the author it got from Nexus Mods (`attributes.author`, else the uploader) and the mod's own name
 *   (vortex-state.ts). Its state is read only when Vortex deployed into the game folder (`Installation.vortexMods`), within a time budget
 *   (VORTEX-05); what isn't read in time is simply not known.
 * - **Mod Organizer 2 records no author.** Its `meta.ini` holds the Nexus mod and file IDs, version, installation file, repository, URL,
 *   category, notes and the Nexus description, but no author or uploader field [observed: every one of 1,000 `meta.ini` files and 22
 *   download `.meta` files in the reference MO2 instance, 27 September 2026]. An MO2 mod is grouped under its own name.
 * - **A file put in the game folder by hand** has no record at all: those mods share one group, named for where they are.
 */
import type { MountedArchive } from "./archive-precedence";
import type { ModMaker } from "./cc-panel";
import { inspectVortexSetup, type VortexReadOptions, type VortexSetup } from "./vortex-host";

/** The group of mods placed in the game folder without a mod manager. */
export const GAME_FOLDER_MODS = "Installed in the game folder";
/** How long reading Vortex's records may take (the panel's first paint waits for it). */
export const MAKERS_BUDGET_MS = 3000;
const NAME_MAX = 80;

/** A name as the panel shows it: control characters out, trimmed, bounded; null when nothing is left. */
export function makerText(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? [...text].slice(0, NAME_MAX).join("") : null;
}

export type MakerSources = {
  readonly plan: { readonly archives: readonly Pick<MountedArchive, "provider" | "providerName" | "group">[] };
  readonly vortexMods?: ReadonlyMap<string, string>;
};
export type MakerOptions = {
  env?: (name: string) => string | undefined;
  budgetMs?: number;
  now?: () => number;
  /** Vortex's records for the game folder (tests pass their own). */
  inspect?: (gameRoot: string, env: (name: string) => string | undefined, options: VortexReadOptions) => Promise<Pick<VortexSetup, "state">>;
};

/** Every mod's maker that its mod manager records, by provider name (a mod with nothing recorded is absent). */
export async function modMakers(installation: MakerSources, gameRoot: string, options: MakerOptions = {}): Promise<Map<string, ModMaker>> {
  const makers = new Map<string, ModMaker>();
  const vortex = installation.vortexMods ?? new Map<string, string>();
  for (const archive of installation.plan.archives)
    if (archive.provider === "game" && archive.group === "mod" && !vortex.has(archive.providerName)) makers.set(archive.providerName, { author: null, name: GAME_FOLDER_MODS });
  if (!vortex.size) return makers;
  const now = options.now ?? Date.now, env = options.env ?? (name => process.env[name]);
  const setup = await (options.inspect ?? inspectVortexSetup)(gameRoot, env, { deadline: now() + (options.budgetMs ?? MAKERS_BUDGET_MS), now });
  const identities = setup.state?.game.mods;
  if (!identities) return makers;
  for (const [provider, modId] of vortex) {
    const identity = identities.get(modId);
    if (identity) makers.set(provider, { author: makerText(identity.author), name: makerText(identity.name) });
  }
  return makers;
}
