/**
 * Eye makeup's stored data (feature-module platform §2): the part codec, the per-look editor
 * memory and the feature-wide memory.
 *
 * - Part 2 (`xfs/eye-makeup-part-2`, current) is the in-memory recipe: no recipe-level schema;
 *   each layer's optical models are validated by the model registry (`layer-models.ts`).
 * - Part 1 (`xfs/eye-makeup-part-1`) is a recipe file body with its `xfs/recipe-N` schema. It
 *   reads into part 2 without any appearance change, and `downgrade` writes it back in the
 *   oldest recipe schema that holds every layer's models, so the minimal writers keep producing
 *   `xfas/collection-1` (and `xfs/recipe-N`) that 0.1.0-alpha.1 reads whenever the content allows.
 * - A bare recipe file of any schema lifts into a part-2 recipe, migrating exactly as before.
 */
import type { EditorCodec, MemoryCodec, PartCodec, PartEnvelope } from "../../platform/api";
import { parseFieldSelection, type FieldSelection } from "../../field-selection";
import { parseGlitterChoices, type GlitterChoices } from "../../glitter-model";
import { LAYER_MODELS, type LayerModelRegistry } from "../../layer-models";
import { emptyRecipe, joinRecipe, recipeChunks, starterRecipe, type Recipe } from "../../recipe";
import { EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2, parseEyeMakeupPart, readPortableRecipe, recipeFile,
  RECIPE_SCHEMAS } from "../../recipe-schema";

export { EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2, RECIPE_SCHEMAS };

/** Eye makeup's part codec over a layer-model registry (the build's own by default; tests pass others). */
export function eyeMakeupPartCodec(models: LayerModelRegistry = LAYER_MODELS): PartCodec<Recipe> {
  return Object.freeze({
    current: EYE_MAKEUP_PART_2,
    /** Oldest first: `downgrade` targets and the minimal writers try them in this order. */
    accepts: [EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2],
    parse: (envelope: PartEnvelope): Recipe => parseEyeMakeupPart(envelope, models),
    serialize: (recipe: Recipe): PartEnvelope => ({ schema: EYE_MAKEUP_PART_2, body: recipe }),
    lift: (file: unknown): Recipe | undefined => readPortableRecipe(file, models),
    downgrade(recipe: Recipe, schema: string): PartEnvelope | undefined {
      if (schema === EYE_MAKEUP_PART_2) return { schema, body: recipe };
      const body = schema === EYE_MAKEUP_PART_1 ? recipeFile(recipe, models) : undefined;
      return body && { schema, body };
    },
    empty: emptyRecipe,
    starter: starterRecipe,
    summary: (recipe: Recipe) => ({ layers: recipe.layers.length }),
    // The look history stores a recipe as its header and one chunk per layer.
    chunks: recipeChunks,
    join: joinRecipe,
    // A recipe holds at most 32 layers of 24 points and 8 warp fields: far below this.
    maxBytes: 2_000_000,
    legacy: { presetField: "recipe", schema: EYE_MAKEUP_PART_1 },
  });
}
export const eyeMakeupPart: PartCodec<Recipe> = eyeMakeupPartCodec();

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
