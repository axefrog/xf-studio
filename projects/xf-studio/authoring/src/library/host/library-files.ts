/**
 * The host's library files, composed once for both hosts (the localhost dev server and the desktop app): `library.sqlite`
 * (the person's work) and `verification.sqlite` (a `?verify` workspace's own copy). Each file has one owner
 * (`LibraryDatabase`: one connection, the migrations, transactions, durability), and every store of that file takes it. The
 * main file is backed up daily unless the host is isolated (a test server's own data). `handle` serves the stores' routes;
 * `close` flushes and closes both files.
 */
import { resolve } from "node:path";
import { CollectionLibrary, collectionRequest } from "./collection-store";
import { hostFailure } from "../../diagnostics/host/host-log";
import { LookLibrary, libraryRequest } from "./library-store";
import { LIBRARY_MIGRATIONS } from "./library-migrations";
import { PartPresetLibrary, partPresetRequest } from "./part-preset-store";
import { hostClock, type Clock } from "../../platform/core/clock";
import type { PartRegistry } from "../../platform/core/document";
import { LibraryBackups } from "../../platform/persistence/backups";
import { createDocumentsHandler, createWorkspaceLeaseHandler, DocumentStore } from "../../platform/persistence/document-store";
import { importLegacyExperiments } from "../../platform/persistence/legacy-experiment-import";
import { LibraryDatabase, type LibraryDatabaseOptions } from "../../platform/persistence/library-database";

/** The library file `path` with the Studio's migrations (tools and tests; the hosts use `openLibraryFiles`). */
export function openLibraryDatabase(path: string, options: Partial<Omit<LibraryDatabaseOptions, "migrations">> = {}): LibraryDatabase {
  return LibraryDatabase.open(path, { ...options, clock: options.clock ?? hostClock(), backups: options.backups ?? null, migrations: LIBRARY_MIGRATIONS });
}

/** One library file's stores. */
export type LibraryStores = {
  readonly database: LibraryDatabase;
  readonly looks: LookLibrary;
  readonly collections: CollectionLibrary;
  readonly partPresets: PartPresetLibrary;
  readonly documents: DocumentStore;
};

/** Every store of `database`. */
export function libraryStores(database: LibraryDatabase, parts: PartRegistry, now: () => number = Date.now): LibraryStores {
  return { database, looks: new LookLibrary(database), collections: new CollectionLibrary(database, parts),
    partPresets: new PartPresetLibrary(database, parts), documents: new DocumentStore(database, { now }) };
}

export type LibraryFiles = {
  readonly main: LibraryStores;
  readonly verification: LibraryStores;
  /** The answer to a library request (`/api/looks`, `/api/collections`, `/api/part-presets`, `/api/documents`, `/api/workspace-lease`, each also under `/api/verification`), or null for any other path. */
  handle(request: Request, url?: URL): Promise<Response> | null;
  /** Flushes and closes both files and stops the backups. Idempotent. */
  close(): void;
};

export type LibraryFilesOptions = {
  readonly clock: Clock;
  readonly parts: PartRegistry;
  /** An isolated host (a test server's own data folder) takes no backups. */
  readonly isolated: boolean;
  /** Routine events (the one-time copy of development data). */
  readonly log?: (message: string) => void;
  /** A flush that failed (default: the host's diagnostics log). */
  readonly report?: (error: unknown) => void;
};

/** Opens `<dataRoot>/library.sqlite` and `<dataRoot>/verification.sqlite`. */
export function openLibraryFiles(dataRoot: string, options: LibraryFilesOptions): LibraryFiles {
  const { clock, parts } = options;
  const life = new AbortController();
  const report = options.report ??
    (error => hostFailure("library", "flush_failed", "The library couldn't be flushed to disk yet; it will try again.", error, "warn"));
  const open = (file: string, backups: LibraryBackups | null) => {
    const database = openLibraryDatabase(resolve(dataRoot, file), { clock, signal: life.signal, backups, report });
    const stores = libraryStores(database, parts, () => clock.now());
    importLegacyExperiments(database, stores.documents, options.log);
    return stores;
  };
  const backups = options.isolated ? null : new LibraryBackups(resolve(dataRoot, "library.sqlite"), () => clock.now());
  const main = open("library.sqlite", backups);
  let verification: LibraryStores;
  try { verification = open("verification.sqlite", null); } catch (error) { main.database.close(); throw error; }
  // The daily backup, a moment after starting and each day after, until the files close.
  backups?.keepDaily(clock, life.signal);
  const routes = ([[main, "/api"], [verification, "/api/verification"]] as const).flatMap(([stores, base]) => {
    const documents = createDocumentsHandler(stores.documents, `${base}/documents`);
    return [
      { prefix: `${base}/looks`, nested: true, handle: (request: Request) => libraryRequest(request, stores.looks, `${base}/looks`) },
      { prefix: `${base}/collections`, nested: true, handle: (request: Request) => collectionRequest(request, stores.collections, `${base}/collections`) },
      { prefix: `${base}/part-presets`, nested: true, handle: (request: Request) => partPresetRequest(request, stores.partPresets, `${base}/part-presets`) },
      { prefix: `${base}/documents`, nested: false, handle: documents },
      { prefix: `${base}/workspace-lease`, nested: false, handle: createWorkspaceLeaseHandler(stores.documents, `${base}/workspace-lease`) },
    ];
  });
  return {
    main, verification,
    handle(request, url = new URL(request.url)) {
      const path = url.pathname;
      const route = routes.find(item => path === item.prefix || item.nested && path.startsWith(`${item.prefix}/`));
      return route ? route.handle(request) : null;
    },
    close() {
      life.abort();
      main.database.close();
      verification.database.close();
    },
  };
}
