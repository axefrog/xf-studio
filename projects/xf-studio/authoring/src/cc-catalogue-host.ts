/**
 * Host adapter for the creator catalogue: loads the effective creator resource through the resolver's installation,
 * the game's and mods' on-screen texts for the player's language, and TweakDB's creator categories and icons, then
 * builds the catalogue (cc-catalogue.ts). All file access for the catalogue lives here; read-only towards the game and the mod
 * manager (a WolvenKit fallback writes only into the cache folder).
 *
 * - **Language** [resource]: the game's own setting, `/language` → `OnScreen` in
 *   `%LOCALAPPDATA%\CD Projekt Red\Cyberpunk 2077\UserSettings.json` (read by `gameLanguageOf`); English when it can't be read or
 *   `LOCALAPPDATA` is unset. When the game has no text archive for that language, the English texts are used and the catalogue says so
 *   (gap `texts-language-missing`; PIPE-51).
 * - **Texts**: `base\` and (with Phantom Liberty) `ep1\localization\<language>\onscreens\onscreens.json` from their
 *   winning archives, then every `.xl` text declaration in ArchiveXL's load order (game-text.ts `textPlan`). These are CR2W `.json`
 *   resources (`JsonResource`s), read through the installation's fetch port: natively first, WolvenKit per resource
 *   (`readTexts`); only the parsed entries are kept, in `<cache>/text/` (files an earlier reader wrote are removed; NATIVE-52).
 * - **Labels that couldn't be read** (NATIVE-46): a text read that may pass (the decode worker couldn't start, a file briefly locked)
 *   leaves the catalogue's `labels.next` at `retry`: the service serves it but doesn't keep it as final. A text only WolvenKit could
 *   read while WolvenKit isn't set up leaves it at `wolvenkit`, said plainly with that one next step. Only a language whose game
 *   texts no archive holds is "not installed" (English is shown then).
 * - **TweakDB**: `r6\cache\tweakdb_ep1.bin` when Phantom Liberty is mounted, else `tweakdb.bin` [hypothesis: the game loads
 *   the EP1 blob when the expansion is installed; both hold the same creator categories in 2.31].
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildCatalogue, type BodyGender, type CcCatalogue, iconRecords, readCcoWithPresentation } from "./cc-catalogue";
import { readCreatorPresentation, type CreatorPresentation } from "./cc-presentation";
import type { CharacterSource } from "./character-context";
import { customLabel, loadMergedCco } from "./character-resolver";
import { refFromPath } from "./depot-path";
import { writeFileAtomic } from "./derived-cache";
import { gameLanguageOf, readOnscreenEntries, type TextEntry, TextTable, textPlan } from "./game-text";
import type { Installation } from "./resolver-host";
import { TweakDbBlob } from "./tweakdb-flats";

export interface CatalogueHostOptions {
  readonly installation: Installation;
  readonly gameRoot: string;
  /** The resolver cache folder the installation reads into (its `text/` keeps the parsed texts). */
  readonly cacheDir: string;
  /** A language code (`en-us`); default: the game's own on-screen language. */
  readonly language?: string | null;
  readonly log?: (message: string) => void;
}
/**
 * Labels the catalogue couldn't read, with the one next step: `retry` when a read may pass (the service builds again later, and Try again
 * builds at once), `wolvenkit` when only WolvenKit could read them and it isn't set up.
 */
export type CatalogueLabels = { readonly next: "retry" | "wolvenkit"; readonly message: string };
export const LABELS_RETRY = "Some of the creator's labels couldn't be read just now, so option names are shown in their place. Try again.";
export const LABELS_NEED_WOLVENKIT = "Some of the creator's labels can only be read with WolvenKit, which isn't set up, so option names are shown in their place. " +
  "Set up WolvenKit and XF Studio reads them.";
