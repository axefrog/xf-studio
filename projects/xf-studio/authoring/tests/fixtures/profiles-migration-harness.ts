/**
 * The S3 migration harness's parts on the production code (profiles design §8): a host (the real library owner, document store and
 * migration transaction over a library file) and a workspace (its stored text, written synchronously, and the real `ProfilesMigration`).
 * The CI harness (`tests/profiles-migration-harness.test.ts`) runs them in one process, where a kill is the transaction rolling back
 * (inside it) or the answer or the page's next steps never happening (outside it); the deeper sweep (experiment 038,
 * `tools/s3-migration.ts`) runs the same parts in processes that are really killed.
 */
import { STUDIO_PARTS } from "../../src/compose/studio-registry";
import { openLibraryDatabase } from "../../src/library/host/library-files";
import { checkMigrationRequest, type MigrationPoint, migrateProfiles } from "../../src/app/profiles/host/profiles-migrate";
import { ProfilesMigration, type WorkspacePoint } from "../../src/app/profiles/profiles-migration";
import type { MigrationAnswer, MigrationRequest } from "../../src/app/profiles/profiles-migration-data";
import { DocumentStore } from "../../src/platform/persistence/document-store";
import type { LibraryBackups } from "../../src/platform/persistence/backups";
import type { LibraryDatabase } from "../../src/platform/persistence/library-database";
import type { WorkspaceState } from "../../src/app/workspace/makeup-workspace";
import { canonicalJson } from "../../src/platform/api";
import { documentRows, MODEL, readStored, storedText } from "./profiles-migration-fixtures";

/** What a kill throws: the process ends here. */
export class Killed extends Error { constructor(readonly at: string) { super(`killed at ${at}`); } }

/** One host process on a library file: its own connection, its own migration route. */
export class HarnessHost {
  private db: LibraryDatabase;
  private store: DocumentStore;
  /** A kill point armed for this host's next run, and how many runs it has answered. */
  kill: MigrationPoint | null = null;
  constructor(readonly path: string, private readonly backups: LibraryBackups | null = null) {
    this.db = openLibraryDatabase(path, { backups });
    this.store = new DocumentStore(this.db);
  }
  /** The route: the request crosses as JSON, as it does over HTTP. A kill inside the transaction rolls it back; after it, the answer is lost. */
  async send(request: MigrationRequest): Promise<MigrationAnswer> {
    const checked = checkMigrationRequest(JSON.parse(JSON.stringify(request)));
    const point = (at: MigrationPoint) => { if (at === this.kill) { this.kill = null; throw new Killed(at); } };
    let answer: MigrationAnswer;
    try { answer = migrateProfiles(this.db, this.store, checked, { parts: STUDIO_PARTS, backups: this.backups, point }); }
    catch (error) { if (error instanceof Killed) this.restart(); throw error; }
    try { point("m-after-commit"); } catch (error) { this.restart(); throw error; }
    return JSON.parse(JSON.stringify(answer));
  }
  /** The host starts again: a new connection (a killed process's open transaction is gone with it). */
  restart() { this.db.close(); this.db = openLibraryDatabase(this.path, { backups: this.backups }); this.store = new DocumentStore(this.db); }
  get documents(): DocumentStore { return this.store; }
  get database(): LibraryDatabase { return this.db; }
  close() { this.db.close(); }
}

