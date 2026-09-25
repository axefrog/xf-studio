/**
 * Eye makeup's stored data (feature-module platform §2): the part codec, the per-look editor
 * memory and the feature-wide memory. Part 1 is the in-memory recipe verbatim, so it is the
 * lossless target of `parseRecipe`; reading migrates older recipe schemas exactly as before.
 */
import type { EditorCodec, MemoryCodec, PartCodec, PartEnvelope } from "../../platform/api";
import { parseFieldSelection, type FieldSelection } from "../../field-selection";
import { parseGlitterChoices, type GlitterChoices } from "../../glitter-model";
import { emptyRecipe, parseRecipe, starterRecipe, type Recipe } from "../../recipe";

export const EYE_MAKEUP_PART_1 = "xfs/eye-makeup-part-1";
/** Every recipe schema `parseRecipe` reads; a bare file of one of these is an eye-makeup recipe. */
export const RECIPE_SCHEMAS: readonly string[] = ["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3", "xfs/recipe-4",
  "xfs/recipe-5", "xfs/recipe-6", "xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"];

export const eyeMakeupPart: PartCodec<Recipe> = Object.freeze({
  current: EYE_MAKEUP_PART_1,
  accepts: [EYE_MAKEUP_PART_1],
  parse(envelope: PartEnvelope): Recipe {
    if (envelope.schema !== EYE_MAKEUP_PART_1) throw Error(`Unsupported eye-makeup part schema ${envelope.schema}.`);
    return parseRecipe(envelope.body);
  },
  serialize: (recipe: Recipe): PartEnvelope => ({ schema: EYE_MAKEUP_PART_1, body: recipe }),
  lift(file: unknown): Recipe | undefined {
    const schema = (file as { schema?: unknown } | null)?.schema;
    return typeof schema === "string" && RECIPE_SCHEMAS.includes(schema) ? parseRecipe(file) : undefined;
  },
  downgrade: (recipe: Recipe, schema: string) => schema === EYE_MAKEUP_PART_1 ? { schema, body: recipe } : undefined,
  empty: emptyRecipe,
  starter: starterRecipe,
  summary: (recipe: Recipe) => ({ layers: recipe.layers.length }),
  // A recipe holds at most 32 layers of 24 points and 8 warp fields: far below this.
  maxBytes: 2_000_000,
  legacy: { presetField: "recipe", schema: EYE_MAKEUP_PART_1 },
});

/** Per-look editor memory: the active layer, its selected point and each layer's selected warp control. */
export type EyeMakeupEditor = { active: number; selected: number; fieldSelection?: FieldSelection };

export const eyeMakeupEditor: EditorCodec<EyeMakeupEditor, Recipe> = Object.freeze({
  empty: (): EyeMakeupEditor => ({ active: 0, selected: 0 }),
  /** Out-of-range selections fall back to the first layer and point, as the workspace-1 reader did. */
  parse(value: unknown, recipe: Recipe): EyeMakeupEditor {
    const input = value as Partial<EyeMakeupEditor> | undefined, out: EyeMakeupEditor = { active: 0, selected: 0 };
    if (input && Number.isInteger(input.active) && input.active! >= 0 && input.active! < recipe.layers.length) out.active = input.active!;
    if (input && Number.isInteger(input.selected) && input.selected! >= 0 &&
        input.selected! < (recipe.layers[out.active]?.points.length ?? 0)) out.selected = input.selected!;
    out.fieldSelection = parseFieldSelection(input?.fieldSelection, recipe);
    return out;
  },
  serialize: (editor: EyeMakeupEditor) => ({ active: editor.active, selected: editor.selected,
    ...(editor.fieldSelection ? { fieldSelection: structuredClone(editor.fieldSelection) } : {}) }),
});

/**
 * Feature-wide memory: each layer's inactive Glitter-model settings and last Colour-shift
 * settings, keyed `<preset>/<layer>` as workspace-1's `glitterChoices` was (verbatim, so
 * settings of a preset that is not loaded come back when its collection is opened again).
 */
export type EyeMakeupMemory = { choices: GlitterChoices };
export const eyeMakeupMemory: MemoryCodec<EyeMakeupMemory> = Object.freeze({
  empty: (): EyeMakeupMemory => ({ choices: {} }),
  parse: (value: unknown): EyeMakeupMemory => ({ choices: parseGlitterChoices((value as { choices?: unknown } | null)?.choices) }),
  serialize: (memory: EyeMakeupMemory) => ({ choices: structuredClone(memory.choices) }),
});
