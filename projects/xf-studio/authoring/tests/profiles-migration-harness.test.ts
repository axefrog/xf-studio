/**
 * The S3 migration crash harness on the production code (profiles design §8; spike S3, experiment 038), in one process: an alpha.2
 * library and two workspaces like real ones, migrated by two hosts on one library at once (identical and divergent drafts), with a kill
 * at every protocol step; then the alpha.2 downgrade and re-upgrade round trip. Gates: exactly the expected profiles, no duplicated
 * subject, divergent content forked with references remapped, released tables byte-identical, re-runs idempotent. The deeper sweep, with
 * processes really killed, is experiment 038's `tools/s3-migration.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_POINTS } from "../src/app/profiles/host/profiles-migrate";
import { WORKSPACE_POINTS } from "../src/app/profiles/profiles-migration";
import { canonicalJson } from "../src/platform/api";
import { alpha2Library, alpha2SaveNamed, COLLECTION, documentRows, documentsHash, integrity, realWorkspace, releasedHash } from "./fixtures/profiles-migration-fixtures";
import { HarnessHost, HarnessWorkspace, migrateUntilDone, outcome } from "./fixtures/profiles-migration-harness";
import { tempDir } from "./temp-dir";

const scratch = tempDir("xfs-s3-");
afterAll(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* A file a failed test left open; the system cleans its temp folder. */ } });
let runs = 0;
function setup(divergent: boolean) {
  const dir = join(scratch, `run-${++runs}`);
  mkdirSync(dir, { recursive: true });
  const library = join(dir, "library.sqlite");
  alpha2Library(library);
  const hosts = [new HarnessHost(library), new HarnessHost(library)];
  const workspaces = [new HarnessWorkspace(realWorkspace(), "browser-a"), new HarnessWorkspace(realWorkspace({ divergent }), "browser-b")];
  return { library, hosts, workspaces, close: () => hosts.forEach(host => host.close()) };
}
/** Both workspaces migrate at once, each through its own host; `kill` applies to host A or workspace A. */
async function both(s: ReturnType<typeof setup>, kill?: string) {
  const restarts = await Promise.all(s.workspaces.map((workspace, i) => migrateUntilDone(workspace, s.hosts[i]!, i === 0 ? kill as never : undefined)));
  return restarts[0]! + restarts[1]!;
}

for (const divergent of [false, true]) describe(divergent ? "divergent drafts" : "identical drafts", () => {
  let expected: ReturnType<typeof outcome>;

  test("two hosts at once: the expected profile, one V, the draft forked only when it differs, each scene on its own look; re-runs change nothing", async () => {
    const s = setup(divergent);
    const released = releasedHash(s.library);
    await both(s);
    expected = outcome(s.library, s.workspaces);
    expect(expected.profiles).toEqual([{ name: "My profile", subjects: 1, collections: divergent ? 2 : 1 }]);
    expect(expected.characters).toBe(1);
    expect(expected.savedV).toBe(1);
    expect(expected.defaults).toBe(2);
    // The draft, the earlier draft of the same collection (forked), and the other recovery drafts' collections.
    expect(expected.collections.kinds).toEqual(divergent ? ["fork", "fork-earlier", "fork-earlier", "working", "working", "working"] : ["fork-earlier", "working", "working", "working"]);
    expect(expected.references).toEqual(["ok", "ok"]);
    expect(expected.records).toBe(2);
    // Idempotent: a finished workspace does nothing; a workspace that lost its session after the commit gets the stored result back.
    const docs = documentsHash(s.library);
    expect(await both(s)).toBe(0);
    const session = s.workspaces[1]!.state().profiles;
    s.workspaces[1]!.edit(state => { delete state.profiles; state.migration = { ...state.migration!, state: "started" }; });
    await migrateUntilDone(s.workspaces[1]!, s.hosts[1]!);
    expect(documentsHash(s.library)).toBe(docs);
    const rebuilt = s.workspaces[1]!.state().profiles!;
    // The rebuilt session is the same apart from its fresh tab and instance IDs.
    const shape = (value: unknown) => canonicalJson(value).replace(/"(t|[a-z.-]+)--?[0-9a-z]{8}"/g, "\"id\"");
    expect(shape(rebuilt)).toBe(shape(session));
    expect(releasedHash(s.library)).toBe(released);
    expect(integrity(s.library)).toBe("ok");
    s.close();
  });

  for (const point of [...MIGRATION_POINTS, "m-after-commit", ...WORKSPACE_POINTS]) test(`killed at ${point}: recovers to the same outcome, and a re-run changes nothing`, async () => {
    const s = setup(divergent);
    const released = releasedHash(s.library);
    const restarts = await both(s, point);
    expect(restarts).toBeGreaterThan(0);
    const got = outcome(s.library, s.workspaces);
    expect(got).toEqual(expected);
    const docs = documentsHash(s.library);
    await both(s);
    expect(documentsHash(s.library)).toBe(docs);
    expect(releasedHash(s.library)).toBe(released);
    expect(integrity(s.library)).toBe("ok");
    s.close();
  });
});

