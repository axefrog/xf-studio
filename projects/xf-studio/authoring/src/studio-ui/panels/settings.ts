import { applyCapability, button, note, setButtonLabel, setButtonVariant, section, Segmented, Toggle } from "../controls";
import { h, setText } from "../dom";
import { openReportDialog } from "../diagnostics/report-dialog";
import type { HelpText } from "../help-tip";
import { PANEL_META } from "../panel-meta";
import type { Frame, StudioRuntime } from "../runtime";
import { SETTINGS_PANEL, SETTINGS_SECTION_TITLES, type SettingsSection } from "../settings-sections";
import type { ViewContext } from "../views/panels";
import { wolvenKitStepButton } from "../wolvenkit-step";
import type { PanelController } from "./collection";
import { gameSetupForm, wantsWolvenKitStep } from "./game-setup";
import { checkForUpdatesNow, checkingForUpdates, openReleasesPage, updateCheckLine } from "../update-check";

/** A size in the person's terms ("1.2 GB", "340 MB"). */
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

type Theme = "system" | "light" | "dark";

/**
 * Settings (UI-109): everything a person configures, in one panel with plain groups: Game (game folder, mod manager and profile, the eye
 * plate head), Saves (where the Save Explorer reads saves), Tools (WolvenKit), Appearance (theme, input hints, research tools), Updates
 * (the check at start, and checking now) and Privacy & diagnostics. Composed from the library's controls and the one setup form (`game-setup.ts`); each choice is saved as it is
 * made, through its own typed port (local settings, UI preferences, diagnostics). Opened from the header's Settings button, the command
 * palette ("Settings", "Game folder and mod manager", "Where are my saves?"), Help and every "Open Settings" next step (`rt.settings.open`).
 */
