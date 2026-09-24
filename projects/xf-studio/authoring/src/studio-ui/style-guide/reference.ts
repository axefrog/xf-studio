import { PANEL_IDS } from "../layout-defaults";
import { code, esc, pattern, section } from "./kit";

export type PanelInfo = { id: string; title: string; description: string };

export function reference(panels: PanelInfo[]) {
  const actionMap: [string, string, string][] = [
    ["Presets rows", "preset.select, preset.edit {add, copy, rename, move, remove, restore}, collection.rename", "library.summary()"],
    ["Layers rows", "layer.select, layer.edit {add, duplicate, rename, move, reset, remove}, layer.setEnabled", "editor.recipe(), editor.layer()"],
    ["Colour & finish", "layer.setColor/Opacity (control transactions), layer.setFinish, glitter.*", "finishCatalogue(), glitterModelCatalogue(), choicesFor()"],
    ["Shape", "point.select, point.remove, path.edit, layer.setSymmetry, layer.edit reset", "editor.selected(), contextCapability()"],
    ["Pigment & edge", "pigment.edit, softness.edit (control transactions)", "editor.layer()"],
    ["Warp", "field.add/select/remove/clear, field.setReach", "editor.selectedField()"],
    ["Head / UV map", "viewport.attach/rehost/resize/uvCommand, camera.front, preview.setSurfaceControls/setWire, motion.*", "viewport.snapshot(), previewReadiness, contextAt()"],
    ["Character", "preview.setEyeShape/setDetail/setHair/setPiercings/setPiercingPreview, files savedV.import/export", "previewState().savedV/preview/previewOptions, status.assets"],
    ["Camera & light", "camera.setFov/endFovGesture/front, preview.setExposure/setKeyAngle/setNormals/setEyeOptics", "previewState().preview, status.assets.eyeOptics"],
    ["Motion", "motion.setIdle/setPaused/setContributions/setBlink/playBlink", "previewState().motion"],
    ["Preview quality", "quality.set, quality.rebuild", "previewState().quality, previewReadiness"],
    ["Library", "requests save/saveCopy/refresh/open, files collection.import/export/plan/recover, recipe.import/export, mask.export", "library.summary(), files.snapshot()"],
    ["Mod package", "files package.check/package.build", "files.snapshot().package (freshness), library.summary().progress"],
    ["Header / status", "recipe.undo, save, theme.set, layout.set", "status.snapshot(), preferences"],
  ];
  const keys: [string, string][] = [
    ["Ctrl+K · Ctrl+Shift+P", "Command palette"], ["Ctrl+Z", "Undo (outside text fields; cancels an active gesture first)"], ["Ctrl+S", "Save to library"],
    ["F6 / Shift+F6", "Next / previous region"], ["? ", "Keyboard shortcuts"], ["Shift+F10 · Menu", "Context or layout menu for the focused item"],
    ["← → Home End", "Tabs"], ["Alt+Shift+← →", "Reorder tab"], ["Delete", "Close tab / remove row"], ["↑ ↓ · Alt+↑ ↓", "Rows / reorder rows"],
    ["F2 · Ctrl+D", "Rename / duplicate row"], ["Esc", "Cancel drag, gesture, slider, menu, popover or dialog"], ["Ctrl (while dragging a panel)", "Float without snapping"],
    ["F · 1 · 2 · O", "Viewport: front/fit · both eyes · single eye · other eye"],
  ];
  const terms: [string, string][] = [
    ["Preset", "One complete look; one choice in the single in-game eye-makeup selector (plus Off)."],
    ["Layer", "One shape with colour, opacity and finish inside a preset. Top of the list = front."],
    ["Finish", "Matte, Satin, Metallic / foil, Shimmer / pearl, Glitter, Glossy / wet look, Colour-shifting. Satin is shown for the internal “regular”."],
    ["Draft", "The working collection autosaved in this browser."],
    ["Library · revision", "Explicit, immutable SQLite saves (r1, r2…). “Save to library”, never just “Save file”."],
    ["Collection file · recipe file · build plan", "Portable editable data; a build plan is compiler input — none is a mod."],
    ["Mod package · Check · Build", "Check lists what can be packaged (no files). Build creates your own mod files and checks them; the result says plainly that they are not tested in game and not installed."],
    ["Preview study", "A browser look with no game-export adapter."],
    ["Preview context", "Brows, lashes, hair, piercings, V's face: view-only, not authoring."],
  ];
  return section("reference", "08", "Reference",
    `Mappings from patterns to the public presentation port, the keyboard model, terminology and the rules that keep future UI work inside the architecture contract.`, [
    pattern({ id: "r-panels", title: "Panel registry", status: "implemented", wide: true,
      specimen: `<table class="ref-table"><thead><tr><th>ID</th><th>Title</th><th>Purpose</th></tr></thead><tbody>${panels.map(panel => `<tr><td><code>${panel.id}</code></td><td>${esc(panel.title)}</td><td>${esc(panel.description)}</td></tr>`).join("")}</tbody></table>`,
      what: `${PANEL_IDS.length} panels with stable IDs. A new panel gets an ID, a default group in both size classes and an entry here.`,
      when: "Adding or renaming panels. IDs are persisted in layouts; never reuse an ID for a different purpose." }),
    pattern({ id: "r-actions", title: "Pattern → action and state map", status: "implemented", wide: true,
      specimen: `<table class="ref-table"><thead><tr><th>Surface</th><th>Actions / requests</th><th>Read-only state</th></tr></thead><tbody>${actionMap.map(([a, b, c]) => `<tr><td>${a}</td><td><code>${b}</code></td><td><code>${c}</code></td></tr>`).join("")}</tbody></table>`,
      what: "Which application calls each surface uses. The authoritative contract is research/authoring/ui-action-catalogue.md and StudioPresentationPort.",
      when: "Designing a control: find its action first; if none exists, propose one (see rules)." }),
    pattern({ id: "r-keys", title: "Keyboard map", status: "implemented",
      specimen: `<dl class="shortcut-list wide">${keys.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join("")}</dl>`,
      what: "Global and contextual shortcuts. Every pointer-only operation has a keyboard path.", when: "Keep the ? sheet and this list identical." }),
    pattern({ id: "r-terms", title: "Terminology", status: "rule",
      specimen: `<dl class="facts">${terms.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("")}</dl>`,
      what: "User-facing words. Internal identifiers (regular, iridescent, xfas/…) never appear in the UI.", when: "All labels, messages and docs." }),
    pattern({ id: "r-a11y", title: "Accessibility checklist", status: "rule",
      what: "Text ≥4.5:1 and control boundaries ≥3:1 in both themes; visible focus on everything; every icon-only control named; disabled reasons in text; menus/tabs/lists follow ARIA patterns; live regions for results; reduced motion honoured; forced-colors fallbacks; no information by colour alone.",
      when: "Every change. Verify light and dark at 1600 px and 900 px, keyboard-only." }),
    pattern({ id: "r-rules", title: "Rules for new UI work", status: "rule", wide: true,
      specimen: `<ol class="principles"><li>Mount through ${code("createTrustedStudioBootstrap")}; views receive only ${code("StudioPresentationPort")} (enforced by tests/studio-ui-boundary.test.ts).</li>
        <li>Put validation, Undo, persistence and async policy in an application action first; then build the control, menu entry and palette command on it.</li>
        <li>Read with ${code("port.editor")}, ${code("library.summary()")}, ${code("previewState()")} and ${code("status")} while repainting; never mutate what you read; ${code("snapshot()")} clones everything and is for diagnostics.</li>
        <li>Show capabilities and reasons from the application; never duplicate limits or eligibility in the view (descriptor ranges drive sliders).</li>
        <li>Device adapters own canvases, Three, workers, files and network; the view only rehosts viewports and calls ports.</li>
        <li>Every new user-visible capability: action/catalogue entry, capability inventory, boundary test, this guide (pattern + status), both themes, keyboard path.</li>
        <li>Record unavoidable exceptions with owner and removal criterion in research/authoring/ui-architecture-boundary.md.</li></ol>`,
      what: "How to extend the Studio without re-coupling presentation and core.", when: "Every feature. The guide is regenerated by tools/build-style-guide.ts from the same CSS and components; tests fail if it falls out of sync." }),
  ]);
}
