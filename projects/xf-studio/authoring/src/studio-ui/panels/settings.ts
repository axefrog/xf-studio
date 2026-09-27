import { applyCapability, button, note, section, Segmented, Toggle } from "../controls";
import { h } from "../dom";
import { openReportDialog } from "../diagnostics/report-dialog";
import { PANEL_META } from "../panel-meta";
import type { Frame, StudioRuntime } from "../runtime";
import { SETTINGS_PANEL, SETTINGS_SECTION_TITLES, type SettingsSection } from "../settings-sections";
import type { ViewContext } from "../views/panels";
import type { PanelController } from "./collection";
import { gameSetupForm } from "./game-setup";

type Theme = "system" | "light" | "dark";

/**
 * Settings (UI-108): everything a person configures, in one panel with plain groups: Game (game folder, mod manager and profile, the eye
 * plate head), Saves (where the Save Explorer reads saves), Tools (WolvenKit), Appearance (theme, input hints, research tools) and
 * Privacy & diagnostics. Composed from the library's controls and the one setup form (`game-setup.ts`); each choice is saved as it is
 * made, through its own typed port (local settings, UI preferences, diagnostics). Opened from the header's Settings button, the command
 * palette ("Settings", "Game & tools", "Where are my saves?"), Help and every "Open Settings" next step (`rt.settings.open`).
 */
export function settingsPanel(rt: StudioRuntime, context: ViewContext): PanelController & { show(section?: SettingsSection): void } {
  const port = rt.port, appearance = context.appearance;
  const form = gameSetupForm(rt);

  const theme = new Segmented<Theme>({ label: "Theme", options: [{ value: "system", label: "Match system", icon: "monitor" },
    { value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }], onSelect: value => { appearance.setTheme(value); rt.changed(); } });
  const hints = new Toggle({ label: "Show input hints", help: "A corner strip and tooltips in the 3D view and UV map that follow the pointer and the keys you hold.",
    onChange: on => { appearance.setHints(on); rt.changed(); } });
  const research = new Toggle({ label: "Show research tools", help: "Lighting calibration, glitter model studies, compiler plans and developer IDs. Off unless you're studying how XF Studio works.",
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

  const group = (id: SettingsSection, help: string, ...children: (Node | null)[]) => {
    const element = section({ title: SETTINGS_SECTION_TITLES[id], help }, ...children);
    element.dataset.settingsSection = id;
    return element;
  };
  const sections: Record<SettingsSection, HTMLElement> = {
    game: group("game", "Saved on this computer as you choose. XF Studio finds your game and mod manager for you; change a choice only if it picked the wrong one.",
      form.status, form.game),
    saves: group("saves", "Where the Save Explorer finds your saves. XF Studio uses the game's own saves folder unless you choose another.", form.saves),
    tools: group("tools", "XF Studio sets WolvenKit up for you (it asks before downloading). Name your own copy only if you'd rather use it.", form.tools),
    appearance: group("appearance", "Stored with your workspace on this computer.", theme.element, hints.element, research.element, h("div", { class: "row wrap gap-s" }, reference)),
    privacy: group("privacy", "What XF Studio records about itself, and how to send a report.",
      note("Diagnostics stay on this computer. A problem report is prepared for you to review and save; nothing is sent by itself."),
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
      if (which === "game" || which === "saves" || which === "tools") form.focus(which);
      else requestAnimationFrame(() => target.querySelector<HTMLElement>("button:not([hidden]), input:not([hidden])")?.focus());
    },
    update(frame: Frame) {
      form.update(frame);
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
