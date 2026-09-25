// The creator catalogue and character context must fall out of the game's data: no module may name a vanilla option,
// link family or mod, and the pure modules keep file and process access in the host adapter (AGENTS.md: no per-mod adapters).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const MODULES = ["cc-catalogue", "cc-presentation", "cc-render-coverage", "cc-preset", "character-context", "game-text", "tweakdb-flats", "cc-panel",
  "character-context-actions", "browser-cc-catalogue-device", "studio-ui/panels/character", "cc-catalogue-host", "cc-catalogue-service", "cc-catalogue-server"];
const HOST = new Set(["cc-catalogue-host", "cc-catalogue-service", "cc-catalogue-server", "browser-cc-catalogue-device", "studio-ui/panels/character"]);
const PURE = MODULES.filter(name => !HOST.has(name));
const source = (name: string) => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
/** Code without comments, so prose may explain the rules with examples. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const literals = (text: string) => [...code(text).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1] ?? match[2] ?? "");

const inventory = JSON.parse(readFileSync(new URL("../../../../research/character-customization/cc-option-inventory.json", import.meta.url), "utf8"));
const vanilla = new Set<string>();
for (const resource of Object.values(inventory.resources) as Record<string, unknown>[]) {
  for (const part of ["headOptions", "bodyOptions", "armsOptions"]) for (const option of (resource[part] as { name: string }[] | undefined) ?? []) vanilla.add(option.name);
  for (const key of Object.keys((resource.linkFamilies as Record<string, unknown> | undefined) ?? {})) vanilla.add(key);
}
/** Mod, framework and pack names the Studio has met; none may steer code. */
const MOD_TOKENS = /prc|ccxl|archive_?xl|nutboy|arkhe|eagul|kala|unique eyes|meluminary|icxrus|anruimurasaki|framework_128/i;

test("the inventory of vanilla names is loaded", () => {
  expect(vanilla.size).toBeGreaterThan(400);
  expect(vanilla.has("eyes_color")).toBe(true);
  expect(vanilla.has("skin color")).toBe(true);
});

test("no catalogue or context module names a vanilla option, link family or mod", () => {
  const offenders = MODULES.flatMap(name => literals(source(name))
    .filter(text => vanilla.has(text) || MOD_TOKENS.test(text)).map(text => `${name}: "${text}"`));
  expect(offenders).toEqual([]);
});

test("the literal scan sees what it should", () => {
  expect(literals(`const a = "eyes_color"; // "skin color" in a comment\n/* "piercings" */ const b = 'x';`)).toEqual(["eyes_color", "x"]);
});

test("pure modules leave files, processes and browser globals to the host adapter", () => {
  for (const name of PURE) {
    const text = code(source(name));
    expect(text, name).not.toMatch(/from\s+["']node:(?:fs|child_process|os|path)["']/);
    expect(text, name).not.toMatch(/from\s+["']\.\/(?:resolver-host|wolvenkit-cli|process-tree|cc-catalogue-host)["']/);
    expect(text, name).not.toMatch(/\b(?:window|localStorage|navigator|globalThis|process\.env)\b/);
  }
});
