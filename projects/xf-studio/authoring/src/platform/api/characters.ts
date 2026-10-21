/**
 * The characters port (profiles design §1.1, §7): how features and presentations reach characters, by ID. A feature never holds a
 * character's service or context; it reads summaries through this port and names the character in every action it dispatches. There is
 * no current character. Types only; `CharacterService` (src/character/character-service.ts) implements it.
 */
import type { SubjectRef } from "./subjects";

export const CHARACTER_KIND = "character";
export type CharacterBody = "female" | "male";
/** Where a V comes from. */
export type CharacterOrigin = "default" | "save" | "preset";
export type CharacterSummary = {
  readonly id: string;
  /** Its own name, else a plain description of where it comes from. */
  readonly label: string;
  readonly body: CharacterBody;
  readonly origin: CharacterOrigin;
  /** The revision a command names as its `base`. */
  readonly revision: number;
  /** It changed elsewhere since this page read it; nothing is written over that (phase 1c resolves it). */
  readonly conflict: boolean;
};
export const characterRef = (id: string): SubjectRef => ({ kind: CHARACTER_KIND, id });

export interface CharactersPort {
  /** Every live character, oldest first (frozen; the same array until something changes). */
  list(): readonly CharacterSummary[];
  character(id: string): CharacterSummary | null;
  subscribe(listener: () => void): () => void;
}
