/**
 * The S3 migration sweep on the production code (profiles design §8, chunk 1d-i), with processes really killed: an alpha.2 library and
 * two workspaces like real ones, migrated by two host processes on one library at once (identical and divergent drafts), with each host or
 * page killed (`SIGKILL`) at every protocol step, `rounds` times each; then the downgrade and re-upgrade round trip. The same gates as
 * the CI harness (`projects/xf-studio/authoring/tests/profiles-migration-harness.test.ts`), which runs these parts in one process.
 * Prints one JSON summary; exits 1 when a gate fails.
 *   bun tools/s3-migration.ts <scratch-dir> [rounds=1]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_POINTS } from "../../../projects/xf-studio/authoring/src/app/profiles/host/profiles-migrate";
import { WORKSPACE_POINTS } from "../../../projects/xf-studio/authoring/src/app/profiles/profiles-migration";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { DocumentStore } from "../../../projects/xf-studio/authoring/src/platform/persistence/document-store";
import { LibraryBackups } from "../../../projects/xf-studio/authoring/src/platform/persistence/backups";
import { canonicalJson } from "../../../projects/xf-studio/authoring/src/platform/api";
import { alpha2Library, alpha2SaveNamed, COLLECTION, documentRows, documentsHash, integrity, readStored, realWorkspace, releasedHash, storedText }
  from "../../../projects/xf-studio/authoring/tests/fixtures/profiles-migration-fixtures";
import { HarnessWorkspace, outcome } from "../../../projects/xf-studio/authoring/tests/fixtures/profiles-migration-harness";
import { spawn, terminate, type Child } from "./kit";

const [scratch, roundsArg] = process.argv.slice(2);
if (!scratch) throw Error("Usage: bun tools/s3-migration.ts <scratch-dir> [rounds=1]");
const rounds = Number(roundsArg ?? 1);

type Setup = { dir: string; library: string; files: string[]; ports: string[]; ids: string[] };
let runs = 0;
function setup(divergent: boolean): Setup {
  const dir = join(scratch, `run-${++runs}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const library = join(dir, "library.sqlite");
  alpha2Library(library, new LibraryBackups(library, Date.now));
  const files = [join(dir, "workspace-a.json"), join(dir, "workspace-b.json")];
  writeFileSync(files[0]!, storedText(realWorkspace()));
  writeFileSync(files[1]!, storedText(realWorkspace({ divergent })));
  return { dir, library, files, ports: [join(dir, "port-a"), join(dir, "port-b")], ids: ["browser-a", "browser-b"] };
}
async function startHost(library: string, portFile: string, kill?: string): Promise<Child> {
  const host = spawn("harness/s3-migration-host.ts", [library], kill);
  const line = await host.wait(text => text.startsWith("port "));
  if (!line) throw Error("The host didn't start.");
  writeFileSync(portFile, line.slice(5));
  return host;
}
const workspaces = (s: Setup, only = [0, 1]) => only.map(i => { const w = new HarnessWorkspace(realWorkspace(), s.ids[i]!); w.text = readFileSync(s.files[i]!, "utf8"); return w; });

/** Each workspace migrates through its own host process, both at once; `kill` applies to host A or page A; whatever dies starts again. */
async function migrate(s: Setup, kill?: string, only = [0, 1]): Promise<number> {
  const hosts: Child[] = [];
  for (const i of only) hosts[i] = await startHost(s.library, s.ports[i]!, i === only[0] && kill?.startsWith("m-") ? kill : undefined);
  let restarts = 0;
  const run = async (i: number) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const page = spawn("harness/s3-migration-page.ts", [s.files[i]!, s.ports[i]!, s.ids[i]!], attempt === 0 && i === only[0] && kill?.startsWith("w-") ? kill : undefined);
      // A killed host starts again at once, as the next start of the app would; the page keeps retrying meanwhile.
      const watch = (async () => {
        const code = await Promise.race([hosts[i]!.exited, page.exited.then(() => null)]);
        if (code !== null) { restarts++; hosts[i] = await startHost(s.library, s.ports[i]!); }
      })();
      await page.exited; await watch;
      if (page.lines.some(line => line === "outcome done" || line === "outcome already")) return;
      restarts++;
    }
    throw Error(`workspace ${i} never finished`);
  };
  await Promise.all(only.map(run));
  for (const i of only) await terminate(hosts[i]!);
  return restarts;
}

const results: Record<string, unknown> = {};
let failed = false;
const gate = (name: string, ok: boolean, detail: object) => { results[name] = { ok, ...detail }; failed ||= !ok; };
const started = performance.now();

