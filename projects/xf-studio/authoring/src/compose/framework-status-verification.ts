import { FRAMEWORK_SAMPLE_STATES, frameworkCheckFor, type FrameworkSampleState } from "../installation/framework-fixtures";
import type { InstallDetectionActions, InstallDetectionTransport } from "../installation/install-detection-actions";
import type { LocalSetupActions } from "../setup/local-setup-actions";

type Shown = Exclude<FrameworkSampleState, "no-game" | "checking">;

/**
 * Isolated visual specimens for Settings › Game › Mod frameworks (`?verify=1` only, tools/framework-status-look.ts): the framework
 * check the page asks the host for is answered here instead, with the sample checks of `framework-fixtures.ts`, and nothing on the
 * computer is read. The verification workspace has its own settings, so the one state that needs a setting ("no-game": no game
 * folder chosen) clears it there and puts it back for the next state.
 *
 * `xfStudioFrameworkStatus.state(name)` shows a state: "all-ok", "too-old" (ArchiveXL 1.26.3), "missing" (redscript), "hidden-duplicate"
 * (a second, unused ArchiveXL in the Mod Organizer 2 list), "checking" (a check that stays open until `release()`) and "no-game".
 * Open Settings › Game first, and choose a game folder in the verification workspace if it has none.
 */
export function frameworkStatusVerification(deps: { setup: Pick<LocalSetupActions, "snapshot" | "dispatch">; detection: () => Pick<InstallDetectionActions, "snapshot" | "dispatch"> }) {
  let state: Shown | "checking" | "no-game" | "live" = "live", resolved: Shown = "all-ok", release: (() => void) | undefined, game: string | null = null;
  /** The detection transport's override: the framework check only, and only while a state is showing. */
  const transport = (target: Parameters<InstallDetectionTransport>[0]): ReturnType<InstallDetectionTransport> | undefined => {
    if (target !== "frameworks" || state === "live" || state === "no-game") return undefined;
    if (state === "checking") return new Promise(done => { release = () => { release = undefined; done({ ok: true, status: 200, data: frameworkCheckFor(resolved) }); }; });
    return Promise.resolve({ ok: true, status: 200, data: frameworkCheckFor(state) });
  };
  const idle = async () => { for (let i = 0; i < 200 && deps.detection().snapshot().busy; i++) await new Promise(done => setTimeout(done, 25)); };
  const settle = async (gameRoot: string | null) => {
    const outcome = await deps.setup.dispatch({ kind: "setup.update", fields: { gameRoot } });
    if (!outcome.ok) throw Error(outcome.message);
  };
  return {
    states: FRAMEWORK_SAMPLE_STATES,
    transport,
    /** Release a "checking" state's open request (it answers with the last state that showed). */
    release: () => release?.(),
    async state(name: FrameworkSampleState) {
      if (!(FRAMEWORK_SAMPLE_STATES as readonly string[]).includes(name)) throw Error(`Unknown state "${name}". Choose one of ${FRAMEWORK_SAMPLE_STATES.join(", ")}.`);
      const current = deps.setup.snapshot().view?.fields.gameRoot ?? null;
      if (name === "no-game") {
        if (current) game = current;
        state = "no-game";
        await settle(null);
        return;
      }
      // The state is set before the game folder comes back, so the watcher's own check is answered by the specimen too.
      if (!current && !game) throw Error("Choose a game folder in this verification workspace first (Settings › Game).");
      state = name;
      if (name !== "checking") resolved = name;
      if (!current) await settle(game);
      await idle();
      const run = deps.detection().dispatch({ kind: "detect.frameworkVersions" });
      if (name === "checking") return;
      const outcome = await run;
      if (!outcome.ok) throw Error(outcome.message);
    },
  };
}
