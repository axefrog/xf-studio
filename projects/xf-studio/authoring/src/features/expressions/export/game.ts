/**
 * What the expression exporter reads from the player's game files (research/animation/expression-editor-design.md §6.2–6.3), prepared by
 * the host's prerequisite (`src/expressions-game-prerequisite.ts`) and handed to the plan. Pure types and a strict reader, so the plan is
 * deterministic and the host's result gate can repeat it.
 */
import { ExportRefusal } from "../../../platform/api";

export const EXPRESSIONS_GAME_PREREQUISITE = "expressions/game";
export const EXPRESSIONS_GAME_1 = "xfs/expressions-game-1";

/** Photo mode's expression table and the V face rig paths, as the game resolves them. */
export const EXPRESSION_TABLE_PATH = "base/animations/anim_motion_database/photomode_facial_poses.csv";
export const FACE_RIG_APP_PATH = "base/characters/head/player_base_heads/appearances/head/face_rig/h0_000__basehead_face_rig_photomode.app";
/** The vanilla photo-mode face sets whose `facial_neutral` gives each gender's joint keys, and their appearances in the face rig. */
export const GENDERS = {
  female: { set: "base/animations/ui/photomode/photomode_female_facial.anims", appearance: "h0_000_pwa__basehead__face_rig_photomode" },
  male: { set: "base/animations/ui/photomode/photomode_male_facial.anims", appearance: "h0_000_pma__basehead__face_rig_photomode" },
} as const;
export type Gender = keyof typeof GENDERS;
export const TABLE_HEADERS = ["Index", "AnimationName", "streamingContext", "FallbackAnimationName"] as const;

/** One expression table: its rows (cells in `TABLE_HEADERS` order), where it came from, and its SHA-256 (of the rows' JSON). */
export type GameTable = { readonly rows: readonly (readonly string[])[]; readonly archive: string; readonly provider: string; readonly sha256: string };
/** A gender's face rig: every track name, the main-pose block, and its template clip's joint keys (count and SHA-256). */
export type GameRig = { readonly rig: string; readonly tracks: readonly string[]; readonly main: { readonly start: number; readonly count: number };
  readonly joints: number; readonly constAnimKeys: number; readonly jointBlockSha256: string };
/** The plan's view of the game files (the prerequisite's `plan` value). */
export type GameInputs = {
  readonly schema: typeof EXPRESSIONS_GAME_1;
  /** The table photo mode reads on this route, ignoring XF Studio's own expression tables. */
  readonly table: GameTable;
  /** The game's own table (the base archives'). */
  readonly base: GameTable;
  /** Every archive providing the table path, in load order (the winner first), with its group. */
  readonly providers: readonly { readonly name: string; readonly group: string; readonly provider: string }[];
  /** Whether a visible `archive/pc/mod/modlist.txt` decides the mod archives' order. */
  readonly modOrder: "modlist" | "alphabetical";
  readonly rigs: Readonly<Record<Gender, GameRig>>;
};
/** The builder's view: where the prepared JSON is (the plan's inputs, the template sets, the face rig and the table documents). */
export type GameBuilderInputs = { readonly file: string };
/** The prepared file: the plan's inputs and the documents the build copies its structure from. */
export type GameFile = { readonly plan: GameInputs; readonly sets: Readonly<Record<Gender, unknown>>; readonly faceRig: unknown; readonly table: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const SHA = /^[a-f0-9]{64}$/;

function table(value: unknown): GameTable {
  if (!isRecord(value) || !Array.isArray(value.rows) || !value.rows.every(row => strings(row) && row.length === TABLE_HEADERS.length) ||
      typeof value.archive !== "string" || typeof value.provider !== "string" || typeof value.sha256 !== "string" || !SHA.test(value.sha256))
    throw Error("damaged table");
  return { rows: value.rows.map(row => [...(row as string[])]), archive: value.archive, provider: value.provider, sha256: value.sha256 };
}
function rig(value: unknown): GameRig {
  const main = isRecord(value) ? value.main : undefined;
  if (!isRecord(value) || typeof value.rig !== "string" || !strings(value.tracks) || !isRecord(main) || !Number.isInteger(main.start) || !Number.isInteger(main.count) ||
      (main.start as number) < 0 || (main.start as number) + (main.count as number) > value.tracks.length || !Number.isInteger(value.joints) ||
      !Number.isInteger(value.constAnimKeys) || typeof value.jointBlockSha256 !== "string" || !SHA.test(value.jointBlockSha256))
    throw Error("damaged rig");
  return { rig: value.rig, tracks: [...value.tracks], main: { start: main.start as number, count: main.count as number }, joints: value.joints as number,
    constAnimKeys: value.constAnimKeys as number, jointBlockSha256: value.jointBlockSha256 };
}
/** What the person reads when the prepared inputs are damaged. */
export const GAME_INPUTS_DAMAGED = "What XF Studio read from your game files for expressions is damaged. Build again to read it afresh.";
/** The prepared inputs, checked field by field; throws an `ExportRefusal` (`package_input_missing`) when they are damaged (PIPE-118). */
export function readGameInputs(value: unknown): GameInputs {
  try {
    if (!isRecord(value) || value.schema !== EXPRESSIONS_GAME_1 || !isRecord(value.rigs) || !Array.isArray(value.providers) ||
        (value.modOrder !== "modlist" && value.modOrder !== "alphabetical")) throw Error("damaged");
    const providers = value.providers.map(item => {
      if (!isRecord(item) || typeof item.name !== "string" || typeof item.group !== "string" || typeof item.provider !== "string") throw Error("damaged provider");
      return { name: item.name, group: item.group, provider: item.provider };
    });
    return { schema: EXPRESSIONS_GAME_1, table: table(value.table), base: table(value.base), providers, modOrder: value.modOrder,
      rigs: { female: rig(value.rigs.female), male: rig(value.rigs.male) } };
  } catch {
    throw new ExportRefusal("package_input_missing", GAME_INPUTS_DAMAGED);
  }
}
