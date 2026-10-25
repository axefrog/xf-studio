// The facts table of the M3 world: the game facts layer 2 may read, taken from the curated main-story table
// (research/story-engine/main-story-facts.json). No fact is invented.

import type { FactsTable } from '../seeding/types.ts';
import table from '../../../../../research/story-engine/main-story-facts.json' with { type: 'json' };

interface Row { name: string; category: string; reading: string }
export const MAIN_STORY_FACTS: Row[] = (table as { facts: Row[] }).facts;
export const FACT_NAMES = new Set(MAIN_STORY_FACTS.map((f) => f.name));

/** The whole table as a facts table (no guards: M3 reads only plain progress facts). */
export function factsTable(): FactsTable {
  return Object.fromEntries(MAIN_STORY_FACTS.map((f) => [f.name, {}]));
}
