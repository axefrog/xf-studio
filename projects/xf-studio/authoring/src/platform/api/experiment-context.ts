import type { DocumentStorePort, SavedDocument, StoredDocument } from "./document-store";
import type { DocumentHistory } from "./history";
import type { Task } from "./tasks";

/**
 * What an enabled experiment is created with. The platform injects everything with a lifetime, an identity or timing,
 * so an experiment's tests run deterministically:
 *
 * - `documents`: the library's document store, for its authored documents; `document` holds one of them (saved in order);
 * - `history`: the shared document history, for their Undo and Redo;
 * - `newId`: a fresh unique ID (seeded in tests);
 * - `task`: a newest-request-wins task that ends with the experiment;
 * - `signal`: the experiment's lifetime, aborted when it is turned off.
 */
export type ExperimentContext = {
  readonly documents: DocumentStorePort;
  readonly history: DocumentHistory;
  readonly signal: AbortSignal;
  newId(): string;
  task<T>(): Task<T>;
  document<T>(kind: string, id: string, initial: T, stored?: StoredDocument<T>): SavedDocument<T>;
};