export interface CatalogueLoad {
  readonly source: CharacterSource;
  readonly catalogue: CcCatalogue;
  /** Labels that couldn't be read, and the next step (NATIVE-46); absent or null when every text read. */
  readonly labels?: CatalogueLabels | null;
  readonly evidence: {
    readonly language: { readonly code: string; readonly from: "option" | "game-settings" | "default" };
    readonly texts: readonly { readonly path: string; readonly archive: string | null; readonly entries: number; readonly kind: "game" | "mod"; readonly replace: boolean }[];
    readonly tweakDb: string | null;
    readonly customResources: number;
  };
}

/** The game's settings file, or null when `LOCALAPPDATA` is unset or not absolute (never a path relative to the working folder; PIPE-51). */
export const gameSettingsPath = (localAppData: string | null | undefined = process.env.LOCALAPPDATA): string | null =>
  localAppData && /^(?:[A-Za-z]:[\\/]|\/)/.test(localAppData) ? join(localAppData, "CD Projekt Red", "Cyberpunk 2077", "UserSettings.json") : null;

/** The game's on-screen language from its own settings file, or null when it can't be read. */
export function gameLanguage(settingsPath = gameSettingsPath()): string | null {
  if (!settingsPath) return null;
  try { return gameLanguageOf(JSON.parse(readFileSync(settingsPath, "utf8"))); } catch { return null; }
}
let languageMemo: { key: string; value: string | null } | null = null;
/**
 * `gameLanguage`, read again only when the settings file's size or time changed: cheap enough for every catalogue question, whose key
 * includes it, so a language changed in the game's settings builds the catalogue again (NATIVE-51).
 */
export function currentGameLanguage(settingsPath = gameSettingsPath()): string | null {
  if (!settingsPath) return null;
  let key: string;
  try { const stat = statSync(settingsPath); key = `${settingsPath}|${stat.size}|${stat.mtimeMs}`; } catch { return null; }
  if (languageMemo?.key !== key) languageMemo = { key, value: gameLanguage(settingsPath) };
  return languageMemo.value;
}

