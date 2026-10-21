/**
 * S3 migration crash harness: an alpha.2-shaped library and today's workspace shape (one V, a collection with looks, saved
 * layouts), migrated by two hosts at once (identical and divergent drafts) with a kill at every protocol step, then a
 * downgrade and re-upgrade round trip. Prints one JSON summary; exits 1 when a gate fails.
 *   bun tools/s3-kill.ts <scratch-dir>
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_PARTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { alpha2Open, alpha2Writes } from "../../../projects/xf-studio/authoring/tests/fixtures/alpha-0.1.0-alpha.2/library-ddl";
import { COLLECTION_FIXTURES, readFixture } from "../../../projects/xf-studio/authoring/tests/fixtures/capture-plan-golden";
import { initialRecipe } from "../../../projects/xf-studio/authoring/tests/fixtures/eye-region";
import { SpikeHost } from "../prototype/host";
import { MIGRATION_POINTS, type MigrationSnapshot } from "../prototype/migration";
import { integrity, spawn, startHost, terminate, type Child } from "./kit";

const [scratch] = process.argv.slice(2);
if (!scratch) throw Error("Usage: bun tools/s3-kill.ts <scratch-dir>");
const RELEASED = ["looks", "look_revisions", "collections", "collection_revisions", "collection_preset_versions", "part_presets", "part_preset_sets"];
const NOW = "2026-09-27T10:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const canonical = (value: unknown): string => JSON.stringify(value, (_k, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item);

// --- Fixtures ------------------------------------------------------------------------------------------------------------
const fixtureCollection = STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0]));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A library as 0.1.0-alpha.2 wrote it (looks, part presets, a set, a collection at revision 1), then opened by this build. */
function makeLibrary(path: string) {
  const db = alpha2Open(path);
  try {
    alpha2Writes(db, uuid, JSON.stringify(initialRecipe()), NOW);
    const stored = STUDIO_PARTS.writeMinimal(fixtureCollection);
    db.query("INSERT INTO collections VALUES (?, ?)").run(stored.id, NOW);
    db.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(stored.id, JSON.stringify(stored), NOW);
    for (const preset of stored.presets) db.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)").run(stored.id, preset.id, preset.revision, JSON.stringify(preset));
  } finally { db.close(); }
  openLibraryDatabase(path).close();
}

