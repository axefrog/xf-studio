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

/** Whether the person's own check is running. Views that already show a result keep it until the new one arrives. */
export const checkingForUpdates = (state: Readonly<UpdateCheckState>) => state.busy === "updates.check";

/**
 * What the last check found, in one plain line; null before anything was checked. It never describes a check still running.
 * `releasesBelow`: the releases page is the next row (Help), so a newer version points there instead of repeating what's installed.
 */
export function updateCheckLine(state: Readonly<UpdateCheckState>, options: { releasesBelow?: boolean } = {}): UpdateLine | null {
  const answer = state.answer;
  if (state.unreachable || (state.checkedByPerson && answer?.result === "failed"))
    return { text: "XF Studio couldn't check for updates just now. New versions are always on the releases page.", releases: true };
  if (answer?.result === "newer" && answer.latest)
    return { text: options.releasesBelow ? `XF Studio ${answer.latest.version} is available. Download it from XF Studio releases below.`
      : `XF Studio ${answer.latest.version} is available. You have ${answer.installed}.`, releases: true };
  if (state.checkedByPerson && answer?.result === "current") return { text: `You have the newest version, ${answer.installed}.`, releases: false };
  return null;
}

export async function openReleasesPage(rt: Runtime) {
  const outcome = await rt.port.links.open("project-releases");
  if (!outcome.ok) rt.feedback.toast("warning", "Updates", outcome.message);
}

/**
 * The person's own check: runs in place and says what it found. Asked from the palette, which has no place of its own, a notice says
 * it's checking at once and gives way to the answer. Not being able to check is `info`: nothing is wrong on the person's side.
 */
export async function checkForUpdatesNow(rt: Runtime, notice: boolean) {
  const updates = rt.port.updates;
  const allowed = updates.capability({ kind: "updates.check" });
  if (!allowed.available) { if (notice) rt.feedback.toast("info", "Updates", allowed.reason ?? "Checking for updates isn't available here."); return; }
  const close = notice ? rt.feedback.toast("info", "Updates", "Checking for updates…", [], { sticky: true }) : null;
  const running = updates.dispatch({ kind: "updates.check" });
  rt.changed();
  await running;
  rt.changed();
  const line = updateCheckLine(updates.snapshot());
  close?.();
  if (!notice || !line) { if (line) rt.feedback.record("info", "Updates", line.text); return; }
  rt.feedback.toast(line.releases ? "info" : "success", "Updates", line.text,
    line.releases ? [{ label: "Open the releases page", run: () => void openReleasesPage(rt) }] : []);
}

/**
 * The check at start, asked for once the Studio is mounted: the service waits for first paint and a moment more, so it stays off the
 * critical path. A newer version not skipped before is announced once; its failures stay silent.
 */
export function startupUpdateCheck(rt: Runtime) {
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
}
