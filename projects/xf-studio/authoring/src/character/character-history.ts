/**
 * A character's Undo history in the history service (profiles design §3.7): one scope, `character:<id>`, holding its creator choices,
 * its Clothing setting and its own-makeup setting in the order they were made. Session-only. The scope outlives any one context of the
 * character (a head loaded again for another body makes a new context): the context showing the character now is bound to it, and
 * moves through its steps.
 *
 * Keys: `v` (where the V comes from and every choice set on it), `clothing` and `makeup`. Values are kept whole and by reference.
 */
import type { HistoryCause, HistoryTarget } from "../platform/api/history";
import { createHistoryService, type HistoryScope, type HistoryService } from "../platform/core/history-service";

export const CHARACTER_SCOPE_PREFIX = "character:";
export const characterScope = (id: string) => `${CHARACTER_SCOPE_PREFIX}${id}`;
/** Steps kept per character. */
export const CHARACTER_HISTORY_LIMIT = 100;
/** The keys a character's steps change. */
export type CharacterHistoryKey = "v" | "clothing" | "makeup";

type Binding = { target: HistoryTarget | null; readonly scope: HistoryScope };
const bindings = new WeakMap<HistoryService, Map<string, Binding>>();

/** Where a character's history lives: a history service and the character's ID. Opaque to everyone but the character's context. */
export type CharacterHistoryHome = { readonly service: HistoryService; readonly id: string };

/** A context's own history for a character no service names (a fixture, a test): a private service. */
export const privateHistory = (): CharacterHistoryHome => ({ service: createHistoryService(), id: "local" });

/**
 * The character's scope, opened the first time, and `bind`, which makes `target` the context it moves (the newest bound wins; `unbind`
 * lets go only while it is still the bound one).
 */
export function characterHistory(home: CharacterHistoryHome): { scope: HistoryScope; bind(target: HistoryTarget): () => void } {
  let map = bindings.get(home.service);
  if (!map) bindings.set(home.service, map = new Map());
  let binding = map.get(home.id);
  if (!binding || home.service.scope(characterScope(home.id)) !== binding.scope) {
    const made: { target: HistoryTarget | null } = { target: null };
    const scope = home.service.open(characterScope(home.id), {
      read: key => made.target?.read(key),
      apply: (values, cause: HistoryCause) => made.target ? made.target.apply(values, cause) : false,
      settled: () => made.target?.settled?.(),
    }, { limit: CHARACTER_HISTORY_LIMIT });
    binding = Object.assign(made, { scope });
    map.set(home.id, binding);
  }
  const held = binding;
  return { scope: held.scope, bind(target) {
    held.target = target;
    return () => { if (held.target === target) held.target = null; };
  } };
}

/** Close a character's scope (the character was released or deleted). */
export function closeCharacterHistory(home: CharacterHistoryHome): void {
  bindings.get(home.service)?.delete(home.id);
  home.service.close(characterScope(home.id));
}