/** Today's workspace, normalized: the draft of that collection with a look added, one V, two saved layouts. */
function snapshot(divergent: boolean): MigrationSnapshot {
  const looks = fixtureCollection.presets.map(preset => ({ id: preset.id, name: preset.name, parts: plain(preset.parts) }));
  looks.push({ id: uuid(77), name: "New since saving", parts: plain(fixtureCollection.presets[0].parts) });
  if (divergent) (looks[0] as { name: string }).name = `${looks[0].name} (edited in the other browser)`;
  return {
    collection: { id: fixtureCollection.id, name: fixtureCollection.name, looks, selected: looks[0].id },
    current: { id: fixtureCollection.id, revision: 1 },
    character: { source: { kind: "listed", folder: "ManualSave-12" }, decoded: { hash: "a".repeat(64), value: { isMale: false, options: { hair: "hh_007" } } },
      body: "feminine", voice: "feminine", choices: { eyes: "eyes_04", hair: "hh_007" }, clothing: { hidden: true } },
    layouts: [{ name: "Editing", dock: { left: ["presets"], center: ["view"] } }, { name: "Preview", dock: { center: ["view"] } }],
  };
}
const writeWorkspace = (path: string, snap: MigrationSnapshot) => writeFileSync(path, JSON.stringify({ legacy: { snapshot: snap } }));
const readWorkspace = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function released(path: string): string {
  const db = new Database(path);
  try {
    return sha(RELEASED.map(table => {
      const ddl = (db.query("SELECT sql FROM sqlite_master WHERE name = ?").get(table) as { sql: string }).sql;
      return ddl + JSON.stringify(db.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    }).join("\n"));
  } finally { db.close(); }
}
function documents(path: string): { kind: string; id: string; revision: number; value: any }[] {
  const db = new Database(path);
  try { return (db.query("SELECT kind, id, revision, value FROM documents ORDER BY kind, id").all() as { kind: string; id: string; revision: number; value: string }[])
    .map(row => ({ ...row, value: JSON.parse(row.value) })); } finally { db.close(); }
}
const documentsHash = (path: string) => sha(JSON.stringify(documents(path)));

/** What the library holds, independent of generated IDs and of which host went first. */
function outcome(path: string, workspaces: string[]) {
  const docs = documents(path);
  const of = (kind: string) => docs.filter(doc => doc.kind === kind && !doc.value?.tombstone);
  const looks = new Map(of("look-working").map(doc => [doc.id, doc.value]));
  const collections = of("collection-working").map(doc => ({ kind: doc.value.origin ? (/older version/.test(doc.value.name) ? "fork-named" : "fork") : "working",
    content: sha(canonical((doc.value.order as string[]).map(look => ({ name: looks.get(`${doc.id}/${look}`)?.name, parts: looks.get(`${doc.id}/${look}`)?.parts })))) }))
    .sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  const profiles = of("profile").map(doc => ({ name: doc.value.name, subjects: doc.value.subjects.length, collections: doc.value.collections.length }));
  // References: each workspace's scene resolves to a live character and to a look holding that workspace's own selected look.
  const references = workspaces.map(file => {
    const workspace = readWorkspace(file);
    if (workspace.migration?.state !== "done") return "not done";
    const scene = (Object.values(workspace.profiles.sessions)[0] as any).views.scenes["s-1"];
    const selected = workspace.legacy.snapshot.collection.looks.find((look: { id: string }) => look.id === workspace.legacy.snapshot.collection.selected);
    const look = looks.get(`${scene.look.collection}/${scene.look.look}`);
    if (!docs.some(doc => doc.kind === "character" && doc.id === scene.subject.id)) return "dangling subject";
    if (!look) return "dangling look";
    return canonical({ name: look.name, parts: look.parts }) === canonical({ name: selected.name, parts: selected.parts }) ? "ok" : "wrong look";
  });
  // Which draft keeps the original ID depends on which host commits first; the shape and the contents must not.
  return { profiles, characters: of("character").length, savedV: of("saved-v").length,
    collections: { kinds: collections.map(c => c.kind).sort(), contents: collections.map(c => c.content).sort() }, looks: looks.size,
    defaults: of("layout-default").length, references };
}

// --- Runs ----------------------------------------------------------------------------------------------------------------
type Setup = { dir: string; library: string; workspaces: string[]; ports: string[] };
function setup(name: string, divergent: boolean): Setup {
  const dir = join(scratch, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const library = join(dir, "library.sqlite");
  makeLibrary(library);
  const workspaces = [join(dir, "workspace-a.json"), join(dir, "workspace-b.json")];
  writeWorkspace(workspaces[0], snapshot(false));
  writeWorkspace(workspaces[1], snapshot(divergent));
  return { dir, library, workspaces, ports: [join(dir, "port-a"), join(dir, "port-b")] };
}

/** Two hosts on one library, each with its workspace, migrating at once; `kill` applies to host A or migrator A; whatever dies is restarted. */
async function migrateBoth(s: Setup, kill?: string, only?: number[]): Promise<{ restarts: number }> {
  const sides = only ?? [0, 1];
  const hostKill = kill && kill.startsWith("m-") ? `${kill}:1` : undefined;
  const workerKill = kill && kill.startsWith("w-") ? kill : undefined;
  const hosts: Child[] = [];
  for (const i of sides) hosts[i] = await startHost(s.library, s.ports[i], i === sides[0] ? hostKill : undefined);
  let restarts = 0;
  const migrate = async (i: number) => {
    let first = true;
    for (let attempt = 0; attempt < 6; attempt++) {
      const worker = spawn("harness/migrator-proc.ts", [s.workspaces[i], s.ports[i]], first && i === sides[0] ? workerKill : undefined);
      first = false;
      // A killed host is restarted at once, without a kill, as the next start of the app would.
      const watch = (async () => {
        const code = await Promise.race([hosts[i].exited, worker.exited.then(() => null)]);
        if (code !== null && worker.proc.exitCode === null) { restarts++; hosts[i] = await startHost(s.library, s.ports[i]); }
      })();
      await worker.exited; await watch;
      if (worker.lines.some(line => line.startsWith("done"))) return;
      restarts++;
    }
    throw Error(`workspace ${i} never finished`);
  };
  await Promise.all(sides.map(migrate));
  for (const i of sides) await terminate(hosts[i]);
  return { restarts };
}

const results: Record<string, unknown> = {};
let failed = false;
const gate = (name: string, ok: boolean, detail: unknown) => { results[name] = { ok, ...detail as object }; failed ||= !ok; };

for (const divergent of [false, true]) {
  const label = divergent ? "divergent" : "identical";
  // The expected outcome: two hosts migrating at once, nothing killed.
  const base = setup(`${label}-baseline`, divergent);
  const releasedBefore = released(base.library);
  await migrateBoth(base);
  const expected = outcome(base.library, base.workspaces);
  const wantCollections = divergent ? ["fork", "working"] : ["working"];
  const shapeOk = expected.profiles.length === 1 && expected.profiles[0].name === "My profile" && expected.profiles[0].subjects === 1
    && expected.profiles[0].collections === wantCollections.length && expected.characters === 1 && expected.savedV === 1 && expected.defaults === 2
    && canonical(expected.collections.kinds) === canonical(wantCollections) && expected.references.every(r => r === "ok");
  // Idempotent: a finished workspace does nothing; a workspace that lost its session after the commit replays the record.
  const docsBefore = documentsHash(base.library);
  await migrateBoth(base);
  const workspace = readWorkspace(base.workspaces[1]);
  writeFileSync(base.workspaces[1], JSON.stringify({ ...workspace, profiles: undefined, migration: { ...workspace.migration, state: "started" } }));
  await migrateBoth(base, undefined, [1]);
  const idempotent = documentsHash(base.library) === docsBefore && canonical(readWorkspace(base.workspaces[1]).profiles) === canonical(workspace.profiles);
  gate(`${label}: two hosts, no kill`, shapeOk && idempotent && released(base.library) === releasedBefore && integrity(base.library) === "ok",
    { expected, idempotent, releasedUnchanged: released(base.library) === releasedBefore });

  // A kill at every protocol step, on host A or workspace A, while host B migrates too.
  const kills: Record<string, unknown> = {};
  let allOk = true;
  for (const point of [...MIGRATION_POINTS, "m-after-commit", "w-token", "w-sent", "w-response", "w-done"]) {
    const s = setup(`${label}-${point}`, divergent);
    const before = released(s.library);
    const { restarts } = await migrateBoth(s, point);
    const got = outcome(s.library, s.workspaces);
    const docs = documentsHash(s.library);
    await migrateBoth(s); // Re-run: nothing changes.
    const ok = canonical(got) === canonical(expected) && released(s.library) === before && integrity(s.library) === "ok" && documentsHash(s.library) === docs && restarts > 0;
    allOk &&= ok;
    kills[point] = ok ? `ok (${restarts} restart${restarts === 1 ? "" : "s"})` : { got, restarts, released: released(s.library) === before };
  }
  gate(`${label}: kill at every step`, allOk, { kills });
}

// --- Downgrade and re-upgrade ------------------------------------------------------------------------------------------------
{
  const s = setup("downgrade", false);
  const one = { ...s, workspaces: [s.workspaces[0]], ports: [s.ports[0]] };
  await migrateBoth(s, undefined, [0]);
  const first = outcome(s.library, one.workspaces);
  // The newer build edits the working copy (autosave through an owner command).
  const database = openLibraryDatabase(s.library);
  const host = new SpikeHost(database);
  const lookId = `${fixtureCollection.id}/${fixtureCollection.presets[0].id}`;
  const working = host.get({ kind: "look-working", id: lookId })!;
  const edited = host.transact({ id: "edit-1", command: "look.edit", writes: [{ kind: "look-working", id: lookId, base: working.revision,
    value: { ...(working.value as object), name: "Edited after the upgrade" } }] });
  database.close();
  // The older build (0.1.0-alpha.2's own opening sequence) saves a named version of its frozen draft with an edit, then edits
  // the draft further; saving its workspace drops `profiles` and `migration`, which it doesn't know.
  const legacy = readWorkspace(s.workspaces[0]).legacy.snapshot as MigrationSnapshot;
  const named = structuredClone(fixtureCollection);
  named.presets[1].name = "Renamed in the older build";
  const alpha = alpha2Open(s.library);
  try {
    const stored = STUDIO_PARTS.writeMinimal(named);
    alpha.query("INSERT INTO collection_revisions VALUES (?, 2, ?, ?)").run(stored.id, JSON.stringify(stored), NOW);
    alpha.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)").run(stored.id, stored.presets[1].id, stored.presets[1].revision + 1, JSON.stringify(stored.presets[1]));
  } finally { alpha.close(); }
  const draft = structuredClone(legacy);
  draft.collection.looks = named.presets.map(preset => ({ id: preset.id, name: preset.name, parts: plain(preset.parts) }));
  draft.collection.looks.push({ ...legacy.collection.looks[2], name: "Added in the older build" });
  draft.current = { id: fixtureCollection.id, revision: 2 };
  writeWorkspace(s.workspaces[0], draft);
  const releasedBefore = released(s.library);
  const docsBefore = documents(s.library).filter(doc => doc.kind !== "xfs-receipt");
  await migrateBoth(s, undefined, [0]);
  const second = outcome(s.library, one.workspaces);
  // Rows the newer build wrote are unchanged (only additions).
  const after = documents(s.library);
  const unchanged = docsBefore.every(doc => after.some(other => other.kind === doc.kind && other.id === doc.id && other.revision === doc.revision && canonical(other.value) === canonical(doc.value))
    || (doc.kind === "profile")); // The profile gains the fork as a member.
  // A second round trip with nothing edited in the older build adds nothing but its record.
  writeWorkspace(s.workspaces[0], draft);
  const countBefore = documents(s.library).length;
  await migrateBoth(s, undefined, [0]);
  const third = outcome(s.library, one.workspaces);
  const addedThird = documents(s.library).length - countBefore;
  const kinds = second.collections.kinds;
  const ok = edited.ok && unchanged && released(s.library) === releasedBefore && integrity(s.library) === "ok"
    && canonical(kinds) === canonical(["fork", "fork-named", "working"]) && second.profiles.length === 1 && second.profiles[0].collections === 3 && second.characters === 1 && second.defaults === 2
    && second.references.every(r => r === "ok") && canonical(third.collections) === canonical(second.collections) && addedThird === 1;
  gate("downgrade and re-upgrade", ok, { first: first.collections.kinds.length, second: { collections: kinds, profiles: second.profiles, characters: second.characters,
    defaults: second.defaults, references: second.references }, newerRowsUnchanged: unchanged, releasedUnchangedByMigration: released(s.library) === releasedBefore,
    secondRoundTripAdded: addedThird });
}

console.log(JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
