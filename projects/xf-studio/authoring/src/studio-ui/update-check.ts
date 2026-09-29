import type { UpdateCheckState } from "../update-check-actions";
import type { StudioRuntime } from "./runtime";

/**
 * Checking for a newer XF Studio, in the Studio's words (release-readiness-audit.md item 22). The host decides whether the check at start
 * runs and what it found (`update-check.ts`); this module only asks at a quiet moment and says the answer. A newer version found at start
 * is a notice that fades (Open the releases page, or Skip this version); the person's own check (Help, the palette, Settings › Updates)
 * says what it found: the newest version, a newer one, or that it couldn't check, with the releases page as the way on.
 */
type Runtime = Pick<StudioRuntime, "port" | "feedback" | "changed">;
export type UpdateLine = { text: string; releases: boolean };

/** What the last check found, in one plain line; null before anything was checked. */
export function updateCheckLine(state: Readonly<UpdateCheckState>): UpdateLine | null {
  if (state.busy === "updates.check") return { text: "Checking for updates…", releases: false };
  const answer = state.answer;
  if (state.unreachable || (state.checkedByPerson && answer?.result === "failed"))
    return { text: "XF Studio couldn't check for updates just now. New versions are always on the releases page.", releases: true };
  if (answer?.result === "newer" && answer.latest)
    return { text: `XF Studio ${answer.latest.version} is available. You have ${answer.installed}.`, releases: true };
  if (state.checkedByPerson && answer?.result === "current") return { text: `You have the newest version, ${answer.installed}.`, releases: false };
  return null;
}

export async function openReleasesPage(rt: Runtime) {
  const outcome = await rt.port.links.open("project-releases");
  if (!outcome.ok) rt.feedback.toast("warning", "Updates", outcome.message);
}

/** The person's own check: runs in place and says what it found (a notice too, when asked from the palette). */
export async function checkForUpdatesNow(rt: Runtime, notice: boolean) {
  const updates = rt.port.updates;
  const allowed = updates.capability({ kind: "updates.check" });
  if (!allowed.available) { if (notice) rt.feedback.toast("info", "Updates", allowed.reason ?? "Checking for updates isn't available here."); return; }
  const running = updates.dispatch({ kind: "updates.check" });
  rt.changed();
  await running;
  rt.changed();
  const line = updateCheckLine(updates.snapshot());
  if (!notice || !line) { if (line) rt.feedback.record("info", "Updates", line.text); return; }
  const found = updates.snapshot().answer;
  rt.feedback.toast(line.releases && found?.result === "newer" ? "info" : line.releases ? "warning" : "success", "Updates", line.text,
    line.releases ? [{ label: "Open the releases page", run: () => void openReleasesPage(rt) }] : []);
}

/**
 * The check at start, after first paint and off the critical path: once the page has painted and the browser is idle, the host is asked;
 * a newer version not skipped before is announced once. Its failures stay silent.
 */
export function scheduleStartupUpdateCheck(rt: Runtime, idle: (run: () => void) => void) {
  idle(() => {
    const updates = rt.port.updates;
    if (!updates.capability({ kind: "updates.startupCheck" }).available) return;
    void updates.dispatch({ kind: "updates.startupCheck" }).then(outcome => {
      rt.changed();
      if (!outcome.ok || !outcome.answer.announce || !outcome.answer.latest) return;
      const version = outcome.answer.latest.version;
      rt.feedback.toast("info", "Updates", `XF Studio ${version} is available. You have ${outcome.answer.installed}.`, [
        { label: "Open the releases page", run: () => void openReleasesPage(rt) },
        { label: "Skip this version", run: () => void updates.dispatch({ kind: "updates.skipVersion", version }).then(() => {
          rt.feedback.record("info", "Updates", `XF Studio won't mention ${version} again. Help › Check for updates still finds it.`); }) },
      ]);
    });
  });
}