let tokens = 0;
/** One workspace: its stored text (the browser's storage, or the desktop host file), written synchronously by `record`. */
export class HarnessWorkspace {
  text: string;
  constructor(state: WorkspaceState, readonly identity: string) { this.text = storedText(state); }
  state(): WorkspaceState { return readStored(this.text); }
  /** The workspace as stored, with `change` applied (an older build's edit, a lost session). */
  edit(change: (state: WorkspaceState) => void) { const state = this.state(); change(state); this.text = storedText(state); }
  /**
   * One page load's migration against `host`, with a kill armed at `kill` (the page ends there: nothing after it runs). Answers the
   * outcome, or "killed".
   */
  async run(host: HarnessHost, kill?: WorkspacePoint): Promise<string> {
    const life = new AbortController();
    let armed = kill;
    const migration = new ProfilesMigration({ workspace: this.identity, model: MODEL, state: () => this.state(),
      record: marks => { this.edit(state => { state.migration = marks.migration; if (marks.profiles) state.profiles = marks.profiles; else delete state.profiles; }); return true; },
      send: request => host.send(request), newToken: () => `00000000-0000-4000-8000-${(++tokens).toString(16).padStart(12, "0")}`,
      wait: async () => { throw new Killed("host down"); },
      point: at => { if (at === armed) { armed = undefined; life.abort(); throw new Killed(at); } } });
    try { return await migration.run(life.signal); }
    catch (error) { if (error instanceof Killed) return "killed"; throw error; }
  }
}

/** Runs one workspace until it is done, restarting the page (and the host) after every kill; answers how many restarts it took. */
export async function migrateUntilDone(workspace: HarnessWorkspace, host: HarnessHost, kill?: WorkspacePoint | MigrationPoint): Promise<number> {
  let restarts = 0;
  if (kill?.startsWith("m-")) host.kill = kill as MigrationPoint;
  for (let attempt = 0; attempt < 6; attempt++) {
    let outcome: string;
    try { outcome = await workspace.run(host, attempt === 0 && kill?.startsWith("w-") ? kill as WorkspacePoint : undefined); }
    catch (error) { if (!(error instanceof Killed)) throw error; outcome = "killed"; }
    if (outcome === "done" || outcome === "already") return restarts;
    restarts++;
  }
  throw Error("The workspace never finished migrating.");
}

/**
 * What the library holds, independent of generated IDs and of which host went first: profiles, characters, decoded saves, each collection's
 * kind (working copy, fork, fork of a named version) and content, look and default counts, and whether each workspace's scenes resolve
 * to a live V and to a look holding that workspace's own selected look.
 */
export function outcome(path: string, workspaces: HarnessWorkspace[]) {
  const docs = documentRows(path).filter(doc => !doc.value?.tombstone);
  const of = (kind: string) => docs.filter(doc => doc.kind === kind);
  const looks = new Map(of("look-working").map(doc => [doc.id, doc.value]));
  const content = (ids: string[], collection: string) => ids.map(id => { const look = looks.get(`${collection}/${id}`); return look && { name: look.name, parts: STUDIO_PARTS.canonicalParts(look.parts) }; });
  const collections = of("collection-working").map(doc => ({ kind: doc.value.origin ? (/older version/.test(doc.value.name) ? "fork-named" : /earlier draft/.test(doc.value.name) ? "fork-earlier" : "fork") : "working",
    content: canonicalJson(content(doc.value.looks, doc.id)) })).sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1);
  const profiles = of("profile").map(doc => ({ name: doc.value.name, subjects: doc.value.subjects.length, collections: doc.value.collections.length }));
  const references = workspaces.map(workspace => {
    const state = workspace.state();
    if (state.migration?.state !== "done" || !state.profiles) return "not done";
    const session = Object.values(state.profiles.sessions)[0]!;
    const scene = session.views.scenes[0]!;
    if (!scene.subject || !of("character").some(doc => doc.id === scene.subject!.id)) return "dangling subject";
    if (!scene.look) return "no look";
    const look = looks.get(`${scene.look.collection}/${scene.look.look}`);
    if (!look) return "dangling look";
    const selected = state.collections!.collection.presets.find(preset => preset.id === state.collections!.selected)!;
    return look.name === selected.name && STUDIO_PARTS.canonicalParts(look.parts) === STUDIO_PARTS.canonicalParts(STUDIO_PARTS.minimalLook(selected).parts) ? "ok" : "wrong look";
  });
  return { profiles, characters: of("character").length, savedV: of("saved-v").length,
    collections: { kinds: collections.map(c => c.kind).sort(), contents: collections.map(c => c.content).sort() }, looks: looks.size,
    defaults: of("layout-default").length, records: of("migration").length, references };
}
