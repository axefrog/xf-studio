/**
 * Resolve a character against an installation, read-only. Writes a local report (it names installed mods,
 * so keep it in the ignored cache) and prints a short summary.
 *
 *   bun tools/resolve-character.ts --game <game root> [--mo2 <MO2 instance> --profile <name>] \
 *     (--save <sav.dat | decoded appearance.json> | --ui-state <state.json>) [--out <report.json>] \
 *     [--cache <dir>] [--wolvenkit <WolvenKit.CLI.exe>]
 *
 * Environment fallbacks: XFS_RESOLVER_GAME_ROOT, XFS_RESOLVER_MO2_ROOT, XFS_RESOLVER_MO2_PROFILE,
 * XFS_WOLVENKIT_CLI. `--ui-state` takes `{ "bodyGender": "female", "state": { "<option>": "<choice>" } }`;
 * `--only <option,…>` keeps only those options' appearances (e.g. to inspect one piercing choice).
 */
import { resolve } from "node:path";
import { descriptorsFromUiState } from "../src/cco-model";
import { type CharacterInput, inputFromSave, loadMergedCco, resolveCharacter, type ResolvedCharacter } from "../src/character-resolver";
import { refLabel } from "../src/depot-path";
import { openInstallation } from "../src/resolver-host";
import { readSavedV } from "../src/save-reader";

const args = Bun.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const gameRoot = option("game") ?? process.env.XFS_RESOLVER_GAME_ROOT;
const mo2Root = option("mo2") ?? process.env.XFS_RESOLVER_MO2_ROOT ?? null;
const profile = option("profile") ?? process.env.XFS_RESOLVER_MO2_PROFILE ?? null;
const cli = option("wolvenkit") ?? process.env.XFS_WOLVENKIT_CLI;
const cacheDir = resolve(option("cache") ?? resolve(import.meta.dir, "..", "data", "resolver-cache"));
const savePath = option("save"), uiStatePath = option("ui-state");
if (!gameRoot || !cli || (!savePath && !uiStatePath)) {
  console.error("Usage: bun tools/resolve-character.ts --game <root> [--mo2 <root> --profile <name>] (--save <file> | --ui-state <file>) --wolvenkit <exe>");
  process.exit(2);
}

const started = performance.now();
const installation = openInstallation({ gameRoot: resolve(gameRoot), launchRoute: mo2Root ? "mo2" : "direct", mo2Root: mo2Root ? resolve(mo2Root) : null,
  mo2ProfileId: profile, wolvenKitCli: resolve(cli), cacheDir, log: message => console.error(`[resolver] ${message}`) });
console.error(`[resolver] installation opened in ${((performance.now() - started) / 1000).toFixed(1)} s: ${JSON.stringify(installation.summary)}`);

let input: CharacterInput;
if (savePath) {
  const bytes = await Bun.file(savePath).bytes();
  const saved = savePath.toLowerCase().endsWith(".json") ? JSON.parse(new TextDecoder().decode(bytes)) : readSavedV(bytes);
  input = inputFromSave(saved);
} else {
  const { bodyGender, state } = JSON.parse(await Bun.file(uiStatePath!).text());
  const cco = await loadMergedCco(installation.graph, bodyGender);
  const derived = descriptorsFromUiState(cco.merged.cco, state);
  const only = option("only")?.split(",");
  input = { bodyGender, origin: "ui-state", morphs: derived.morphs,
    appearances: only ? derived.appearances.filter(a => only.includes(a.option)) : derived.appearances };
}
const result = await resolveCharacter(installation.graph, input);
const out = resolve(option("out") ?? resolve(cacheDir, "reports", `resolved-${Date.now()}.json`));
await Bun.write(out, JSON.stringify({ installation: installation.summary, fetch: installation.fetcher.stats, result }, null, 1));

export function summarize(character: ResolvedCharacter): string[] {
  const lines: string[] = [];
  lines.push(`CCO ${refLabel(character.cco.base.ref)} from ${character.cco.base.archive}; ${character.cco.customResources.length} custom resources merged`);
  for (const entry of character.appearances) {
    lines.push(`\n${entry.option} = ${entry.definition} [${entry.groups.join(", ")}]`);
    lines.push(`  app ${entry.app ? `${refLabel(entry.app.ref)} ← ${entry.app.archive ?? "MISSING"} (${entry.app.provider ?? "-"}; ${entry.app.rule.rule})` : "?"}` +
      `${entry.appOverride ? ` via override from ${refLabel(entry.requestedApp)}` : ""}; appearance ${entry.appearance.status}${entry.appearance.source && entry.appearance.status !== "defined" ? ` from ${entry.appearance.source}` : ""}`);
    if (entry.choice) lines.push(`  choice provided by ${entry.choice.providedBy}`);
    const drawn = entry.components.filter(c => c.geometry && !c.geometry.drawsNothing);
    const hidden = entry.components.filter(c => c.geometry?.drawsNothing);
    lines.push(`  components: ${entry.components.length} (${drawn.length} drawing, ${hidden.length} draw nothing, ${entry.components.filter(c => !c.geometry).length} non-render)`);
    for (const component of drawn.slice(0, 12)) {
      const g = component.geometry!;
      const geometry = g.morphTarget ? `${refLabel(g.morphTarget.ref)} ← ${g.morphTarget.archive ?? "MISSING"}` : g.mesh ? `${refLabel(g.mesh.ref)} ← ${g.mesh.archive ?? "MISSING"}` : "?";
      lines.push(`   - ${component.name} [${component.origin.kind}] ${geometry}; meshApp ${component.meshAppearance}; chunks ${g.visibleChunks?.join(",")}/${g.renderChunks}; morphs ${component.appliedMorphs.length}`);
      for (const material of component.materials.slice(0, 4)) {
        const textures = material.params.filter(p => p.resource).slice(0, 4).map(p => `${p.name}=${refLabel(p.resource!.ref)}←${p.resource!.archive ?? "MISSING"}`);
        lines.push(`       chunk ${material.chunk} ${material.name} (${material.route}) → ${material.template ? refLabel(material.template.ref) : "?"}; ${textures.join("; ")}${material.gaps.length ? ` GAPS: ${material.gaps.join(" | ")}` : ""}`);
      }
    }
    if (drawn.length > 12) lines.push(`   … ${drawn.length - 12} more drawing components`);
  }
  lines.push(`\nMorphs: ${character.morphs.map(m => `${m.target}/${m.region}→${m.components}`).join(", ")}`);
  lines.push(`Gaps (${character.gaps.length}): ${character.gaps.slice(0, 20).map(g => `${g.code} ${g.subject}`).join("; ")}`);
  const codes = new Map<string, number>();
  for (const ambiguity of character.ambiguities) codes.set(ambiguity.code, (codes.get(ambiguity.code) ?? 0) + 1);
  lines.push(`Ambiguities (${character.ambiguities.length}): ${[...codes].map(([code, n]) => `${code}×${n}`).join(", ")}`);
  return lines;
}
console.log(summarize(result).join("\n"));
console.error(`[resolver] done in ${((performance.now() - started) / 1000).toFixed(1)} s; report ${out}; fetch ${JSON.stringify(installation.fetcher.stats)}`);
