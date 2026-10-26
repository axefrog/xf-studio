import { EYE_MAKEUP_MOD } from "../../legacy/eye-makeup/mod-branding";
import type { ProjectLink } from "../../app/project-links";
import type { FrameworkStatusView } from "../../installation/framework-status";
import { FrameworkStatus } from "../components";
import type { Frame, StudioRuntime } from "../runtime";

/** What the group's help tip says. */
export const FRAMEWORKS_HELP = [`The tools your mods rely on in the game. ${EYE_MAKEUP_MOD.modName} always counts, and expression sets count when your library holds any. XF Studio reads which version of each the game will load (through your Mod Organizer 2 profile, or the game folder) and tells you when one needs updating.`,
  "It never installs, updates or changes them: you do that yourself, from each one's own page."];
/** Where the Mod package card and the guides send a person who needs the detail. */
export const FRAMEWORKS_PLACE = "Settings › Game › Mod frameworks";

/** What Settings › Game › Mod frameworks shows of the check (the application derives it; one paint's read, never the host). */
export const frameworkView = (frame: Frame): FrameworkStatusView => frame.installDetection.frameworkStatus;

/** The Mod package card's one line, or null while no needed framework needs attention: it points here and never repeats the detail. */
export function frameworkNote(frame: Frame): string | null {
  const view = frameworkView(frame);
  return view.shown && view.attention
    ? `${view.attention === 1 ? "A mod framework needs" : "Mod frameworks need"} attention before your mod works in the game. ${FRAMEWORKS_PLACE} says which, and where to get each.`
    : null;
}

/**
 * Settings › Game › Mod frameworks: which ArchiveXL, RED4ext, redscript (and the others) the game will load, and the one next step for a
 * needed one that is too old or missing. The check itself is the detection service's `detect.frameworkVersions`, kept current by
 * `watchFrameworkInputs` (the composition root); here it is only shown, and asked for again on request. Nothing is installed or changed:
 * a release page opens in the person's browser (`links.open`, by name), and the person updates their own frameworks.
 */
export function frameworkGroup(rt: StudioRuntime) {
  const port = rt.port;
  const status = new FrameworkStatus({ label: "Mod frameworks", help: FRAMEWORKS_HELP, key: rt.key("settings.frameworks"),
    onCheckAgain: () => void checkAgain(), onRetryRequirements: () => void port.installDetection.retryRequirements().then(() => rt.changed()),
    onOpenLink: id => void openPage(id as ProjectLink) });
  // Checking and opening a page change nothing, so a read-only window keeps them (style guide t-read-only-window).
  status.element.dataset.readSafe = "";
  async function checkAgain() {
    const outcome = await port.installDetection.dispatch({ kind: "detect.frameworkVersions" });
    if (!outcome.ok) rt.feedback.toast("warning", "Frameworks", outcome.message, [], { code: outcome.code });
    rt.changed();
  }
  async function openPage(link: ProjectLink) {
    const outcome = await port.links.open(link);
    if (!outcome.ok) rt.feedback.toast("warning", "Frameworks", outcome.message);
  }
  return {
    element: status.element,
    /** Bring the group into view and put focus on Check again. */
    focus() {
      status.element.scrollIntoView?.({ block: "start" });
      requestAnimationFrame(() => status.checkAgain.focus());
    },
    update(frame: Frame) {
      const view = frameworkView(frame);
      status.update(view.shown ? view : null, { checkAgain: port.installDetection.capability({ kind: "detect.frameworkVersions" }) });
    },
  };
}
