/**
 * Generates `src/native/rtti-class-defaults.json`: per class of the RTTI slice (`src/native/rtti-subset.json`), the class defaults of
 * its plain-valued properties (numbers, booleans, names, enums and bitfields) that are not the type's zero value (R&D tool).
 *
 * A CR2W file leaves out a property whose value equals its class default, so a reader must know the default. The learned table
 * (`rtti-defaults.json`, tools/native-cr2w-diff.ts) holds what WolvenKit wrote for properties the sampled files left out, and only
 * those: a property no sampled file omitted was read as its type's zero. `CHairProfile.sampleCount` is one: vanilla
 * `purple_ombre.hp` and `liliac.hp` leave it out, the reader wrote 0, and every hair drawn with those colours was dropped (PIPE-110).
 *
 * Input: WolvenKit's generated type classes (`WolvenKit.RED4/Types/Classes/<class>.cs`), whose constructors set the class defaults
 * WolvenKit writes for an omitted property. Only the default values are taken (facts about the game's types), not code; values set
 * with `new` (structs, arrays, handles) are left out, since a struct's own properties have their own defaults here.
 *
 *   bun tools/native-class-defaults.ts --wolvenkit <WolvenKit source folder>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { float32Value } from "../src/native/json-numbers";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const wolvenKit = option("wolvenkit");
if (!wolvenKit) { console.error("usage: bun tools/native-class-defaults.ts --wolvenkit <WolvenKit source folder>"); process.exit(2); }

const here = join(import.meta.dir, "..", "src", "native");
const subset = JSON.parse(readFileSync(join(here, "rtti-subset.json"), "utf8")) as {
  enums: Record<string, [string, number][] | 0>; bitfields: Record<string, [string, number][]>; classes: Record<string, [string, [string, string][]]> };
const learned = JSON.parse(readFileSync(join(here, "rtti-defaults.json"), "utf8")) as Record<string, Record<string, unknown>>;

const INTEGERS = new Set(["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32"]);
const LIMITS: Record<string, string> = { "byte.MaxValue": "255", "sbyte.MaxValue": "127", "ushort.MaxValue": "65535", "short.MaxValue": "32767",
  "uint.MaxValue": "4294967295", "int.MaxValue": "2147483647", "ulong.MaxValue": "18446744073709551615", "long.MaxValue": "9223372036854775807",
  "sbyte.MinValue": "-128", "short.MinValue": "-32768", "int.MinValue": "-2147483648", "long.MinValue": "-9223372036854775808" };
const number = (text: string) => LIMITS[text] ?? text.replace(/[FfDdUuLl]+$/, "");

/** A constructor value as the reference JSON writes it, or undefined when it isn't a plain value this tool converts. */
function convert(type: string, text: string): unknown {
  if (INTEGERS.has(type)) { const n = Number(number(text)); return Number.isInteger(n) ? n : undefined; }
  if (type === "Int64" || type === "Uint64") { const t = number(text); return /^-?\d+$/.test(t) ? BigInt(t).toString() : undefined; }
  if (type === "Float") { const n = Number(number(text)); return Number.isFinite(n) ? float32Value(Math.fround(n)) : undefined; }
  if (type === "Double") { const n = Number(number(text)); return Number.isFinite(n) ? n : undefined; }
  if (type === "Bool") return text === "true" ? 1 : text === "false" ? 0 : undefined;
  if (type === "CName") { const m = /^"([^"]*)"$/.exec(text); return m ? { $type: "CName", $storage: "string", $value: m[1] || "None" } : undefined; }
  if (Object.hasOwn(subset.enums, type)) {
    const m = new RegExp(`^Enums\\.${type}\\.(\\w+)$`).exec(text);
    const members = subset.enums[type];
    return m && (!Array.isArray(members) || members.some(([name]) => name === m[1])) ? m[1] : undefined;
  }
  if (Object.hasOwn(subset.bitfields, type)) {
    const names = text.split("|").map(part => new RegExp(`^Enums\\.${type}\\.(\\w+)$`).exec(part.trim())?.[1]);
    if (names.some(name => !name)) return undefined;
    const bits = new Map(subset.bitfields[type]);
    return [...new Set(names as string[])].sort((a, b) => (bits.get(a) ?? 64) - (bits.get(b) ?? 64)).join(", ");
  }
  return undefined;
}

const out: Record<string, Record<string, unknown>> = {};
const disagreements: string[] = [];
let skipped = 0;
for (const [name, [, props]] of Object.entries(subset.classes)) {
  const file = join(wolvenKit, "WolvenKit.RED4", "Types", "Classes", `${name}.cs`);
  if (!existsSync(file)) continue;
  const source = readFileSync(file, "utf8");
  const redName = new Map<string, string>();
  for (const m of source.matchAll(/\[RED\("([^"]+)"\)\][\s\S]*?public\s+\S+\s+(\w+)\s*\{/g)) redName.set(m[2]!, m[1]!);
  const at = source.indexOf(`public ${name}()`);
  if (at < 0) continue;
  const body = source.slice(at, source.indexOf("PostConstruct", at));
  // Inherited properties a subclass constructor sets are looked up in the whole chain's property lists.
  const types = new Map<string, string>();
  for (let cls: string | undefined = name; cls && subset.classes[cls]; cls = subset.classes[cls]![0]) for (const [prop, type] of subset.classes[cls]![1]) if (!types.has(prop)) types.set(prop, type);
  for (const m of body.matchAll(/^\s*(\w+)\s*=\s*([^;]+);/gm)) {
    const red = redName.get(m[1]!) ?? [...types.keys()].find(prop => prop.toLowerCase() === m[1]!.toLowerCase());
    const text = m[2]!.trim();
    if (!red || text.startsWith("new")) continue;
    const type = types.get(red);
    const value = type ? convert(type, text) : undefined;
    if (value === undefined) { skipped++; continue; }
    const seen = learned[name]?.[red];
    if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(value)) disagreements.push(`${name}.${red}: learned ${JSON.stringify(seen)}, class ${JSON.stringify(value)}`);
    (out[name] ??= {})[red] = value;
  }
}
// A zero is the type's own default, so it is kept only where it overrides an ancestor's other default.
const ancestorsHave = (name: string, prop: string) => {
  for (let cls = subset.classes[name]?.[0]; cls && subset.classes[cls]; cls = subset.classes[cls]![0]) {
    const value = out[cls]?.[prop];
    if (value !== undefined && value !== 0 && value !== "0") return true;
  }
  return false;
};
for (const [name, row] of Object.entries(out)) {
  for (const [prop, value] of Object.entries(row)) if ((value === 0 || value === "0") && !ancestorsHave(name, prop)) delete row[prop];
  if (!Object.keys(row).length) delete out[name];
}
const sorted = Object.fromEntries(Object.keys(out).sort().map(name => [name, Object.fromEntries(Object.keys(out[name]!).sort().map(key => [key, out[name]![key]]))]));
writeFileSync(join(here, "rtti-class-defaults.json"), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${Object.values(out).reduce((n, row) => n + Object.keys(row).length, 0)} class default(s) in ${Object.keys(out).length} class(es); ${skipped} value(s) not converted.`);
if (disagreements.length) console.log(`Learned values that disagree (the learned value wins):\n${disagreements.join("\n")}`);
