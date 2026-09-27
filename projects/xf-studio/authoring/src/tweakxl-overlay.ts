/**
 * The TweakDB records installed TweakXL mods declare in YAML, read the way TweakXL reads them, as an overlay on the compiled TweakDB
 * (research/character-customization/choice-icons-design.md §4.3). Pure: files in (their text, path and provider, in the route's view of
 * `r6/tweaks`), a record table out, with provenance, conflicts and gaps. Nothing here names a mod or a record: the creator's icons use it
 * first, clothing and the pose library later.
 *
 * TweakXL's rules [source: TweakXL 1.11.4, commit f8da6be4: `TweakImporter.cpp`, `TweakService.cpp`, `Yaml/YamlReader*.cpp`]:
 * - **Order**: files whose name starts with `_`, `#`, `$` or `!` load first, `^` last, everything else between; within a band, the
 *   directory iteration order (here: by virtual path, which NTFS iteration follows by name [hypothesis]).
 * - **Records**: a top-level key whose value is a map with `$type` (full `gamedataX_Record` or short `X`) or `$base` (inherit every field
 *   of another record, then override). A later file setting a record again updates the fields it names; two files setting one field
 *   differently are recorded as a conflict (the later wins).
 * - **Flats**: a dotted top-level key with a plain value sets one field (`Record.Name.field`).
 * - **Templates**: `$instances` expands a record per instance: every `$(name)` or `${name}` in the record name and its string values is
 *   replaced (a value that is only a placeholder takes the instance value whole), names up to 512 characters.
 * - **Conditions**: `$dlc` keeps a node only when the DLC is installed; `$game` (a game-version condition) is kept and recorded as a gap,
 *   since the installed version isn't compared here.
 * - **Values**: plain values and lists are kept as parsed. TweakXL's list operations (`!append`, `!prepend`, `!merge`, `!remove` and their
 *   variants) are tags the YAML parser drops, so their lists are kept whole and a gap names the file (icons don't use them; clothing will).
 * - `.tweak` files (TweakXL's other format) are listed as a gap.
 */

export interface TweakFile {
  /** The path below the game folder (`r6/tweaks/…`), forward slashes. */
  readonly path: string;
  /** Who supplied it (the MO2 mod, the game folder). */
  readonly provider: string;
  readonly text: string;
}
export interface OverlayRecord {
  readonly name: string;
  /** The short type (`UIIcon`), when a file gave one. */
  readonly type: string | null;
  readonly base: string | null;
  readonly fields: ReadonlyMap<string, unknown>;
  /** The files that set it, in load order. */
  readonly from: readonly string[];
}
export interface TweakOverlay {
  readonly records: ReadonlyMap<string, OverlayRecord>;
  /** A record's field, following `$base` records of the overlay (null when the overlay doesn't set it). */
  field(record: string, field: string): unknown;
  readonly conflicts: readonly { readonly record: string; readonly field: string; readonly files: readonly string[] }[];
  readonly gaps: readonly string[];
  readonly files: number;
}
export interface OverlayEnvironment { readonly dlc: ReadonlySet<string> }

const MAX_NAME = 512, MAX_INSTANCES = 100_000;
/** TweakXL's load band of a file by the first character of its name. */
export function tweakBand(path: string): 0 | 1 | 2 {
  const name = path.split("/").pop() ?? path;
  return /^[_#$!]/.test(name) ? 0 : name.startsWith("^") ? 2 : 1;
}
/** The files in TweakXL's load order. */
export const tweakOrder = <T extends { path: string }>(files: readonly T[]): T[] =>
  [...files].sort((a, b) => tweakBand(a.path) - tweakBand(b.path) || (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0));
/** `gamedataUIIcon_Record` → `UIIcon`. */
export const shortType = (type: string) => type.replace(/^gamedata/, "").replace(/_Record$/, "");
const isMap = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Replace `$(name)` and `${name}` in a string; a string that is only one placeholder takes the value whole. */
function substitute(value: unknown, instance: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === "string") {
    const whole = /^\$(?:\(([^)]+)\)|\{([^}]+)\})$/.exec(value);
    if (whole) { const key = whole[1] ?? whole[2]!; return key in instance ? instance[key] : value; }
    return value.replace(/\$(?:\(([^)]+)\)|\{([^}]+)\})/g, (all, a: string | undefined, b: string | undefined) => {
      const key = a ?? b!;
      return key in instance ? String(instance[key]) : all;
    });
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, instance));
  if (isMap(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, instance)]));
  return value;
}

