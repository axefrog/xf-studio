/**
 * Measure first-time and repeated creator choices on a real installation, through the character-detail host exactly as the
 * Studio runs it: the time each step takes and the WolvenKit launches it makes. Read-only towards the game and the mod manager;
 * the caches are the ones this checkout's server uses (`data/preview-cache`, `data/resolver-cache`, or XFS_PREVIEW_CORE_CACHE and
 * XFS_RESOLVER_CACHE), so point those at copies when a measurement must start from a known state.
 *
 *   bun tools/measure-choices.ts [--save <file.dat>] [--prefetch] <part/option>=<choice> ...
 *
 * Each `<part/option>=<choice>` is one step, set on top of the steps before it (a switcher choice's activated options are looked up
 * in the catalogue). `--prefetch <part/option>` prefetches that option's choices first and reports what it cost. Game folder,
 * launch route and WolvenKit come from the Studio's saved setup.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CharacterDetailHost, type CharacterDetailSettings } from "../src/character-detail-host";
import { characterRequestOf, DEFAULT_CHARACTER, type CharacterRequest } from "../src/character-detail-request";
import type { CharacterChoice } from "../src/character-context";
import { savedDescriptorsOf } from "../src/character-context";
import { LocalSettingsStore } from "../src/local-settings-store";
import { readSavedV } from "../src/save-reader";
import { wolvenKitRunStats } from "../src/wolvenkit-cli";

const args = Bun.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return null; const value = args[i + 1] ?? null; args.splice(i, 2); return value; };
const savePath = flag("save");
const prefetchOption = flag("prefetch");
const settings = new LocalSettingsStore().load().settings;
const hostSettings: CharacterDetailSettings = { gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
  mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: settings.wolvenKitCli };
const data = resolve(import.meta.dir, "..", "data");
const lines: string[] = [];
const started = performance.now();
const stamp = () => `${((performance.now() - started) / 1000).toFixed(2).padStart(7)} s`;
const host = new CharacterDetailHost({ cacheRoot: resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(data, "preview-cache")),
  resolverCache: resolve(process.env.XFS_RESOLVER_CACHE || resolve(data, "resolver-cache")), settings: () => hostSettings,
  log: message => { lines.push(message); console.error(`${stamp()} ${message}`); } });

const saved = savePath ? savedDescriptorsOf(readSavedV(new Uint8Array(readFileSync(savePath)))) : null;
const requestOf = (choices: CharacterChoice[]): CharacterRequest =>
  saved || choices.length ? characterRequestOf({ bodyGender: "female", saved }, choices, ["head"]) : DEFAULT_CHARACTER;

const launches = () => ({ launches: wolvenKitRunStats.launches, ms: wolvenKitRunStats.ms,
  byCommand: new Map([...wolvenKitRunStats.byCommand].map(([command, entry]) => [command, { ...entry }])) });
const since = (before: ReturnType<typeof launches>) => {
  const parts: string[] = [];
  for (const [command, entry] of wolvenKitRunStats.byCommand) {
    const was = before.byCommand.get(command) ?? { launches: 0, ms: 0 };
    if (entry.launches > was.launches) parts.push(`${entry.launches - was.launches} ${command} (${((entry.ms - was.ms) / 1000).toFixed(1)} s)`);
  }
  return { count: wolvenKitRunStats.launches - before.launches, text: parts.join(", ") || "none" };
};

async function prepare(label: string, choices: CharacterChoice[]) {
  const before = launches(), at = performance.now();
  await host.refresh();
  const state = host.request(requestOf(choices));
  await host.settled();
  const final = host.state(state.key);
  const took = (performance.now() - at) / 1000, used = since(before);
  console.log(`${label.padEnd(44)} ${took.toFixed(2).padStart(7)} s  ${String(used.count).padStart(2)} launch(es): ${used.text}  [${final.phase}${final.message ? `: ${final.message}` : ""}]`);
  return took;
}

await prepare("the V (base)", []);
const catalogue = host.creator;
await catalogue.ensure("female");
const choices: CharacterChoice[] = [];
async function choiceOf(spec: string): Promise<CharacterChoice> {
  const [id, key] = spec.split("=") as [string, string];
  const [part, option] = id.split("/") as [CharacterChoice["part"], string];
  for (let offset = 0; ; offset += 240) {
    const page = await catalogue.page("female", id, offset);
    if (!page) throw Error(`No option ${id}`);
    const found = page.choices.find(choice => choice.key === key);
    if (found) return { part, option, choice: key, ...(found.activates ? { activates: [...found.activates] } : {}) };
    if (offset + page.choices.length >= page.total) throw Error(`No choice ${key} in ${id}`);
  }
}
if (prefetchOption) {
  // `--prefetch <part/option>:<first>-<last>`: prepare those positions of the option ahead, as an open row does, and report the cost.
  const [option, range = "0-7"] = prefetchOption.split(":") as [string, string?];
  const [first, last] = range.split("-").map(Number) as [number, number];
  const positions = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const before = launches(), at = performance.now(), bytes = (await host.preparedFiles()).bytes;
  let answer = host.prefetchRow({ base: requestOf([]), option, positions });
  while (answer.busy) { await Bun.sleep(250); answer = host.prefetchRow({ base: requestOf([]), option, positions }); }
  const added = (await host.preparedFiles()).bytes - bytes, used = since(before);
  console.log(`prefetch ${option} ${range}: ${((performance.now() - at) / 1000).toFixed(1)} s, ${used.count} launch(es): ${used.text}; ` +
    `states ${answer.states}${answer.stopped ? ` (stopped: ${answer.stopped})` : ""}; +${(added / 1024 ** 2).toFixed(1)} MB prepared files ` +
    `(${(added / 1024 ** 2 / positions.length).toFixed(1)} MB per choice)`);
}
for (const spec of args) {
  choices.push(await choiceOf(spec));
  await prepare(spec, [...choices]);
}
console.log(`total WolvenKit launches ${wolvenKitRunStats.launches} (${(wolvenKitRunStats.ms / 1000).toFixed(1)} s)`);
process.exit(0);
