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
  /** What a command names as its `base`: it moves with every command recorded here and every change taken from elsewhere. */
  readonly revision: number;
  /** It changed in another page while this one changed it too: nothing is written over either; the Character panel offers which to keep. */
  readonly conflict: boolean;
  /** Changes made here aren't in the library yet because the library didn't answer: the outbox keeps them and sends them again. */
  readonly unsaved: boolean;
};
export const characterRef = (id: string): SubjectRef => ({ kind: CHARACTER_KIND, id });

export interface CharactersPort {
  /** Every live character, oldest first (frozen; the same array until something changes). */
  list(): readonly CharacterSummary[];
  character(id: string): CharacterSummary | null;
  subscribe(listener: () => void): () => void;
}
