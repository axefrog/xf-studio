import type { SavedDocument, StoredDocument } from "./document-store";
import type { DocumentHistory } from "./history";
import type { Task } from "./tasks";

/**
 * What an enabled experiment is created with. The platform injects everything with a lifetime, an identity or timing,
 * so an experiment's tests run deterministically:
 *
 * - `loadDocuments` and `document`: its authored documents in the library's document store, each through the page's one
 *   holder of that document (saved in order, and the same holder when the experiment is turned off and on again);
 * - `history`: the shared document history, for their Undo and Redo;
 * - `newId`: a fresh unique ID (seeded in tests);
 * - `task`: a newest-request-wins task that ends with the experiment;
 * - `signal`: the experiment's lifetime, aborted when it is turned off.
 */
export type ExperimentContext = {
  readonly history: DocumentHistory;
  readonly signal: AbortSignal;
  newId(): string;
  task<T>(): Task<T>;
  /** Every document of `kind`: those in the store and those the page holds but hasn't saved yet. `signal` abandons the read. */
  loadDocuments<T>(kind: string, signal?: AbortSignal): Promise<readonly SavedDocument<T>[]>;
  /** The page's holder of one document; `initial` and `stored` apply only when the page doesn't hold it yet (a new document starts unsaved). */
  document<T>(kind: string, id: string, initial: T, stored?: StoredDocument<T>): SavedDocument<T>;
};
