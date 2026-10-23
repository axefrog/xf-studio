/**
 * The subject kinds this build composes (profiles design §1.1): each kind registers itself here. `character` is the first; nothing
 * outside this file names the list, and nothing assumes it has one entry.
 */
import { SubjectRegistry } from "../platform/core/subject-registry";
import { CHARACTER_SUBJECT } from "../character/character-document";

export const STUDIO_SUBJECT_KINDS = Object.freeze([CHARACTER_SUBJECT]);

/** A registry with every composed subject kind. */
export function createStudioSubjects(): SubjectRegistry {
  const registry = new SubjectRegistry();
  for (const spec of STUDIO_SUBJECT_KINDS) registry.register(spec);
  return registry;
}