for (const divergent of [false, true]) {
  const label = divergent ? "divergent" : "identical";
  const base = setup(divergent);
  const released = releasedHash(base.library);
  await migrate(base);
  const expected = outcome(base.library, workspaces(base));
  const kinds = divergent ? ["fork", "fork-earlier", "fork-earlier", "working", "working", "working"] : ["fork-earlier", "working", "working", "working"];
  const shape = canonicalJson(expected.profiles) === canonicalJson([{ name: "My profile", subjects: 1, collections: divergent ? 2 : 1 }]) &&
    expected.characters === 1 && expected.savedV === 1 && expected.defaults === 2 && canonicalJson(expected.collections.kinds) === canonicalJson(kinds) &&
    expected.references.every(r => r === "ok");
  const docs = documentsHash(base.library);
  const again = await migrate(base);
  // A workspace that lost its session after the commit gets the stored result back.
  const lost = readStored(readFileSync(base.files[1]!, "utf8"));
  delete lost.profiles; lost.migration = { ...lost.migration!, state: "started" };
  writeFileSync(base.files[1]!, storedText(lost));
  await migrate(base, undefined, [1]);
  const idempotent = again === 0 && documentsHash(base.library) === docs && outcome(base.library, workspaces(base)).references.every(r => r === "ok");
  const copies = new LibraryBackups(base.library, Date.now).list().filter(copy => copy.kind === "pre-migration").length;
  gate(`${label}: two hosts, no kill`, shape && idempotent && copies === 1 && releasedHash(base.library) === released && integrity(base.library) === "ok",
    { expected: { ...expected, collections: expected.collections.kinds }, idempotent, preMigrationCopies: copies });

  const kills: Record<string, string> = {};
  let ok = true;
  for (let round = 0; round < rounds; round++) for (const point of [...MIGRATION_POINTS, "m-after-commit", ...WORKSPACE_POINTS]) {
    const s = setup(divergent);
    const before = releasedHash(s.library);
    const restarts = await migrate(s, point);
    const got = outcome(s.library, workspaces(s));
    const after = documentsHash(s.library);
    await migrate(s);
    const good = canonicalJson(got) === canonicalJson(expected) && restarts > 0 && documentsHash(s.library) === after && releasedHash(s.library) === before &&
      integrity(s.library) === "ok";
    ok &&= good;
    kills[`${point}#${round + 1}`] = good ? `ok (${restarts} restart${restarts === 1 ? "" : "s"})` : JSON.stringify({ got, restarts });
    rmSync(s.dir, { recursive: true, force: true });
  }
  gate(`${label}: killed at every step`, ok, { kills });
}

// Downgrade and re-upgrade, with the older build's own statements.
{
  const s = setup(false);
  await migrate(s, undefined, [0]);
  const database = openLibraryDatabase(s.library);
  const store = new DocumentStore(database);
  const id = documentRows(s.library).find(doc => doc.kind === "collection-working" && doc.id === COLLECTION)!.value.looks[0];
  const look = store.get<Record<string, unknown>>("look-working", `${COLLECTION}/${id}`)!;
  const edited = store.transact({ id: "edit-1", command: "look.update", writes: [{ kind: "look-working", id: `${COLLECTION}/${id}`, base: look.revision,
    value: { ...look.value, name: "Edited after the upgrade" } }] }).ok;
  database.close();
  alpha2SaveNamed(s.library, 2, "Renamed in the older build");
  const older = readStored(readFileSync(s.files[0]!, "utf8"));
  delete older.migration; delete older.profiles;
  const presets = older.collections!.collection.presets;
  presets[1] = { ...presets[1]!, name: "Renamed in the older build" };
  presets.push({ ...structuredClone(presets[2]!), id: "00000000-0000-4000-8000-0000000000aa", name: "Added in the older build" });
  older.collections!.revision = 2; older.library.current = { id: COLLECTION, revision: 2 };
  writeFileSync(s.files[0]!, storedText(older));
  const released = releasedHash(s.library);
  const before = documentRows(s.library).filter(doc => doc.kind !== "xfs-receipt" && doc.kind !== "profile");
  await migrate(s, undefined, [0]);
  const second = outcome(s.library, workspaces(s, [0]));
  const after = documentRows(s.library);
  const unchanged = before.every(doc => canonicalJson(after.find(other => other.kind === doc.kind && other.id === doc.id)) === canonicalJson(doc));
  const again = readStored(readFileSync(s.files[0]!, "utf8"));
  delete again.migration; delete again.profiles;
  writeFileSync(s.files[0]!, storedText(again));
  const count = after.length;
  await migrate(s, undefined, [0]);
  const added = documentRows(s.library).length - count;
  const ok = edited && unchanged && added === 1 && releasedHash(s.library) === released && integrity(s.library) === "ok" &&
    canonicalJson(second.collections.kinds) === canonicalJson(["fork", "fork-earlier", "fork-named", "working", "working", "working"]) &&
    canonicalJson(second.profiles) === canonicalJson([{ name: "My profile", subjects: 1, collections: 3 }]) && second.characters === 1 && second.defaults === 2 &&
    second.references.every(r => r === "ok");
  gate("downgrade and re-upgrade", ok, { collections: second.collections.kinds, profiles: second.profiles, newerRowsUnchanged: unchanged, secondRoundTripAdded: added });
}

results.seconds = Math.round((performance.now() - started) / 100) / 10;
console.log(JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
