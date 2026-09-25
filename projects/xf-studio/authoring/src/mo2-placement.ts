/** Pure placement of one of our own mods into an MO2 profile's `modlist.txt`.
 *
 * MO2 writes `modlist.txt` highest priority first, so the file is the REVERSE of the left pane:
 * the first row is the bottom of the pane and the last row is the top. A separator heads the
 * mods below it in the pane, which in the file are the rows ABOVE its line, back to the previous
 * separator. Rows after the last separator line sit loose at the top of the pane.
 *
 * The rule adds exactly one row and moves nothing else (research/authoring/framework-version-check.md, "MO2 placement rule"):
 * 1. The mod is already listed (enabled or not): keep the user's position.
 * 2. A related entry is listed (an earlier name or predecessor of this mod), outside a framework
 *    section: go directly below it in the pane (one row higher priority, same section).
 * 3. Otherwise go to the bottom of the pane, where MO2 itself puts a newly installed mod, unless
 *    that section holds frameworks; then use the bottom of the nearest section above it that
 *    does not. Loose rows at the top of the pane are never used.
 * 4. If every section holds frameworks, fall back to MO2's own default (bottom of the pane).
 */

export type Mo2PlacementRule = "existing" | "beside-related" | "section" | "list-end" | "fallback";
export interface Mo2Placement {
  readonly rule: Mo2PlacementRule;
  readonly modName: string;
  /** 0-based modlist.txt row: the existing row, or where the new row is inserted. */
  readonly row: number;
  /** The related entry this mod is placed beside. */
  readonly anchor: string | null;
  /** Display name of the separator whose section will contain the mod; null when the list has none. */
  readonly section: string | null;
  /** Plain-language position in MO2's left pane. */
  readonly description: string;
}
export interface Mo2PlacementOptions {
  /** Entries to sit beside, in order of preference. */
  readonly related?: readonly string[];
  /** Mod folders known to provide a framework; any section holding one is a framework section. */
  readonly frameworkMods?: Iterable<string>;
}

/** A separator whose name says it holds core libraries/frameworks, e.g. "CORE, LIBS, FRAMEWORKS". */
export const FRAMEWORK_SECTION_NAME =
  /\b(?:frameworks?|core|libs?|librar(?:y|ies)|requirements?|dependenc(?:y|ies)|prerequisites?)\b/i;
const SEPARATOR = /_separator$/i;

type Row = { index: number; name: string; prefix: string } | null;
function rows(text: string) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines.length && lines.at(-1) === "") lines.pop();
  const parsed: Row[] = lines.map((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return null;
    const prefix = ["+", "-", "*"].includes(line[0]!) ? line[0]! : "";
    const name = (prefix ? line.slice(1) : line).trim();
    return name ? { index, name, prefix } : null;
  });
  return { lines, parsed };
}
const displayName = (separator: string) => separator.replace(SEPARATOR, "");

export function planMo2Placement(text: string, modName: string, options: Mo2PlacementOptions = {}): Mo2Placement {
  if (!modName || /[\r\n\\/:]/.test(modName) || SEPARATOR.test(modName)) throw Error("Invalid mod name.");
  const { lines, parsed } = rows(text);
  const entries = parsed.filter((row): row is NonNullable<Row> => row !== null);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const frameworkMods = new Set([...(options.frameworkMods ?? [])].map(name => name.toLowerCase()));
  const separators = entries.filter(row => SEPARATOR.test(row.name) && row.prefix !== "*");
  // The separator owning a row is the first separator line at or after it in the file.
  const ownerOf = (index: number) => separators.find(separator => separator.index >= index) ?? null;
  const members = (separator: NonNullable<Row>) => {
    const previous = separators[separators.indexOf(separator) - 1]?.index ?? -1;
    return entries.filter(row => row.index > previous && row.index < separator.index);
  };
  const frameworkSection = (separator: NonNullable<Row>) => FRAMEWORK_SECTION_NAME.test(displayName(separator.name)) ||
    members(separator).some(row => frameworkMods.has(row.name.toLowerCase()));
  const sectionOf = (index: number) => { const owner = ownerOf(index); return owner ? displayName(owner.name) : null; };
  const firstEntry = entries[0]?.index ?? lines.length;

  const existing = entries.find(row => same(row.name, modName));
  if (existing) return { rule: "existing", modName, row: existing.index, anchor: null, section: sectionOf(existing.index),
    description: `${modName} is already in this profile's list; its position is kept.` };

  for (const related of options.related ?? []) {
    const row = entries.find(entry => same(entry.name, related) && !SEPARATOR.test(entry.name));
    if (!row) continue;
    const owner = ownerOf(row.index);
    if (owner && frameworkSection(owner)) continue;
    const section = owner ? displayName(owner.name) : null;
    return { rule: "beside-related", modName, row: row.index, anchor: row.name, section,
      description: `Directly below "${row.name}"${section ? ` in the "${section}" section` : ""}.` };
  }

  if (!separators.length) return { rule: "list-end", modName, row: firstEntry, anchor: null, section: null,
    description: "At the bottom of the mod list, where Mod Organizer puts newly installed mods." };
  for (const [position, separator] of separators.entries()) {
    if (frameworkSection(separator)) continue;
    const row = position === 0 ? firstEntry : separators[position - 1]!.index + 1;
    const section = displayName(separator.name);
    return { rule: "section", modName, row, anchor: null, section, description: position === 0
      ? `At the bottom of the "${section}" section, where Mod Organizer puts newly installed mods.`
      : `At the bottom of the "${section}" section, the lowest section that does not hold frameworks.` };
  }
  return { rule: "fallback", modName, row: firstEntry, anchor: null, section: displayName(separators[0]!.name),
    description: "At the bottom of the mod list, where Mod Organizer puts newly installed mods. " +
      "Every section in this profile holds frameworks, so you may want to move it." };
}

/** Add (or, for an existing row, only enable/disable) the placed mod; every other row is unchanged. */
export function applyMo2Placement(text: string, placement: Mo2Placement, enabled = true): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const { lines } = rows(text);
  const entry = `${enabled ? "+" : "-"}${placement.modName}`;
  if (placement.rule === "existing") {
    const current = lines[placement.row]?.trim() ?? "";
    const name = ["+", "-"].includes(current[0] ?? "") ? current.slice(1).trim() : current;
    if (name.toLowerCase() !== placement.modName.toLowerCase()) throw Error("Placement no longer matches the modlist.");
    lines[placement.row] = `${enabled ? "+" : "-"}${name}`;
  } else {
    if (placement.row < 0 || placement.row > lines.length) throw Error("Placement no longer matches the modlist.");
    lines.splice(placement.row, 0, entry);
  }
  return bom + lines.join(newline) + newline;
}
