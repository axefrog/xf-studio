/**
 * What 0.1.0-alpha.2, the oldest published release, reads in a collection library: the schemas its
 * readers accept, vendored from the tag `v0.1.0-alpha.2` (`9ae9280`): `src/platform/api/document.ts`
 * (`COLLECTION_1`, `COLLECTION_2`), `src/recipe-schema.ts` (`RECIPE_FILE_SCHEMAS`) and each
 * registered feature's part codec `accepts` (`src/features/eye-makeup/part.ts`,
 * `src/features/expressions/part.ts`). Its `CollectionLibrary.list()` and `get()` read rows of
 * either collection schema through that part registry, so a row whose schemas are all listed here
 * is one that release lists and opens without locking a look (CORE-123). Test-only: never import it from `src/`.
 */
export const ALPHA_2_COLLECTION_SCHEMAS: readonly string[] = ["xfas/collection-1", "xfs/collection-2"];
export const ALPHA_2_RECIPE_SCHEMAS: readonly string[] = ["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3", "xfs/recipe-4",
  "xfs/recipe-5", "xfs/recipe-6", "xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11", "xfs/recipe-12"];
export const ALPHA_2_PART_SCHEMAS: Readonly<Record<string, readonly string[]>> = {
  "eye-makeup": ["xfs/eye-makeup-part-1", "xfs/eye-makeup-part-2"],
  expressions: ["xfs/expression-part-1"],
};

type Row = { schema?: unknown; presets?: { recipe?: { schema?: unknown }; parts?: Record<string, { schema?: unknown; body?: unknown }> }[] };

/** Every schema in a stored collection row that 0.1.0-alpha.2 would not read (empty: it reads the row). */
export function alpha2Unreadable(row: Row): string[] {
  const issues: string[] = [];
  if (!ALPHA_2_COLLECTION_SCHEMAS.includes(row.schema as string)) issues.push(`collection ${String(row.schema)}`);
  for (const preset of row.presets ?? []) {
    if (preset.recipe && !ALPHA_2_RECIPE_SCHEMAS.includes(preset.recipe.schema as string)) issues.push(`recipe ${String(preset.recipe.schema)}`);
    for (const [feature, part] of Object.entries(preset.parts ?? {})) {
      if (!(ALPHA_2_PART_SCHEMAS[feature] ?? []).includes(part.schema as string)) issues.push(`${feature} ${String(part.schema)}`);
      // Part 1 carries a recipe file.
      if (part.schema === "xfs/eye-makeup-part-1" && !ALPHA_2_RECIPE_SCHEMAS.includes((part.body as { schema?: string })?.schema as string))
        issues.push(`recipe ${String((part.body as { schema?: string })?.schema)}`);
    }
  }
  return issues;
}