test("downgrade and re-upgrade: the edited working copy kept, the older build's named version and draft back as forks, one profile, one V", async () => {
  const s = setup(false);
  const [host] = s.hosts, [workspace] = s.workspaces;
  await migrateUntilDone(workspace!, host!);
  const first = outcome(s.library, [workspace!]);
  expect(first.collections.kinds).toEqual(["fork-earlier", "working", "working", "working"]);
  // The newer build edits the working copy (an owner command).
  const id = documentRows(s.library).find(doc => doc.kind === "collection-working" && doc.id === COLLECTION)!.value.looks[0];
  const look = host!.documents.get<Record<string, unknown>>("look-working", `${COLLECTION}/${id}`)!;
  expect(host!.documents.transact({ id: "edit-1", command: "look.update", writes: [{ kind: "look-working", id: `${COLLECTION}/${id}`, base: look.revision,
    value: { ...look.value, name: "Edited after the upgrade" } }] }).ok).toBe(true);
  // The older build: saves a named version (one look renamed) through its own statements, edits its draft, and drops what it doesn't know.
  host!.close();
  alpha2SaveNamed(s.library, 2, "Renamed in the older build");
  workspace!.edit(state => {
    delete state.migration; delete state.profiles;
    state.collections!.collection.presets[1] = { ...state.collections!.collection.presets[1]!, name: "Renamed in the older build" };
    state.collections!.collection.presets.push({ ...structuredClone(state.collections!.collection.presets[2]!), id: "00000000-0000-4000-8000-0000000000aa", name: "Added in the older build" });
    state.collections!.revision = 2; state.library.current = { id: COLLECTION, revision: 2 };
  });
  host!.restart();
  const released = releasedHash(s.library);
  const before = documentRows(s.library).filter(doc => doc.kind !== "xfs-receipt");
  await migrateUntilDone(workspace!, host!);
  const second = outcome(s.library, [workspace!]);
  expect(second.collections.kinds).toEqual(["fork", "fork-earlier", "fork-named", "working", "working", "working"]);
  expect(second.profiles).toEqual([{ name: "My profile", subjects: 1, collections: 3 }]);
  expect([second.characters, second.savedV, second.defaults]).toEqual([1, 1, 2]);
  expect(second.references).toEqual(["ok"]);
  // Rows the newer build wrote are unchanged (only the profile gains the forks).
  const after = documentRows(s.library);
  for (const doc of before.filter(doc => doc.kind !== "profile"))
    expect(after.find(other => other.kind === doc.kind && other.id === doc.id)).toEqual(doc);
  expect(after.find(doc => doc.kind === "look-working" && doc.id === `${COLLECTION}/${id}`)!.value.name).toBe("Edited after the upgrade");
  expect(releasedHash(s.library)).toBe(released);
  // A second round trip with nothing edited in the older build adds only its record.
  workspace!.edit(state => { delete state.migration; delete state.profiles; });
  const count = documentRows(s.library).length;
  await migrateUntilDone(workspace!, host!);
  expect(documentRows(s.library).length - count).toBe(1);
  expect(outcome(s.library, [workspace!]).collections).toEqual(second.collections);
  expect(integrity(s.library)).toBe("ok");
  s.close();
});
