// The composite's JSON is pack data. Normalise its author-facing arrays once;
// runtime callers receive ordinary copied Pattern/Vocabulary values.
import type { Pattern, Vocabulary } from '../seeding/pattern-types.ts';
export type * from '../seeding/pattern-types.ts';
export interface VocabularyDocument {
  functions: Array<Vocabulary['functions'][string] & { id: string }>;
  relations: Array<Vocabulary['relations'][string] & { id: string }>;
  tokenPrecedence: string[];
}
export function readVocabulary(document: VocabularyDocument): Vocabulary {
  const index = <T extends { id: string }>(rows: T[]): Record<string, T> => {
    const result: Record<string, T> = {};
    for (const row of rows) {
      if (result[row.id]) throw new Error(`Duplicate vocabulary id: ${row.id}`);
      result[row.id] = structuredClone(row);
    }
    return result;
  };
  const functions = index(document.functions), relations = index(document.relations);
  if (new Set(document.tokenPrecedence).size !== document.tokenPrecedence.length
    || document.tokenPrecedence.length !== Object.keys(functions).length
    || document.tokenPrecedence.some((id) => !functions[id]))
    throw new Error('tokenPrecedence must name every function exactly once');
  return { functions, relations, tokenPrecedence: document.tokenPrecedence.slice() };
}
export function readPatternFamilies(families: Array<{ patterns: Pattern[] }>): Pattern[] {
  const patterns = families.flatMap((f) => structuredClone(f.patterns));
  if (new Set(patterns.map((p) => p.id)).size !== patterns.length) throw new Error('Duplicate pattern id');
  return patterns;
}
