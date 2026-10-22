/**
 * A library file for tests: its owner (`LibraryDatabase`, with the Studio's migrations) and every store of it, as the hosts compose
 * them (src/library/host/library-files.ts). `close()` flushes and closes the file.
 */
import { STUDIO_PARTS } from "../../src/compose/studio-registry";
import { libraryStores, openLibraryDatabase, type LibraryStores } from "../../src/library/host/library-files";
import { PartPresetLibrary } from "../../src/library/host/part-preset-store";
import type { LibraryDatabaseOptions } from "../../src/platform/persistence/library-database";

export type TestLibrary = LibraryStores & { close(): void };

/** `newId`: the part presets' ID source (deterministic tests). */
export function openTestLibrary(path = ":memory:", options: Partial<Omit<LibraryDatabaseOptions, "migrations">> = {},
  newId?: () => string): TestLibrary {
  const database = openLibraryDatabase(path, options);
  const stores = libraryStores(database, STUDIO_PARTS, options.clock ? () => options.clock!.now() : undefined);
  return { ...stores, ...(newId ? { partPresets: new PartPresetLibrary(database, STUDIO_PARTS, newId) } : {}), close: () => database.close() };
}
