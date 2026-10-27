import { expect, test } from "bun:test";
import { watchProfilesMigration } from "../src/app/browser/profiles-migration-device";
import { storedProfilesReady } from "../src/app/profiles/profiles-migration";
import { sessionOfWorkspace, workspaceProfiles } from "../src/app/profiles/profiles-migration-data";
import { PROFILES_MIGRATION } from "../src/app/profiles/profile-session";
import { serializeWorkspace, workspaceKeys } from "../src/app/workspace/makeup-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";
import { seededRandom } from "./fixtures/profile-sessions";

function migratedText() {
  const state = freshWorkspace();
  state.migration = { id: PROFILES_MIGRATION, token: "12345678-1234-4234-8234-123456789abc", state: "done" };
  state.profiles = workspaceProfiles("p-migrated", sessionOfWorkspace(state, { tab: "Eye makeup", character: "c-migrated" }, seededRandom(42)));
  return JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS));
}
function pageEvents() {
  const listeners = new Set<(event: StorageEvent) => void>();
  return {
    page: { addEventListener(_type: string, listener: (event: StorageEvent) => void) { listeners.add(listener); },
      removeEventListener(_type: string, listener: (event: StorageEvent) => void) { listeners.delete(listener); } } as Pick<Window, "addEventListener" | "removeEventListener">,
    changed(key: string | null) { for (const listener of listeners) listener({ key } as StorageEvent); },
    count: () => listeners.size,
  };
}

test("browser migration watch ignores incomplete/unreadable sessions and other keys, then reloads once without writing", () => {
  let raw: string | null = null, reloads = 0, readOnly = true;
  const events = pageEvents(), life = new AbortController(), key = workspaceKeys(true).workspace;
  const storage = { getItem: () => raw }; // No write method is available to the watcher.
  watchProfilesMigration({ storage, key, model: STUDIO_DOCUMENTS, readOnly: () => readOnly, reload: () => reloads++, signal: life.signal, page: events.page });
  raw = "{"; events.changed(key);
  const invalid = JSON.parse(migratedText()); invalid.profiles.sessions["p-migrated"].views.cameras = [];
  raw = JSON.stringify(invalid); events.changed(key);
  expect(storedProfilesReady(raw, STUDIO_DOCUMENTS)).toBe(false);
  invalid.profiles.sessions["p-migrated"] = { schema: "broken" };
  raw = JSON.stringify(invalid); events.changed(key);
  expect(reloads).toBe(0);
  raw = migratedText(); events.changed(workspaceKeys(false).workspace);
  expect(reloads).toBe(0);
  events.changed(key); events.changed(key);
  expect(reloads).toBe(1); expect(events.count()).toBe(0);
  life.abort(); readOnly = false;
});

test("browser watch checks a migration completed during startup, but never reloads a writable or ended page", () => {
  const raw = migratedText(); expect(storedProfilesReady(raw, STUDIO_DOCUMENTS)).toBe(true);
  const events = pageEvents(), life = new AbortController(); let reloads = 0;
  watchProfilesMigration({ storage: { getItem: () => raw }, key: workspaceKeys(true).workspace, model: STUDIO_DOCUMENTS,
    readOnly: () => true, reload: () => reloads++, signal: life.signal, page: events.page });
  expect(reloads).toBe(1);
  watchProfilesMigration({ storage: { getItem: () => raw }, key: workspaceKeys(true).workspace, model: STUDIO_DOCUMENTS,
    readOnly: () => false, reload: () => reloads++, signal: life.signal, page: events.page });
  expect(events.count()).toBe(0); expect(reloads).toBe(1);
  life.abort();
  watchProfilesMigration({ storage: { getItem: () => raw }, key: workspaceKeys(true).workspace, model: STUDIO_DOCUMENTS,
    readOnly: () => true, reload: () => reloads++, signal: life.signal, page: events.page });
  expect(reloads).toBe(1);
});

test("desktop migration watch reads fresh host text while pending and aborts when a validated session can reload", async () => {
  const life = new AbortController(), scheduled: (() => void)[] = [];
  let raw: string | null = null, reloads = 0, reads = 0;
  watchProfilesMigration({ storage: { getItem: () => { throw Error("Stale desktop mirror must not be read"); } }, key: workspaceKeys(true).workspace,
    model: STUDIO_DOCUMENTS, readOnly: () => true, reload: () => reloads++, signal: life.signal,
    readStored: async () => { reads++; return raw; }, clock: { after: (_ms, run, signal) => { if (!signal?.aborted) scheduled.push(run); } } });
  await Bun.sleep(0); expect(reads).toBe(1); expect(reloads).toBe(0);
  raw = "{broken"; scheduled.shift()!(); await Bun.sleep(0); expect(reloads).toBe(0);
  raw = migratedText(); scheduled.shift()!(); await Bun.sleep(0);
  expect(reloads).toBe(1); expect(reads).toBe(3); expect(scheduled).toHaveLength(0);
  life.abort();
});
