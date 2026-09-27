/**
 * Developer dry run of an expression set's Build (research/animation/expression-editor-design.md §6): builds a set of the built-in natural
 * samples through the real package host (prerequisite, builder, product and feature verifiers) into private roots given on the command
 * line. Reads the game and mod files through the resolver only (never writes to them) and installs nothing.
 *
 *   bun tools/expression_set_dry_run.ts <private root> [installed|sharing]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { localHostState } from "../src/host-state";
import { LocalSettingsStore } from "../src/local-settings-store";
import { localExpressionsGame, localPackageAdapter, localPackageTools } from "../src/package-server";
import { runProductBuild } from "../src/platform/export/product-host";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { EXPRESSIONS_GAME_PREREQUISITE } from "../src/features/expressions/export/game";
import { setCollection } from "../src/part-preset-sets";

const [privateRoot, table = "installed"] = process.argv.slice(2);
if (!privateRoot) throw Error("Usage: bun tools/expression_set_dry_run.ts <private root> [installed|sharing]");
const root = resolve(privateRoot);
const state = localHostState(resolve(import.meta.dir, "..", "data"));
const settings = new LocalSettingsStore(state.settingsDirectory).load().settings;
const tools = localPackageTools(settings);
const samples = resolve(import.meta.dir, "..", "data", "expression-samples");
const presets = readdirSync(samples).filter(name => name.endsWith(".json")).sort().map((name, index) => {
  const value = JSON.parse(readFileSync(join(samples, name), "utf8")) as { name: string; part: { schema: string; body: unknown } };
  return { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: value.name, revision: 1, part: value.part };
});
const collection = setCollection({ id: "5e7a0000-0000-4000-8000-000000000001", feature: "expressions", name: "Dry run", revision: 1,
  members: presets.map(preset => preset.id), table: table === "sharing" ? "sharing" : "installed", updatedAt: "" }, presets);
const adapter = localPackageAdapter({ exporters: STUDIO_EXPORTERS, tools, roots: { build: join(root, "build"), dist: join(root, "dist") },
  prerequisites: current => ({ [EXPRESSIONS_GAME_PREREQUISITE]: localExpressionsGame(current, { ...process.env, XFS_EXPRESSIONS_GAME_CACHE: join(root, "game-cache") }) }) });
const started = performance.now();
const outcome = await runProductBuild(adapter, collection, new AbortController().signal);
console.log(JSON.stringify(outcome, null, 2));
console.log(`elapsed ${Math.round(performance.now() - started)} ms`);
