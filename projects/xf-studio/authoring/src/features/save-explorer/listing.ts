/**
 * What the host tells the Save Explorer about the player's saves and name sources (host/saves-server.ts builds these), and the
 * validators the explorer's service runs on each response before using it. Types and pure helpers only.
 */
import type { EngineTypes } from "../../engines/red-object/type-oracle";

export const SAVE_KINDS = ["manual", "quick", "auto", "point-of-no-return", "end-game", "other"] as const;
export type SaveKind = typeof SAVE_KINDS[number];

/** One save as a listing shows it: game facts from its metadata, never the platform user name or any path. */
export type SaveListing = {
  /** The save's folder name: its identity for the host. */
  readonly folder: string;
  readonly kind: SaveKind;
  /** When `sav.dat` was written, ISO 8601. */
  readonly savedAt: string;
  readonly location: string | null;
  readonly level: number | null;
  readonly lifePath: string | null;
  /** The game's patch ("2.31"). */
  readonly gameVersion: string | null;
  readonly saveVersion: number | null;
  readonly bytes: number;
  readonly screenshot: boolean;
  readonly modded: boolean | null;
};
/** Where the saves were looked for: the folder chosen in Settings, the detected Saved Games folder, or a developer's override. */
export const SAVES_FOLDER_SOURCES = ["chosen", "detected", "developer"] as const;
export type SavesFolderSource = typeof SAVES_FOLDER_SOURCES[number];
/** The folder a listing read, as a person would name it (the detected folder is described, never its path). */
export type SavesFolder = { readonly source: SavesFolderSource; readonly display: string };
export type SaveListingResult = { readonly available: boolean; readonly saves: readonly SaveListing[]; readonly reason?: string;
  readonly folder?: SavesFolder };
/** Candidate names for a save's hashes: the engine's shipped type list and the installed scripts' names. */
export type SaveTypeNames = {
  readonly engine: EngineTypes & { readonly enums: readonly string[]; readonly bitfields: readonly string[]; readonly classes: readonly string[]; readonly properties: readonly string[] };
  readonly scripts: { readonly available: boolean; readonly names: readonly string[]; readonly reason?: string };
};

const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const nullableText = (value: unknown, max: number) => value === null || text(value, max);
const nullableNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
const names = (value: unknown, max: number) => Array.isArray(value) && value.length <= max && value.every(item => text(item, 1024));

/** A listing response, validated; throws on anything else. */
export function parseSaveListing(value: unknown): SaveListingResult {
  const v = value as SaveListingResult;
  if (!v || typeof v.available !== "boolean" || !Array.isArray(v.saves) || v.saves.length > 100_000 || !(v.reason === undefined || text(v.reason, 1000)) ||
    !(v.folder === undefined || (v.folder && (SAVES_FOLDER_SOURCES as readonly string[]).includes(v.folder.source) && text(v.folder.display, 1024))) ||
    !v.saves.every(save => save && text(save.folder, 128) && (SAVE_KINDS as readonly string[]).includes(save.kind) && text(save.savedAt, 40) &&
      nullableText(save.location, 128) && nullableNumber(save.level) && nullableText(save.lifePath, 32) && nullableText(save.gameVersion, 16) &&
      nullableNumber(save.saveVersion) && typeof save.bytes === "number" && typeof save.screenshot === "boolean" &&
      (save.modded === null || typeof save.modded === "boolean")))
    throw Error("The saves list couldn't be read.");
  return { available: v.available, saves: v.saves.map(save => ({ folder: save.folder, kind: save.kind, savedAt: save.savedAt, location: save.location,
    level: save.level, lifePath: save.lifePath, gameVersion: save.gameVersion, saveVersion: save.saveVersion, bytes: save.bytes, screenshot: save.screenshot,
    modded: save.modded })), ...(v.reason ? { reason: v.reason } : {}),
    ...(v.folder ? { folder: { source: v.folder.source, display: v.folder.display } } : {}) };
}

/** A names response, validated; throws on anything else. */
export function parseSaveTypeNames(value: unknown): SaveTypeNames {
  const v = value as SaveTypeNames;
  if (!v || !v.engine || !names(v.engine.enums, 100_000) || !names(v.engine.bitfields, 100_000) || !names(v.engine.classes, 200_000) ||
    !names(v.engine.properties, 500_000) || !v.scripts || typeof v.scripts.available !== "boolean" || !names(v.scripts.names, 2_000_000) ||
    !(v.scripts.reason === undefined || text(v.scripts.reason, 1000)))
    throw Error("The type names couldn't be read.");
  return v;
}

/** A save's kind in plain words. */
export const SAVE_KIND_LABELS: Readonly<Record<SaveKind, string>> = { manual: "Manual save", quick: "Quick save", auto: "Autosave",
  "point-of-no-return": "Point of no return", "end-game": "End-game save", other: "Save" };
