/**
 * Preset sets (research/animation/expression-editor-design.md §6.4): a named, ordered list of a feature's saved presets, kept in the
 * library beside them (part-preset-store.ts), and exported as one XF-branded mod. DOM-free and pure: the set's types, its default mod
 * name, and the package-only collection a set's export sends to the platform's Check and Build (feature-module platform §6), so a set
 * plans, builds, verifies and records exactly as a look collection does.
 */
import { COLLECTION_2, modNameIssue, type ExportOmission, MOD_NAME_MAX, PACKAGE_PLAN_1, type LookCollection, type PackageBuildResult, type PackageCheckResult,
  type PartEnvelope } from "./platform/api";

export type PartPresetSetTable = "installed" | "sharing";
export type PartPresetSet = { id: string; feature: string; name: string; revision: number; members: string[]; modName?: string;
  table?: PartPresetSetTable; updatedAt: string };
export type PartPresetSetList = { phase: "loading" | "ready" | "failed"; items: readonly PartPresetSet[]; reason?: string };
/** A saved preset as a set reads it. */
export type SetMemberPreset = { id: string; name: string; revision: number; part: PartEnvelope };

/** The brand a feature's set mod is named after when the person hasn't named it. */
export const SET_BRANDS: Readonly<Record<string, string>> = { expressions: "XF Expressions" };
/** Characters a mod-manager folder can't hold (modNameIssue), dropped from a set name before it joins the default mod name. */
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;
/**
 * A set's mod name when the person hasn't chosen one: "XF Expressions - <set name>". A colon can't be in a folder name, so the brand
 * and the set's name are joined by a dash; characters a folder can't hold are dropped, and the name is kept within the limit.
 */
export function defaultSetModName(feature: string, setName: string): string {
  const brand = SET_BRANDS[feature] ?? "XF Mod";
  const tail = setName.replace(UNSAFE, "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  const name = tail ? `${brand} - ${tail}` : brand;
  const cut = name.length > MOD_NAME_MAX ? name.slice(0, MOD_NAME_MAX).trim().replace(/[.\s-]+$/, "") : name;
  return modNameIssue(cut) === undefined ? cut : brand;
}
/** The mod name a set builds: the person's, else the default. */
export const setModName = (set: Pick<PartPresetSet, "feature" | "name" | "modName">) => set.modName ?? defaultSetModName(set.feature, set.name);

/** Where each member stands: its saved preset, or gone from the library. */
export function setMembers(set: Pick<PartPresetSet, "members">, presets: readonly SetMemberPreset[]): { id: string; preset?: SetMemberPreset }[] {
  const byId = new Map(presets.map(preset => [preset.id, preset]));
  return set.members.map(id => ({ id, ...(byId.has(id) ? { preset: byId.get(id)! } : {}) }));
}

/** What marks a package collection as a preset set's (`presetSet`), with the set's export choices. */
export type PresetSetMark = { readonly table: PartPresetSetTable };
/**
 * The package-only collection a set exports: its ID and name, one look per member still in the library (in the set's order, each
 * carrying that saved preset as its only part), a package plan naming the mod, and `presetSet` with the set's table choice. Members gone
 * from the library are left out here and reported by the set's view; the platform reports everything else. The mark is what a
 * set-only exporter (expressions) looks for, so a look collection's expression parts never change its own mods.
 */
export function setCollection(set: PartPresetSet, presets: readonly SetMemberPreset[]): LookCollection & { presetSet: PresetSetMark } {
  const looks = setMembers(set, presets).flatMap(member => member.preset
    ? [{ id: member.preset.id, name: member.preset.name, revision: member.preset.revision, parts: { [set.feature]: member.preset.part } }] : []);
  return { schema: COLLECTION_2, id: set.id, name: set.name, presets: looks,
    packagePlan: { schema: PACKAGE_PLAN_1, products: [{ id: set.id, name: setModName(set), features: [set.feature] }] },
    presetSet: { table: set.table ?? "installed" } };
}

/** The latest Check or Build of one set, or the reason it failed, with the set's revision it was made from. */
export type SetExportResult =
  | { kind: "check"; result: PackageCheckResult; revision: number; missing: number }
  | { kind: "build"; result: PackageBuildResult; revision: number; missing: number }
  | { kind: "failed"; action: "check" | "build"; code: string; message: string; revision: number;
      /** When nothing could be packaged: each expression and why (the result then shows them with their next step). */
      omissions?: readonly ExportOmission[] };
export type SetExportState = { busy: { id: string; action: "check" | "build" | "reveal" } | null; results: Readonly<Record<string, SetExportResult>> };