const fingerprint = (path: string) => {
  const stat = statSync(path);
  return createHash("sha256").update(`${path}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 24);
};

/** Short tag of the reader that answered a text resource, in its cache file's name. */
const readerTag = (reader: string) => createHash("sha256").update(reader).digest("hex").slice(0, 12);

/**
 * How one text resource read: `read`, `absent` (no mounted archive holds it), `unreadable` (a lasting refusal: the readers can't read it
 * on this route) or `transient` (a failure that may pass: the decode worker couldn't start, an archive briefly unreadable).
 */
export type TextReadOutcome = "read" | "absent" | "unreadable" | "transient";

/** Cache folders whose text files of other readers were pruned this session, per set of reader tags. */
const prunedTexts = new Set<string>();
/**
 * Remove, in the background, the parsed texts another reader wrote (NATIVE-52): a reader or WolvenKit identity that changed never
 * answers them again. Only while the native reader is on (its identity is then known, so a reader briefly off never costs its files);
 * once per folder and set of readers per session; advisory.
 */
function pruneStaleTexts(cacheDir: string, tags: readonly string[]): void {
  const key = `${resolve(cacheDir).toLowerCase()}|${tags.join(",")}`;
  if (prunedTexts.has(key)) return;
  prunedTexts.add(key);
  const folder = join(cacheDir, "text"), keep = new Set(tags);
  void (async () => {
    let names: string[];
    try { names = await readdir(folder); } catch { return; }
    for (const name of names) {
      const match = /^\d+-[0-9a-f]{24}-([0-9a-f]{12})\.json$/.exec(name);
      if (match && !keep.has(match[1]!)) await rm(join(folder, name), { force: true }).catch(() => {});
    }
  })();
}

/**
 * Entries of CR2W `.json` text resources, each from its winning archive, read through the installation's fetch port: natively first,
 * WolvenKit for a resource the reader doesn't answer, batched with the resolver's other reads (`ResolverFetcher.fetchJsonResource`;
 * PIPE-50), and how each read (`outcomes`). The parsed entries are kept in `<cache>/text/` per (depot hash, archive fingerprint, the
 * reader that answered), so a warm catalogue reads no resource; entries WolvenKit gave before are used as they are (the native reader's
 * equal them on every cached catalogue resource).
 */
export async function readTexts(installation: Installation, paths: readonly string[], cacheDir: string, log: (message: string) => void = () => {}):
  Promise<{ found: Map<string, { entries: TextEntry[]; archive: string }>; outcomes: Map<string, TextReadOutcome> }> {
  const fetcher = installation.fetcher;
  const decoder = fetcher.nativeDecoder;
  const readers = [...(decoder ? [`native:${decoder.identity}`] : []), fetcher.tool].map(readerTag);
  if (decoder) pruneStaleTexts(cacheDir, readers);
  const found = new Map<string, { entries: TextEntry[]; archive: string }>();
  const outcomes = new Map<string, TextReadOutcome>();
  const counts = { cached: 0, native: 0, wolvenKit: 0, unreadable: 0 };
  const failed = (path: string, outcome: "unreadable" | "transient", line: string) => { outcomes.set(path, outcome); counts.unreadable++; log(line); };
  await Promise.all([...new Set(paths)].map(async path => {
    const ref = refFromPath(path);
    const winner = installation.graph.lookup(ref.hash).winner;
    if (!winner) { outcomes.set(path, "absent"); return; }
    let print: string;
    // The archive went away since the installation was opened: the next installation reads what replaced it.
    try { print = fingerprint(winner.id); } catch { failed(path, "transient", `${winner.name}: ${path} could not be read (the archive is gone).`); return; }
    const file = (tag: string) => join(cacheDir, "text", `${ref.hash}-${print}-${tag}.json`);
    for (const tag of readers) {
      if (!existsSync(file(tag))) continue;
      try { found.set(path, { entries: JSON.parse(readFileSync(file(tag), "utf8")).entries, archive: winner.name }); outcomes.set(path, "read"); counts.cached++; return; }
      catch { rmSync(file(tag), { force: true }); }
    }
    let answer: Awaited<ReturnType<typeof fetcher.fetchJsonResource>>;
    try { answer = await fetcher.fetchJsonResource(winner, ref); }
    catch (error) { failed(path, "transient", `${winner.name}: ${path}: ${(error as Error)?.message ?? error}`); return; }
    if (!answer) {
      const transient = fetcher.transient(winner, ref);
      failed(path, transient ? "transient" : "unreadable", `${winner.name}: ${path} could not be read${transient ? " (this may pass)" : ""}.`);
      return;
    }
    let entries: TextEntry[];
    try { entries = readOnscreenEntries(answer.document); }
    catch { failed(path, "unreadable", `${winner.name}: ${path} is not readable text.`); return; }
    found.set(path, { entries, archive: winner.name });
    outcomes.set(path, "read");
    if (answer.reader.startsWith("native:")) counts.native++; else counts.wolvenKit++;
    try { mkdirSync(join(cacheDir, "text"), { recursive: true }); writeFileAtomic(file(readerTag(answer.reader)), JSON.stringify({ path, archive: winner.name, entries })); }
    catch { /* Advisory: read again next time. */ }
  }));
  if (counts.native || counts.wolvenKit || counts.unreadable)
    log(`Creator texts: ${counts.native} read by XF Studio, ${counts.wolvenKit} by WolvenKit, ${counts.cached} from the cache, ${counts.unreadable} unreadable.`);
  return { found, outcomes };
}
/** `readTexts`' entries alone. */
export async function readTextResources(installation: Installation, paths: readonly string[], cacheDir: string,
  log: (message: string) => void = () => {}): Promise<Map<string, { entries: TextEntry[]; archive: string }>> {
  return (await readTexts(installation, paths, cacheDir, log)).found;
}

/** The on-screen texts the game shows in `language`, with the mods' ArchiveXL text declarations merged in load order. */
export async function loadTextTable(installation: Installation, language: string, cacheDir: string, log?: (message: string) => void) {
  const plan = textPlan(language, installation.plan.ep1Installed, installation.xl.localization);
  const { found: read, outcomes } = await readTexts(installation, plan.map(item => item.path), cacheDir, log);
  const table = new TextTable(language);
  const texts: CatalogueLoad["evidence"]["texts"][number][] = [];
  for (const item of plan) {
    const got = read.get(item.path);
    texts.push({ path: item.path, archive: got?.archive ?? null, entries: got?.entries.length ?? 0, kind: item.kind, replace: item.replace });
    if (got) table.add(got.entries, { id: item.path, kind: item.kind, declaredBy: item.declaredBy }, item.replace);
  }
  const outcome = (item: { path: string }): TextReadOutcome => outcomes.get(item.path) ?? "absent";
  return { table: read.size ? table : null, texts,
    /** No mounted archive holds the game's own texts for this language (it isn't installed). */
    gameAbsent: plan.filter(item => item.kind === "game").every(item => outcome(item) === "absent"),
    transient: plan.filter(item => outcome(item) === "transient").length,
    unreadable: plan.filter(item => outcome(item) === "unreadable").length };
}

/**
 * The labels' state once the texts were read (NATIVE-46): a read that may pass leaves them to be read again; a lasting refusal without
 * WolvenKit asks for WolvenKit, unless the native reader is only off for a while (the registry opens it again, and the catalogue is built
 * again with it).
 */
export function labelsOf(installation: Pick<Installation, "fetcher" | "native">, text: { transient: number; unreadable: number }): CatalogueLabels | null {
  if (text.transient) return { next: "retry", message: LABELS_RETRY };
  if (!text.unreadable || installation.fetcher.wolvenKit.available) return null;
  const native = installation.native;
  if (native && !native.decoder && !native.permanent) return { next: "retry", message: LABELS_RETRY };
  return { next: "wolvenkit", message: LABELS_NEED_WOLVENKIT };
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
  const { installation, cacheDir, log } = options;
  const merged = await loadMergedCco(installation.graph, bodyGender, readCcoWithPresentation);
  const settings = options.language ? null : gameLanguage();
  let language: { code: string; from: "option" | "game-settings" | "default" } = { code: options.language ?? settings ?? "en-us",
    from: options.language ? "option" : settings ? "game-settings" : "default" };
  let text = await loadTextTable(installation, language.code, cacheDir, log);
  const languageGaps: { code: string; subject: string; detail: string }[] = [];
  // A language whose game texts aren't installed (no mounted archive holds them: no `lang_<code>_text.archive`) shows English, and says
  // so (PIPE-51). Texts that are there but couldn't be read are not "not installed" (NATIVE-46): the labels say so instead.
  if (text.gameAbsent && language.code !== "en-us") {
    languageGaps.push({ code: "texts-language-missing", subject: language.code,
      detail: `The game's ${language.code} texts aren't installed, so the creator's labels are shown in English.` });
    language = { code: "en-us", from: "default" };
    text = await loadTextTable(installation, "en-us", cacheDir, log);
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
  const labels = labelsOf(installation, text);
  const labelGaps = labels ? [{ code: labels.next === "retry" ? "texts-transient" : "texts-need-wolvenkit", subject: "labels",
    detail: `${text.transient} text resource(s) failed in a way that may pass; ${text.unreadable} couldn't be read.` }] : [];
  const gaps = [...catalogue.gaps, ...merged.gaps, ...languageGaps, ...labelGaps];
  return { source: { catalogue: { ...catalogue, gaps }, cco: merged.merged.cco }, catalogue: { ...catalogue, gaps }, labels,
    evidence: { language, texts: text.texts, tweakDb, customResources: merged.customs.length } };
}

