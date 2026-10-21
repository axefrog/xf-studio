/**
 * Profiles phase 1d-ii's parity gate for single-V workflows (profiles design §9.2): the scripted session of the look-history parity gate
 * (edits, form-control and gesture transactions committed, cancelled and empty, Undo, Redo, jumps, preset switches across an add and a
 * remove, and a reload) runs twice on each workspace-1 fixture:
 *
 * - through the draft model the Studio had before the switch-over (`fixtures/legacy-draft.ts`, the code the goldens were captured from),
 *   on the workspace as stored;
 * - through the Studio on the profile services, on the same workspace after the profiles migration moved it into the library: the look the
 *   session's scene shows, its collection's commands for the preset steps, and a reload that is a second window on the library.
 *
 * What a person sees at every step (the look, its selection, Undo, Redo and the History timeline, and every refusal) must be the same.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { script, session, type SessionDriver } from "./fixtures/look-history-parity";
import { restore } from "./fixtures/workspace-observable";
import { damagedWorkspaceV1, largeWorkspaceV1, looseWorkspaceV1, smallWorkspaceV1, withPreferences } from "./fixtures/workspace-v1-fixtures";
import { HarnessHost, HarnessWorkspace, migrateUntilDone } from "./fixtures/profiles-migration-harness";
import { openTestLibrary } from "./fixtures/library-file";
import { profileStudio } from "./fixtures/profile-studio";

const fixtures = { small: smallWorkspaceV1, loose: looseWorkspaceV1, large: largeWorkspaceV1, damaged: damagedWorkspaceV1,
  preferences: () => withPreferences(smallWorkspaceV1()) };

/** The workspace migrated into a new library file: the file, and the look its session's scene shows. */
async function migrated(stored: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "xfs-profiles-parity-")), path = join(dir, "library.sqlite");
  const host = new HarnessHost(path), workspace = new HarnessWorkspace(restore(stored).state, "parity-workspace");
  await migrateUntilDone(workspace, host);
  host.close();
  const sessionData = Object.values(workspace.state().profiles!.sessions)[0]!;
  return { dir, path, look: sessionData.views.scenes.find(scene => scene.look)?.look };
}

/** The scripted session through the Studio on the profile services. */
async function profiles(stored: unknown, withPresets: boolean) {
  const { dir, path, look } = await migrated(stored);
  const library = openTestLibrary(path);
  try {
    // New items get the IDs the session before the switch-over gave them, so the two compare step by step.
    const ids = () => { let n = 0; return () => `step4-${++n}`; };
    const studio = await profileStudio({ library, show: look, newId: ids() });
    await studio.collection.initialize();
    const dispatch = (action: Parameters<typeof studio.app.dispatch>[0]) => { const done = studio.app.dispatch(action); if (!done.ok) throw Error(done.message); };
    const driver: SessionDriver = { core: studio.core, ...(withPresets ? { presets: {
      selected: () => studio.scene.look()!.look, add: () => dispatch({ kind: "preset.edit", command: { kind: "add" } }),
      select: id => dispatch({ kind: "preset.select", id }), remove: id => dispatch({ kind: "preset.edit", command: { kind: "remove", id } }),
      restore: () => dispatch({ kind: "preset.edit", command: { kind: "restore" } }) } } : {}),
      // Reload: everything reaches the library, and a second window opens on the look the scene shows.
      reload: async () => {
        expect(await studio.settle()).toBe(true);
        const again = await profileStudio({ library, show: studio.scene.look(), newId: ids() });
        return { writable: true, core: again.core };
      } };
    return await script(driver);
  } finally { library.close(); rmSync(dir, { recursive: true, force: true }); }
}

for (const [name, fixture] of Object.entries(fixtures)) test(`${name}: the scripted session shows the same at every step on the profile services as before`, async () => {
  const before = session(fixture()), withPresets = !!restore(fixture()).state.collections;
  const after = await profiles(fixture(), withPresets);
  expect(after.log.map(entry => entry.step)).toEqual(before.log.map(entry => entry.step));
  for (const [i, entry] of after.log.entries()) expect({ step: entry.step, ...entry }).toEqual({ step: entry.step, ...before.log[i]! });
  expect(after.reload).toEqual(before.reload);
}, 60_000);
