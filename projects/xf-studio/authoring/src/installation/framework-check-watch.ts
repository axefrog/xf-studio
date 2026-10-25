/** Keeps the framework check current with the settings it reads (application policy, wired by the composition root).
 *
 * The check is a cheap read of a few installed files and the mod manager's list, so it runs by itself: once the settings are known, and
 * again whenever the game folder, the route or the Mod Organizer 2 instance or profile changes. The result is ready by the time anyone opens
 * Settings or the Mod package panel. It reuses the detection service's `detect.frameworkVersions` (no scanner of its own); that service
 * refuses overlapping requests, so a change that arrives while detection is busy is picked up when detection reports it has finished.
 * A failed check isn't repeated by itself: Check again asks once more.
 */
export type FrameworkInputFields = { gameRoot?: string | null; launchRoute?: string; mo2Root?: string | null; mo2ProfileId?: string | null; [other: string]: unknown };
export type FrameworkWatchSetup = { snapshot(): { view?: { fields: FrameworkInputFields } }; subscribe(listener: () => void): () => void };
export type FrameworkWatchDetection = {
  capability(action: { kind: "detect.frameworkVersions" }): { available: boolean };
  dispatch(action: { kind: "detect.frameworkVersions" }): Promise<unknown>;
  subscribe(listener: () => void): () => void;
};

/** What the check reads: the settings it is a function of. */
export const frameworkInputKey = (fields: FrameworkInputFields) => JSON.stringify([fields.gameRoot ?? null, fields.launchRoute ?? null, fields.mo2Root ?? null, fields.mo2ProfileId ?? null]);

/** Starts watching; the returned function stops it. */
export function watchFrameworkInputs(setup: FrameworkWatchSetup, detection: FrameworkWatchDetection): () => void {
  const action = { kind: "detect.frameworkVersions" } as const;
  let requested: string | null = null;
  const run = () => {
    const fields = setup.snapshot().view?.fields;
    if (!fields) return;
    const key = frameworkInputKey(fields);
    if (key === requested) return;
    // No game folder: nothing to read yet. The key is remembered, so choosing a folder is a change.
    if (!fields.gameRoot) { requested = key; return; }
    if (!detection.capability(action).available) return;
    requested = key;
    void detection.dispatch(action);
  };
  const stops = [setup.subscribe(run), detection.subscribe(run)];
  run();
  return () => { for (const stop of stops) stop(); };
}
