/**
 * Host adapter for the creator catalogue: loads the effective creator resource through the resolver's installation,
 * the game's and mods' on-screen texts for the player's language, and TweakDB's creator categories and icons, then
 * builds the catalogue (cc-catalogue.ts). All file and process access for the catalogue lives here; read-only towards the
 * game and the mod manager (WolvenKit writes only into the cache folder).
 *
 * - **Language** [resource]: the game's own setting, `/language` → `OnScreen` in
 *   `%LOCALAPPDATA%\CD Projekt Red\Cyberpunk 2077\UserSettings.json` (read by `gameLanguageOf`); English when it can't be read or
 *   `LOCALAPPDATA` is unset. When the game has no text archive for that language, the English texts are used and the catalogue says so
 *   (gap `texts-language-missing`; PIPE-51).
 * - **Texts**: `base\` and (with Phantom Liberty) `ep1\localization\<language>\onscreens\onscreens.json` from their
 *   winning archives, then every `.xl` text declaration in ArchiveXL's load order (game-text.ts `textPlan`). These are CR2W `.json`
 *   resources, which the resolver's fetcher skips by name, so they are extracted here with the same WolvenKit runner into
 *   `<cache>/text/` (only the parsed entries are kept).
 * - **TweakDB**: `r6\cache\tweakdb_ep1.bin` when Phantom Liberty is mounted, else `tweakdb.bin` [hypothesis: the game loads
 *   the EP1 blob when the expansion is installed; both hold the same creator categories in 2.31].
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { buildCatalogue, type BodyGender, type CcCatalogue, iconRecords, readCcoWithPresentation } from "./cc-catalogue";
import { readCreatorPresentation, type CreatorPresentation } from "./cc-presentation";
import type { CharacterSource } from "./character-context";
import { customLabel, loadMergedCco } from "./character-resolver";
import { depotHash } from "./depot-path";
import { writeFileAtomic } from "./derived-cache";
import { gameLanguageOf, readOnscreenEntries, type TextEntry, TextTable, textPlan } from "./game-text";
import type { Installation } from "./resolver-host";
import { TweakDbBlob } from "./tweakdb-flats";
import { runWolvenKit, wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";

export interface CatalogueHostOptions {
  readonly installation: Installation;
  readonly gameRoot: string;
  readonly wolvenKitCli: string;
  readonly cacheDir: string;
  /** A language code (`en-us`); default: the game's own on-screen language. */
  readonly language?: string | null;
  readonly log?: (message: string) => void;
}
export interface CatalogueLoad {
  readonly source: CharacterSource;
  readonly catalogue: CcCatalogue;
  readonly evidence: {
    readonly language: { readonly code: string; readonly from: "option" | "game-settings" | "default" };
    readonly texts: readonly { readonly path: string; readonly archive: string | null; readonly entries: number; readonly kind: "game" | "mod"; readonly replace: boolean }[];
    readonly tweakDb: string | null;
    readonly customResources: number;
  };
}

const STEP_TIMEOUT_MS = 10 * 60_000;

/** The game's settings file, or null when `LOCALAPPDATA` is unset or not absolute (never a path relative to the working folder; PIPE-51). */
export const gameSettingsPath = (localAppData: string | null | undefined = process.env.LOCALAPPDATA): string | null =>
  localAppData && /^(?:[A-Za-z]:[\\/]|\/)/.test(localAppData) ? join(localAppData, "CD Projekt Red", "Cyberpunk 2077", "UserSettings.json") : null;

/** The game's on-screen language from its own settings file, or null when it can't be read. */
export function gameLanguage(settingsPath = gameSettingsPath()): string | null {
  if (!settingsPath) return null;
  try { return gameLanguageOf(JSON.parse(readFileSync(settingsPath, "utf8"))); } catch { return null; }
}

