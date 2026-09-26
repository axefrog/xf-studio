/**
 * Generates `src/native/rtti-subset.json`, the slice of the game's RTTI the native CR2W reader needs (R&D tool):
 * - `enums` and `bitfields`: the name of every enum and bitfield type (a CR2W property's type string names its type, and the
 *   reader must know whether a name is an enum, a bitfield or a class), with members for those the subset's classes use.
 * - `classes`: parent and ordered `[name, type]` properties of the resource root types the resolver reads and every class,
 *   struct and handle target reachable from them through property types, plus any class named on the command line or seen as
 *   a `$type` in a folder of reference JSON. The reader uses them to add properties a file leaves at their default.
 *
 * Input: an RTTI dump in the red-dump-json layout (`classes/*.json`, `enums/*.json`, `bitfields/*.json`), exported from the game
 * with RED4.RTTIDumper. Only type and property names are taken: facts about the game's types, not code.
 *
 *   bun tools/native-rtti-subset.ts --dump <red-dump-json folder> [--observed <folder of WolvenKit JSON>]... [--class <name>]...
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const many = (name: string) => args.flatMap((arg, i) => arg === `--${name}` ? [args[i + 1]!] : []);
const dump = option("dump");
if (!dump) { console.error("usage: bun tools/native-rtti-subset.ts --dump <red-dump-json> [--observed <json folder>]... [--class <name>]..."); process.exit(2); }

/** The resource roots the resolver and character details read (knowledge/archive-format.md §5). */
export const ROOTS = ["CMesh", "MorphTargetMesh", "appearanceAppearanceResource", "entEntityTemplate", "CMaterialInstance", "CMaterialTemplate",
  "Multilayer_Setup", "Multilayer_LayerTemplate", "Multilayer_Mask", "CHairProfile", "CSkinProfile", "CGradient", "CBitmapTexture",
  "gameuiCharacterCustomizationInfoResource", "gameuiAppearanceInfo", "gameuiMorphInfo", "gameuiSwitcherInfo", "worldEnvironmentDefinition",
  "entMorphTargetSkinnedMeshComponent", "entSkinnedMeshComponent", "entGarmentSkinnedMeshComponent", "entMeshComponent",
  "entSkinnedClothComponent", "entPhysicalMeshComponent", "entAnimatedComponent", "entSlotComponent", "entTransformComponent",
  "entExternalComponent", "entEntity", "gameObject", "CMaterialParameterTexture", "CMaterialParameterScalar", "CMaterialParameterColor",
  "CMaterialParameterVector", "CMaterialParameterHairParameters", "CMaterialParameterSkinParameters", "CMaterialParameterGradient",
  "CMaterialParameterTextureArray", "CMaterialParameterCube", "CMaterialParameterMultilayerSetup", "CMaterialParameterMultilayerMask",
  "CMaterialParameterStructBuffer", "CMaterialParameterDynamicTexture", "CMaterialParameterTerrainSetup", "CMaterialParameterFoliageParameters",
  "CMaterialParameterCpuNameU64", "rendRenderMeshBlob", "rendRenderMorphTargetMeshBlob", "rendRenderTextureBlobPC"];

type DumpProp = { name: string; type: string };
type DumpClass = { name: string; parent?: string; props?: DumpProp[] };
const read = (folder: string) => readdirSync(join(dump, folder)).filter(name => name.endsWith(".json"))
  .map(name => JSON.parse(readFileSync(join(dump, folder, name), "utf8")));
const classes = new Map<string, DumpClass>(read("classes").map((c: DumpClass) => [c.name, c]));
const enums = new Map<string, { name: string; members?: { name: string; value: number | string }[] }>(read("enums").map((e: { name: string }) => [e.name, e]));
const bitfields = new Map<string, { name: string; members?: { name: string; bit: number }[] }>(read("bitfields").map((b: { name: string }) => [b.name, b]));

/** Type names a type string mentions: `array:handle:X` → X; `static:4,Float`/`[4]Float` → Float; `curveData:Float` → Float. */
export function typeNames(type: string): string[] {
  const out: string[] = [];
  const visit = (text: string) => {
    let match: RegExpExecArray | null;
    if ((match = /^(?:array|handle|whandle|rRef|raRef|curveData|multiChannelCurve):(.+)$/.exec(text))) return visit(match[1]!);
    if ((match = /^static:\d+,(.+)$/.exec(text))) return visit(match[1]!);
    if ((match = /^\[\d+\](.+)$/.exec(text))) return visit(match[1]!);
    out.push(text);
  };
  visit(type);
  return out;
}

const wanted = new Set<string>([...ROOTS, ...many("class")]);
const observe = (value: unknown, depth = 0): void => {
  if (depth > 256 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) observe(item, depth + 1); return; }
  const record = value as Record<string, unknown>;
  if (typeof record.$type === "string" && classes.has(record.$type)) wanted.add(record.$type);
  for (const [key, item] of Object.entries(record)) if (key !== "Bytes") observe(item, depth + 1);
};
for (const folder of many("observed")) {
  const walk = (dir: string) => { for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".json")) try { observe(JSON.parse(readFileSync(path, "utf8"))); } catch { /* not JSON */ }
  } };
  walk(folder);
}

const subset = new Map<string, DumpClass>();
const usedEnums = new Set<string>();
const queue = [...wanted];
while (queue.length) {
  const name = queue.pop()!;
  if (subset.has(name)) continue;
  const known = classes.get(name);
  if (!known) { if (enums.has(name) || bitfields.has(name)) usedEnums.add(name); continue; }
  subset.set(name, known);
  if (known.parent) queue.push(known.parent);
  for (const prop of known.props ?? []) for (const type of typeNames(prop.type)) queue.push(type);
}

const sorted = <T>(map: Map<string, T>) => [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const out = {
  source: "RTTI dump (red-dump-json layout, exported with RED4.RTTIDumper); generated by tools/native-rtti-subset.ts",
  enums: Object.fromEntries(sorted(enums).map(([name, e]) => [name, usedEnums.has(name) ? (e.members ?? []).map(m => [m.name, Number(m.value)]) : 0])),
  bitfields: Object.fromEntries(sorted(bitfields).map(([name, b]) => [name, (b.members ?? []).map(m => [m.name, m.bit])])),
  classes: Object.fromEntries(sorted(subset).map(([name, c]) => [name, [c.parent ?? "", (c.props ?? []).map(p => [p.name, p.type])]])),
};
const target = join(import.meta.dir, "..", "src", "native", "rtti-subset.json");
writeFileSync(target, JSON.stringify(out) + "\n");
console.log(`${subset.size} classes, ${usedEnums.size} enums with members, ${enums.size} enums, ${bitfields.size} bitfields → ${target} (${statSync(target).size} bytes)`);