export function readTweakOverlay(files: readonly TweakFile[], environment: OverlayEnvironment = { dlc: new Set() }): TweakOverlay {
  const records = new Map<string, { name: string; type: string | null; base: string | null; fields: Map<string, unknown>; from: string[]; setBy: Map<string, string> }>();
  const conflicts: { record: string; field: string; files: string[] }[] = [];
  const gaps: string[] = [];
  const keep = (node: Record<string, unknown>, where: string) => {
    if ("$dlc" in node) {
      const wanted = String(node.$dlc ?? "").toUpperCase();
      if (!environment.dlc.has(wanted)) return false;
    }
    if ("$game" in node) gaps.push(`${where}: a $game condition is not compared with the installed game version; the node is read.`);
    return true;
  };
  const record = (name: string, file: TweakFile) => {
    let known = records.get(name);
    if (!known) { known = { name, type: null, base: null, fields: new Map(), from: [], setBy: new Map() }; records.set(name, known); }
    if (known.from.at(-1) !== file.path) known.from.push(file.path);
    return known;
  };
  const set = (target: ReturnType<typeof record>, field: string, value: unknown, file: TweakFile) => {
    const before = target.setBy.get(field);
    if (before && before !== file.path && JSON.stringify(target.fields.get(field)) !== JSON.stringify(value)) {
      const known = conflicts.find(entry => entry.record === target.name && entry.field === field);
      if (known) { if (!known.files.includes(file.path)) known.files.push(file.path); }
      else conflicts.push({ record: target.name, field, files: [before, file.path] });
    }
    target.fields.set(field, value);
    target.setBy.set(field, file.path);
  };
  const define = (name: string, body: Record<string, unknown>, file: TweakFile) => {
    if (!name || name.length > MAX_NAME || !keep(body, `${file.path}: ${name}`)) return;
    const target = record(name, file);
    if (typeof body.$type === "string") target.type = shortType(body.$type);
    if (typeof body.$base === "string") target.base = body.$base;
    for (const [field, value] of Object.entries(body)) if (!field.startsWith("$")) set(target, field, value, file);
  };
  let tweakFiles = 0;
  for (const file of tweakOrder(files)) {
    if (/\.tweak$/i.test(file.path)) { gaps.push(`${file.path}: a .tweak file (TweakXL's other format) is not read.`); continue; }
    tweakFiles++;
    let document: unknown;
    try { document = Bun.YAML.parse(file.text); }
    catch (error) { gaps.push(`${file.path}: not readable YAML (${(error as Error).message.slice(0, 120)}).`); continue; }
    if (/(^|\s)!(append|prepend|merge|remove)/m.test(file.text)) gaps.push(`${file.path}: uses list operations, which are kept as whole lists.`);
    if (!isMap(document)) continue;
    for (const [key, value] of Object.entries(document)) {
      if (isMap(value) && ("$type" in value || "$base" in value || "$instances" in value)) {
        const instances = Array.isArray(value.$instances) ? value.$instances.filter(isMap).slice(0, MAX_INSTANCES) : null;
        if (!instances) { define(key, value, file); continue; }
        const { $instances: _ignored, ...template } = value;
        for (const instance of instances) define(String(substitute(key, instance)), substitute(template, instance) as Record<string, unknown>, file);
      } else if (key.includes(".") && !isMap(value)) {
        // A flat: `Record.Name.field: value`.
        const at = key.lastIndexOf(".");
        const target = record(key.slice(0, at), file);
        set(target, key.slice(at + 1), value, file);
      }
    }
  }
  const field = (name: string, wanted: string, depth = 0): unknown => {
    const known = records.get(name);
    if (!known || depth > 16) return null;
    if (known.fields.has(wanted)) return known.fields.get(wanted);
    return known.base ? field(known.base, wanted, depth + 1) : null;
  };
  const frozen = new Map<string, OverlayRecord>([...records].map(([name, entry]) => [name, { name, type: entry.type, base: entry.base, fields: entry.fields, from: entry.from }]));
  return { records: frozen, field: (name, wanted) => field(name, wanted), conflicts, gaps, files: tweakFiles };
}

/** A `UIIcon` record's atlas path and part from the overlay, or null when the overlay doesn't define it. */
export function overlayIcon(overlay: TweakOverlay, record: string): { atlasPath: string | null; part: string | null } | null {
  if (!overlay.records.has(record)) return null;
  const path = overlay.field(record, "atlasResourcePath"), part = overlay.field(record, "atlasPartName");
  return { atlasPath: typeof path === "string" && path ? path : null, part: typeof part === "string" && part ? part : typeof part === "number" ? String(part) : null };
}