const fingerprint = (path: string) => {
  const stat = statSync(path);
  return createHash("sha256").update(`${path}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 24);
};

/**
 * Entries of CR2W `.json` text resources, from each one's winning archive. Missing resources are absent from the result.
 * Cached per (depot hash, archive fingerprint, WolvenKit identity) as parsed entries only.
 */
export async function readTextResources(installation: Installation, paths: readonly string[], cli: string, cacheDir: string,
  log: (message: string) => void = () => {}): Promise<Map<string, { entries: TextEntry[]; archive: string }>> {
  const tool = createHash("sha256").update(wolvenKitIdentityKey(wolvenKitIdentity(cli))).digest("hex").slice(0, 12);
  const found = new Map<string, { entries: TextEntry[]; archive: string }>();
  const pending = new Map<string, { archive: string; name: string; items: { path: string; hash: string; cache: string }[] }>();
  for (const path of new Set(paths)) {
    const hash = depotHash(path);
    const winner = installation.graph.lookup(hash).winner;
    if (!winner) continue;
    const cache = join(cacheDir, "text", `${hash}-${fingerprint(winner.id)}-${tool}.json`);
    if (existsSync(cache)) {
      try { found.set(path, { entries: JSON.parse(readFileSync(cache, "utf8")).entries, archive: winner.name }); continue; }
      catch { rmSync(cache, { force: true }); }
    }
    const queue = pending.get(winner.id) ?? { archive: winner.id, name: winner.name, items: [] };
    queue.items.push({ path, hash, cache });
    pending.set(winner.id, queue);
  }
  // Archives share one WolvenKit call unless one of them also holds a hash queued from another (outputs would collide).
  const holds = (archive: string, hash: string) => installation.graph.lookup(hash).candidates.some(candidate => candidate.id === archive);
  const batches: (typeof pending extends Map<string, infer Q> ? Q : never)[][] = [];
  for (const queue of pending.values()) {
    const fits = batches.find(batch => batch.length < 64 && batch.every(other =>
      !queue.items.some(item => holds(other.archive, item.hash)) && !other.items.some(item => holds(queue.archive, item.hash))));
    if (fits) fits.push(queue); else batches.push([queue]);
  }
  for (const batch of batches) {
    mkdirSync(join(cacheDir, "tmp"), { recursive: true });
    const dir = mkdtempSync(join(cacheDir, "tmp", `text-${process.pid}-`));
    try {
      const raw = join(dir, "raw");
      mkdirSync(raw, { recursive: true });
      const items = batch.flatMap(queue => queue.items.map(item => ({ ...item, archive: queue.name })));
      writeFileSync(join(dir, "hashes.txt"), [...new Set(items.map(item => item.hash))].join("\n") + "\n");
      log(`WolvenKit: extracting ${items.length} text resource(s) from ${batch.length} archive(s)`);
      await runWolvenKit(cli, ["unbundle", ...batch.map(queue => queue.archive), "-o", raw, "--hash", join(dir, "hashes.txt")],
        { timeoutMs: STEP_TIMEOUT_MS, accept: () => true });
      const files = new Map<string, string>();
      const walk = (folder: string) => {
        for (const name of readdirSync(folder)) {
          const full = join(folder, name);
          if (lstatSync(full).isDirectory()) { walk(full); continue; }
          const rel = relative(raw, full).split(sep).join("\\");
          const numeric = /^(\d+)(?:\.[^.\\]+)?$/.exec(rel);
          if (numeric) {
            // An unnamed output gets the `.json` extension so the converter recognises it.
            const named = full.endsWith(".json") ? full : `${full.replace(/\.[^.\\/]+$/, "")}.json`;
            if (named !== full) renameSync(full, named);
            files.set(BigInt(numeric[1]!).toString(), named);
          } else files.set(depotHash(rel), full);
        }
      };
      walk(raw);
      if (files.size) await runWolvenKit(cli, ["convert", "s", raw], { timeoutMs: STEP_TIMEOUT_MS, accept: () => true, failure: /(?!)/ });
      for (const item of items) {
        const file = files.get(item.hash);
        if (!file || !existsSync(`${file}.json`)) { log(`${item.archive}: ${item.path} could not be converted.`); continue; }
        let entries: TextEntry[];
        try { entries = readOnscreenEntries(JSON.parse(readFileSync(`${file}.json`, "utf8"))); }
        catch { log(`${item.archive}: ${item.path} is not readable text.`); continue; }
        found.set(item.path, { entries, archive: item.archive });
        try { mkdirSync(join(cacheDir, "text"), { recursive: true }); writeFileAtomic(item.cache, JSON.stringify({ path: item.path, archive: item.archive, entries })); }
        catch { /* Advisory: extracted again next time. */ }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return found;
}

/** The on-screen texts the game shows in `language`, with the mods' ArchiveXL text declarations merged in load order. */
export async function loadTextTable(installation: Installation, language: string, cli: string, cacheDir: string, log?: (message: string) => void) {
  const plan = textPlan(language, installation.plan.ep1Installed, installation.xl.localization);
  const read = await readTextResources(installation, plan.map(item => item.path), cli, cacheDir, log);
  const table = new TextTable(language);
  const texts: CatalogueLoad["evidence"]["texts"][number][] = [];
  for (const item of plan) {
    const got = read.get(item.path);
    texts.push({ path: item.path, archive: got?.archive ?? null, entries: got?.entries.length ?? 0, kind: item.kind, replace: item.replace });
    if (got) table.add(got.entries, { id: item.path, kind: item.kind, declaredBy: item.declaredBy }, item.replace);
  }
  return { table: read.size ? table : null, texts };
}

/** The TweakDB blob the installation's game uses, and its creator presentation for these icons. */
export function loadPresentation(gameRoot: string, ep1: boolean, icons: Iterable<string>): CreatorPresentation | null {
  const cache = join(gameRoot, "r6", "cache");
  const name = ep1 && existsSync(join(cache, "tweakdb_ep1.bin")) ? "tweakdb_ep1.bin" : "tweakdb.bin";
  const path = join(cache, name);
  if (!existsSync(path)) return null;
  return readCreatorPresentation(new TweakDbBlob(readFileSync(path)), icons, `r6\\cache\\${name}`);
}

/** Build one body gender's catalogue and the source the character context needs. */
export async function loadCreatorCatalogue(options: CatalogueHostOptions, bodyGender: BodyGender): Promise<CatalogueLoad> {
  const { installation, cacheDir, wolvenKitCli: cli, log } = options;
  const merged = await loadMergedCco(installation.graph, bodyGender, readCcoWithPresentation);
  const settings = options.language ? null : gameLanguage();
  let language: { code: string; from: "option" | "game-settings" | "default" } = { code: options.language ?? settings ?? "en-us",
    from: options.language ? "option" : settings ? "game-settings" : "default" };
  let text = await loadTextTable(installation, language.code, cli, cacheDir, log);
  const languageGaps: { code: string; subject: string; detail: string }[] = [];
  // A language whose game texts aren't installed (no `lang_<code>_text.archive`) shows English, and says so (PIPE-51).
  if (!text.texts.some(item => item.kind === "game" && item.entries > 0) && language.code !== "en-us") {
    languageGaps.push({ code: "texts-language-missing", subject: language.code,
      detail: `The game's ${language.code} texts aren't installed, so the creator's labels are shown in English.` });
    language = { code: "en-us", from: "default" };
    text = await loadTextTable(installation, "en-us", cli, cacheDir, log);
  }
  let presentation: CreatorPresentation | null = null, tweakDb: string | null = null;
  try {
    presentation = loadPresentation(options.gameRoot, installation.plan.ep1Installed, iconRecords(merged.merged.cco));
    tweakDb = presentation?.source ?? null;
  } catch (error) { log?.(`TweakDB could not be read: ${(error as Error).message}`); }
  // A mod archive that wins the base resource's path replaces the game's creator options: they name that mod (PIPE-46).
  const baseFromMod = merged.base.group !== null && merged.base.group !== "content" && merged.base.group !== "ep1";
  const catalogue = buildCatalogue({ bodyGender, cco: merged.merged.cco, text: text.table, presentation,
    base: baseFromMod ? { path: merged.base.ref.path ?? merged.base.ref.hash, mod: merged.base.provider ?? merged.base.archive ?? "a mod" } : null,
    customs: merged.customs.map(custom => ({ path: custom.path, label: customLabel(custom.path, custom.provenance), mod: custom.provenance.provider })) });
  const gaps = [...catalogue.gaps, ...merged.gaps, ...languageGaps];
  return { source: { catalogue: { ...catalogue, gaps }, cco: merged.merged.cco }, catalogue: { ...catalogue, gaps },
    evidence: { language, texts: text.texts, tweakDb, customResources: merged.customs.length } };
}