export function settingsPanel(rt: StudioRuntime, context: ViewContext): PanelController & { show(section?: SettingsSection): void } {
  const port = rt.port, appearance = context.appearance;
  const form = gameSetupForm(rt);

  const theme = new Segmented<Theme>({ label: "Theme", options: [{ value: "system", label: "Match system", icon: "monitor" },
    { value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }], onSelect: value => { appearance.setTheme(value); rt.changed(); } });
  const hints = new Toggle({ label: "Show input hints", help: "Hints in the 3D view and UV map that follow the pointer and the keys you hold.",
    onChange: on => { appearance.setHints(on); rt.changed(); } });
  const research = new Toggle({ label: "Show research tools", help: ["Finishes still waiting for a check in the game (Shimmer, Glitter), rendering and lighting studies, raw exports, compiler plans and developer IDs.",
    "Off unless you're studying how XF Studio works: none of them is needed to make your mod."],
    onChange: on => { appearance.setResearch(on); rt.changed(); } });
  const reference = button({ label: "Keyboard & mouse…", icon: "keyboard", small: true, variant: "quiet", onClick: () => appearance.openReference() });

  const deep = new Toggle({ label: "Diagnostic mode", help: "Records more detail about what XF Studio does, for a day, to help find a problem. It stays on this computer.",
    reserveNote: true, onChange: on => { void setDiagnosticMode(on ? "deep" : "normal"); } });
  const report = button({ label: "Report a problem…", icon: "warning", small: true, onClick: () => openReportDialog(rt, null) });
  async function setDiagnosticMode(mode: "deep" | "normal") {
    const result = await port.diagnostics.dispatch({ kind: "diagnostics.setMode", mode });
    if (result.ok) rt.feedback.record("info", "Diagnostics", result.message); else rt.feedback.toast("warning", "Diagnostics", result.message);
    rt.changed();
  }

  // Updates: the check at start is a saved setting (on by default); Check now runs the person's own check in place.
  const checkOnStart = new Toggle({ label: "Check for updates when XF Studio starts",
    help: "XF Studio asks GitHub, where each new version is published, whether there's a newer one. Nothing about you or your looks is sent.",
    onChange: on => { void saveCheckOnStart(on); } });
  async function saveCheckOnStart(on: boolean) {
    const outcome = await port.localSetup.dispatch({ kind: "setup.update", fields: { checkForUpdates: on } });
    if (outcome.ok) rt.feedback.record("info", "Updates", on ? "XF Studio will check for updates when it starts." : "XF Studio won't check for updates when it starts.");
    else rt.feedback.toast("warning", "Updates", outcome.message);
    rt.changed();
  }
  const checkNow = button({ label: "Check now", icon: "refresh", small: true, onClick: () => void checkForUpdatesNow(rt, false) });
  const updateText = h("span", { class: "muted small", role: "status" });
  const releases = button({ label: "Open the releases page", icon: "link", small: true, variant: "quiet", onClick: () => void openReleasesPage(rt) });

  // WolvenKit's one next step, beside the Game line that says it's needed (release-readiness-audit.md item 14; UI-161: once, there).
  const gameStep = wolvenKitStepButton(rt);
  // The game files prepared for the 3D view on this computer, and clearing them: cache upkeep, so it lives here and in the palette
  // rather than in the Character panel (release-readiness-audit.md item 6).
  const preparedText = h("span", { class: "muted small" });
  const clearPrepared = button({ label: "Clear prepared game files", icon: "trash", small: true, variant: "quiet",
    title: "Removes the files XF Studio prepared from your game for the 3D view. They are read from your game again when needed; your makeup, presets and settings stay.",
    onClick: () => rt.dispatch({ kind: "character.clearPreparedFiles" }) });
  const prepared = h("div", { class: "row wrap gap-s align-center" }, preparedText, clearPrepared);

  const group = (id: SettingsSection, help: HelpText, ...children: (Node | null)[]) => {
    const element = section({ title: SETTINGS_SECTION_TITLES[id], help }, ...children);
    element.dataset.settingsSection = id;
    return element;
  };
  const sections: Record<SettingsSection, HTMLElement> = {
    game: group("game", "Saved on this computer as you choose. XF Studio finds your game and mod manager for you; change a choice only if it picked the wrong one.",
      form.status, h("div", { class: "row wrap gap-s" }, gameStep.element), form.game),
    saves: group("saves", "Where the Save Explorer finds your saves. XF Studio uses the game's own saves folder unless you choose another.", form.saves),
    tools: group("tools", ["XF Studio sets WolvenKit up for you (it asks before downloading). Name your own copy only if you'd rather use it.",
      "The 3D view is built from files XF Studio prepares from your game. Clearing them frees the space; they're prepared again when needed."],
    form.tools, prepared),
    appearance: group("appearance", "Stored with your workspace on this computer.", theme.element, hints.element, research.element, h("div", { class: "row wrap gap-s" }, reference)),
    updates: group("updates", "New versions are published on GitHub. XF Studio tells you when there's one; you download and install it yourself.",
      checkOnStart.element, h("div", { class: "row wrap gap-s align-center" }, checkNow, updateText, releases)),
    privacy: group("privacy", "Diagnostics stay on this computer. A problem report is prepared for you to review and save; nothing is sent by itself.",
      deep.element, h("div", { class: "row wrap gap-s" }, report)),
  };
  const element = h("div", { class: "panel-content settings-panel" }, ...Object.values(sections));

  let shown = false;
  return {
    spec: { id: SETTINGS_PANEL, ...PANEL_META[SETTINGS_PANEL], element,
      // Finding the game and mod manager is read only and quick: done the first time Settings is shown.
      visibility: visible => { if (visible && !shown) { shown = true; form.detect(); } } },
    /** Bring a group into view and put focus on its first control (the first thing still to choose, in Game). */
    show(which: SettingsSection = "game") {
      const target = sections[which];
      target.scrollIntoView?.({ block: "start" });
      // While WolvenKit is the thing to do, Game lands on its step (the palette's WolvenKit entry comes here).
      if (which === "game" && !gameStep.element.hidden) requestAnimationFrame(() => gameStep.element.focus());
      else if (which === "game" || which === "saves" || which === "tools") form.focus(which);
      else requestAnimationFrame(() => target.querySelector<HTMLElement>("button:not([hidden]), input:not([hidden])")?.focus());
    },
    update(frame: Frame) {
      form.update(frame);
      const step = wantsWolvenKitStep(frame);
      gameStep.update(frame, step);
      gameStep.element.parentElement!.hidden = gameStep.element.hidden;
      const files = frame.preview.character?.prepared;
      prepared.hidden = !files;
      setText(preparedText, !files ? "" : files.clearing ? "Clearing the prepared game files…"
        : files.bytes === null ? "Prepared game files: checking their size…"
          : `Prepared game files: ${files.bytes ? size(files.bytes) : "none"}${files.freed ? ` · cleared ${size(files.freed)}` : ""}`);
      applyCapability(clearPrepared, port.authoring.capability({ kind: "character.clearPreparedFiles" }));
      const setupView = frame.localSetup.view;
      checkOnStart.update(setupView?.fields.checkForUpdates ?? true, { disabled: !setupView || setupView.source === "backup",
        reason: !setupView ? "Reading your settings…" : setupView.source === "backup" ? "Restore your previous settings first." : undefined });
      // While checking, the button says so (and waits); the line and the releases button keep the last result, so the row never
      // reflows. A newer version makes the releases page the main action and Check now the quiet one.
      const state = port.updates.snapshot(), checking = checkingForUpdates(state);
      setButtonLabel(checkNow, checking ? "Checking…" : "Check now");
      applyCapability(checkNow, port.updates.capability({ kind: "updates.check" }));
      if (!checking) {
        const line = updateCheckLine(state);
        setText(updateText, line?.text ?? "");
        releases.hidden = !line?.releases;
        const newer = state.answer?.result === "newer" && !!line?.releases && !state.unreachable;
        setButtonVariant(checkNow, newer ? "quiet" : undefined);
        setButtonVariant(releases, newer ? "primary" : "quiet");
      }
      theme.update(appearance.theme());
      hints.update(appearance.hints());
      research.update(appearance.research());
      const mode = port.diagnostics.snapshot().mode;
      const next = mode?.mode === "deep" ? "normal" : "deep", allowed = port.diagnostics.capability({ kind: "diagnostics.setMode", mode: next });
      deep.update(mode?.mode === "deep", { disabled: !allowed.available, reason: allowed.reason,
        note: mode?.mode === "deep" && mode.until ? `On until ${new Date(mode.until).toLocaleString()}.` : "" });
      applyCapability(report, port.diagnostics.capability({ kind: "diagnostics.prepareReport" }));
    },
  };
}
