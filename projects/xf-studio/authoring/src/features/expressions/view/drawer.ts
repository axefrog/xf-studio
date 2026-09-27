/**
 * The expression drawer (research/animation/expression-editor-design.md §4 "View", phase 1): every main-pose control of V's own face
 * rig, grouped by region with readable labels, a search, left/right link toggles (a linked pair is one slider, so a symmetric face is
 * one drag), numeric entry, reset per control and per group, "Start from" (rest, your saved expressions or any installed photo-mode
 * expression) and saving the expression as a named preset in the library. It shows the live preview's readiness in place, in plain
 * words with the one next step, and never freezes: every edit is recorded at once, whatever the preview is doing.
 *
 * It reaches the feature only through its view context (UI-73): the generic facade (the part, actions and form-control transactions),
 * the facial preview's snapshot and its part presets.
 */
import { applyCapability, button, note, Slider } from "../../../studio-ui/controls";
import { helpTip, setHelp } from "../../../studio-ui/components";
import { COMING_SOON } from "../../../studio-ui/coming-soon";
import { ItemList } from "../../../studio-ui/item-list";
import { h, setAttr, setText, setValue } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { FeatureViewContext } from "../../../studio-ui/views/feature-view";
import type { GenericFeatureFacade } from "../../../studio-presentation";
import type { FacialControl, FacialPreviewSnapshot, FacialStartPoint } from "../../../platform/api/facial";
import type { ExpressionPart } from "../part";
import type { ExpressionAction } from "../core";
import { EXPRESSIONS_PANEL_META } from "./contribution";

type Ctx = FeatureViewContext<GenericFeatureFacade>;
const EMPTY: ExpressionPart = Object.freeze({ controls: {}, links: {} });
const weight = (value: number) => value.toFixed(2);
/** Whether a pair edits both sides: its stored link, else linked for a mirror pair (the feature's rule, core.ts `pairLinked`). */
const linkedPair = (part: ExpressionPart, control: FacialControl) => !!control.pair && (part.links[control.pair] ?? !control.direction);

/**
 * One control's row: the shared `Slider` (its transaction rules: one Undo step per drag, Escape restores), a number box for exact entry
 * and a reset button. The number box and the row's layout are ad hoc until the component library has a "slider with numeric entry"
 * (a component request in the phase-1 report).
 */
let rows = 0;
class ControlRow {
  readonly element: HTMLElement;
  private readonly slider: Slider;
  private readonly number: HTMLInputElement;
  constructor(ctx: Ctx, readonly name: string, text: string, title: string) {
    const transaction = `expr:${name}`;
    this.slider = new Slider({ label: text, min: 0, max: 1, step: 0.01, format: weight, id: `expr-${name}-${++rows}`, transaction: {
      begin: () => { ctx.facade.controlBegin(transaction); },
      edit: value => {
        this.number.value = weight(value);
        const outcome = ctx.facade.controlEdit(transaction, { kind: "expression.setControl", name, value } as ExpressionAction);
        if (!outcome.ok) ctx.feedback.toast("warning", "Expression", outcome.message);
      },
      commit: () => ctx.facade.controlCommit(transaction),
      cancel: () => ctx.facade.controlCancel(transaction),
    } });
    this.slider.element.title = title;
    this.number = h("input", { class: "field expr-number", type: "number", min: "0", max: "1", step: "0.01", inputmode: "decimal", "aria-label": `${text}, exact value` });
    this.number.addEventListener("change", () => {
      const value = Number(this.number.value);
      if (!Number.isFinite(value)) return;
      ctx.dispatch({ kind: "expression.setControl", name, value: Math.min(1, Math.max(0, value)) } as ExpressionAction);
    });
    const reset = button({ label: `Reset ${text}`, icon: "reset", iconOnly: true, small: true, variant: "ghost",
      onClick: () => ctx.dispatch({ kind: "expression.reset", scope: "control", target: name } as ExpressionAction) });
    this.element = h("div", { class: "expr-row", "data-control": name }, this.slider.element, this.number, reset);
  }
  update(value: number) {
    this.slider.update(value);
    setValue(this.number, weight(value));
    this.element.classList.toggle("set", value > 0);
  }
}

/*
 * Ad hoc stand-ins for components the library doesn't have yet (requested from the UI component track; the phase-1 report lists them):
 * each is a small adapter, so switching to the library's component changes only its body.
 */
/** A left/right link toggle (the requested PairControl's toggle). */
function linkToggle(onToggle: (linked: boolean) => void) {
  const element = h("button", { class: "btn ghost small expr-link", type: "button", "aria-pressed": "true" }, "Linked");
  element.addEventListener("click", () => onToggle(element.getAttribute("aria-pressed") !== "true"));
  return { element, update(linked: boolean, uneven: boolean) {
    setAttr(element, "aria-pressed", linked ? "true" : "false");
    setText(element, linked ? "Linked" : "Separate");
    element.title = linked ? "Linked: moving one side moves both. Click to set each side on its own." : "Each side on its own. Click to link them (both then move together).";
    element.classList.toggle("uneven", uneven);
  } };
}
/** A collapsible group with a count and a reset (the requested Expander). */
function groupSection(label: string, open: boolean, onReset: () => void, children: HTMLElement[]) {
  const count = h("span", { class: "badge neutral expr-count" });
  const reset = button({ label: `Reset ${label.toLowerCase()}`, icon: "reset", iconOnly: true, small: true, variant: "ghost",
    onClick: event => { event.preventDefault(); onReset(); } });
  const element = h("details", { class: "expr-group", ...(open ? { open: true } : {}) },
    h("summary", {}, h("span", { class: "expr-group-title", text: label }), count, reset), ...children);
  return { element, setCount(set: number) { setText(count, set ? `${set} set` : ""); count.hidden = !set; },
    show(visible: boolean, forceOpen: boolean) { element.hidden = !visible; if (forceOpen && visible) element.open = true; } };
}
/** A filter box (the requested SearchField). */
function searchField(onFilter: (query: string) => void) {
  const element = h("input", { class: "field expr-search", type: "search", placeholder: "Find a control", "aria-label": "Find a face control" });
  element.addEventListener("input", () => onFilter(element.value.trim().toLowerCase()));
  element.addEventListener("keydown", event => { if (event.key === "Escape" && element.value) { event.stopPropagation(); element.value = ""; onFilter(""); } });
  return { element, get query() { return element.value.trim().toLowerCase(); } };
}

/** One drawer entry: a centre control, or a left/right pair with its link toggle. */
type Entry = { element: HTMLElement; group: string; search: string; update(part: ExpressionPart): void };

function centreEntry(ctx: Ctx, control: FacialControl): Entry {
  const row = new ControlRow(ctx, control.name, control.text, control.note ? `${control.name}: ${control.note}` : control.name);
  if (control.note) row.element.append(h("small", { class: "expr-note", text: control.note }));
  return { element: row.element, group: control.group, search: `${control.text} ${control.name}`.toLowerCase(),
    update: part => row.update(part.controls[control.name] ?? 0) };
}
function pairEntry(ctx: Ctx, left: FacialControl, right: FacialControl): Entry {
  const both = new ControlRow(ctx, left.name, `${left.label}, both sides`, `${left.name} and ${right.name}`);
  const one = new ControlRow(ctx, left.name, left.text, left.name), other = new ControlRow(ctx, right.name, right.text, right.name);
  const link = linkToggle(linked => ctx.dispatch({ kind: "expression.linkPair", pair: left.pair!, linked } as ExpressionAction));
  const element = h("div", { class: "expr-pair", "data-pair": left.pair ?? "" }, both.element, one.element, other.element, link.element);
  return { element, group: left.group, search: `${left.text} ${right.text} ${left.name} ${right.name}`.toLowerCase(),
    update(part) {
      const linked = linkedPair(part, left), l = part.controls[left.name] ?? 0, r = part.controls[right.name] ?? 0;
      both.element.hidden = !linked; one.element.hidden = linked; other.element.hidden = linked;
      both.update(l); one.update(l); other.update(r);
      // A linked pair whose sides differ (a start point's asymmetry) says so: the next drag sets both to the same value.
      link.update(linked, linked && Math.abs(l - r) > 1e-6);
    } };
}

/** What the live face preview is, in the status line's help tip. */
const PREVIEW_HELP = ["Your expression, solved with the game's own face rig on your V.", "Not yet compared with the game's photo mode."];

export function expressionDrawer(ctx: Ctx): PanelController {
  const status = h("p", { class: "note info expr-status", role: "status", "aria-live": "polite" });
  const next = button({ label: "", small: true, onClick: () => runNext() });
  // What the preview is (and how fast it answers) is the status line's help tip, not a footnote (ui-copy-and-layout-review.md §3.17).
  const previewTip = helpTip("the live face preview", PREVIEW_HELP);
  const statusLine = h("div", { class: "expr-status-line" }, status, previewTip, next);
  // Decided but not built yet (coming-soon.ts): face handles and sculpting (phase 2 and later), and export to the game (phase 3).
  const upcoming = (["expressionHandles", "expressionSculpt", "expressionExport"] as const).map(id => {
    const entry = COMING_SOON[id], control = button({ label: entry.label, small: true, variant: "quiet", onClick: () => {} });
    applyCapability(control, { available: false, reason: entry.reason });
    return control;
  });
  // Start from: rest, your saved expressions, then each provider's installed ones.
  const startFrom = h("select", { class: "field expr-start", "aria-label": "Start from" });
  startFrom.addEventListener("change", () => { const value = startFrom.value; startFrom.value = ""; if (value) begin(value); });
  // Save as a preset.
  const presetName = h("input", { class: "field expr-preset-name", type: "text", maxlength: "120", placeholder: "Name this expression", "aria-label": "Preset name" });
  const save = button({ label: "Save expression", icon: "save", title: "Save this expression to your library under its name, to start from it later", small: true, onClick: () => void savePreset() });
  // Your saved expressions: the shared list (select starts from one, F2 or double-click renames, Delete removes; the library's order is by name).
  const presetList = new ItemList<{ id: string; name: string; meta?: string }>({ label: "Your saved expressions", noun: "expression", maxLength: 120,
    onSelect: id => begin(`preset:${id}`), onMove: () => {}, onMenu: () => {},
    onRename: (id, name) => { const item = ctx.presets.list().items.find(entry => entry.id === id);
      if (item) void ctx.presets.execute({ kind: "partPreset.rename", id, name, revision: item.revision }).then(report); },
    onDelete: id => { const item = ctx.presets.list().items.find(entry => entry.id === id);
      if (item) void ctx.presets.execute({ kind: "partPreset.delete", id, revision: item.revision }).then(outcome => {
        report(outcome); if (outcome.ok) ctx.feedback.announce(`Deleted “${item.name}” from your library.`); }); } });
  const report = (outcome: { ok: boolean; message?: string }) => { if (!outcome.ok) ctx.feedback.toast("warning", "Expression", outcome.message ?? "That didn't work."); };
  // Search and whole-face commands.
  const search = searchField(() => filter());
  const mirrorLeft = button({ label: "Mirror left → right", icon: "mirror", small: true, variant: "quiet",
    onClick: () => ctx.dispatch({ kind: "expression.mirror", from: "left" } as ExpressionAction) });
  const mirrorRight = button({ label: "Mirror right → left", icon: "mirror", small: true, variant: "quiet",
    onClick: () => ctx.dispatch({ kind: "expression.mirror", from: "right" } as ExpressionAction) });
  const resetAll = button({ label: "Reset all", icon: "reset", small: true, variant: "quiet",
    onClick: () => ctx.dispatch({ kind: "expression.reset", scope: "all" } as ExpressionAction) });
  const groupsHost = h("div", { class: "expr-groups" });
  const waiting = note("", "muted");
  const presetsNote = note("", "muted");
  const element = h("div", { class: "panel-body expr-drawer" },
    statusLine,
    h("div", { class: "expr-bar" }, h("span", { class: "control-label", text: "Start from" }), startFrom),
    h("div", { class: "expr-bar" }, presetName, save), presetList.element, presetsNote,
    h("div", { class: "expr-bar" }, search.element), h("div", { class: "expr-bar expr-tools" }, mirrorLeft, mirrorRight, resetAll),
    h("div", { class: "row wrap gap-s expr-upcoming" }, ...upcoming),
    waiting, groupsHost);
  let entries: Entry[] = [], groups: { id: string; section: ReturnType<typeof groupSection>; entries: Entry[] }[] = [], built = "";
  let preview: FacialPreviewSnapshot | undefined, startPoints = new Map<string, FacialStartPoint>();

  const part = (): ExpressionPart => (ctx.facade.view()?.part as ExpressionPart | undefined) ?? EMPTY;
  function begin(value: string) {
    if (value === "rest") { ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "rest" }, controls: {} } as ExpressionAction); return; }
    if (value.startsWith("preset:")) {
      const preset = ctx.presets.list().items.find(item => item.id === value.slice(7));
      if (!preset) return;
      // The library lists parts already read at their current schema.
      const controls = (preset.part.body as Partial<ExpressionPart> | null)?.controls ?? {};
      ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: preset.id, name: preset.name }, controls } as ExpressionAction);
      return;
    }
    const point = startPoints.get(value.slice(10));
    if (point) ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "installed", clip: point.clip, set: point.set, row: point.row, provider: point.provider },
      controls: point.controls } as ExpressionAction);
  }
  async function savePreset() {
    const name = presetName.value.trim();
    // The library takes this feature's live part (the platform serializes it with the feature's codec).
    const request = { kind: "partPreset.save" as const, name };
    const allowed = ctx.presets.capability(request);
    if (!allowed.available) { ctx.feedback.toast("warning", "Expression", allowed.reason ?? "That can't be saved."); return; }
    const outcome = await ctx.presets.execute(request);
    if (outcome.ok) { presetName.value = ""; ctx.feedback.announce(`Saved “${name}” to your library.`); }
    else ctx.feedback.toast("warning", "Expression", outcome.message);
  }
  function runNext() {
    const step = preview?.next;
    if (step === "game-setup") ctx.openSettings("game");
    else if (step === "guide") void ctx.links.open("project-knowledge");
    else if (step === "stop-idle") ctx.platform({ kind: "motion.setIdle", enabled: false });
    else if (step === "retry") ctx.facial.retry();
  }
  function filter() {
    const query = search.query;
    for (const entry of entries) entry.element.hidden = !!query && !entry.search.includes(query);
    for (const group of groups) {
      const visible = group.entries.some(entry => !entry.element.hidden);
      group.section.show(visible, !!query);
    }
  }
  function build(controls: readonly FacialControl[]) {
    const key = controls.map(control => control.name).join(",");
    if (key === built) return;
    built = key;
    const byName = new Map(controls.map(control => [control.name, control])), done = new Set<string>();
    entries = [];
    for (const control of controls) {
      if (done.has(control.name)) continue;
      done.add(control.name);
      const partner = control.partner ? byName.get(control.partner) : undefined;
      // A mirror pair is one entry (left first); a direction pair is two, each with its own direction word.
      if (partner && !control.direction && control.side === "left") { done.add(partner.name); entries.push(pairEntry(ctx, control, partner)); }
      else entries.push(centreEntry(ctx, control));
    }
    groups = (preview?.groups ?? []).map(group => {
      const own = entries.filter(entry => entry.group === group.id);
      const section = groupSection(group.label, group.id === "mouth" || group.id === "brows",
        () => ctx.dispatch({ kind: "expression.reset", scope: "group", target: group.id } as ExpressionAction), own.map(entry => entry.element));
      section.element.dataset.group = group.id;
      return { id: group.id, section, entries: own };
    }).filter(group => group.entries.length);
    groupsHost.replaceChildren(...groups.map(group => group.section.element));
    filter();
  }
  function statusText(snapshot: FacialPreviewSnapshot | undefined): { text: string; tone: string; next?: string } {
    if (!snapshot) return { text: "The live face preview isn't connected here.", tone: "muted" };
    const nextLabel = { "game-setup": "Open Settings", guide: "How live expressions work", "stop-idle": "Stop the idle", retry: "Try again" } as const;
    const label = snapshot.next ? nextLabel[snapshot.next] : undefined;
    switch (snapshot.phase) {
      case "ready": return snapshot.reason ? { text: snapshot.reason, tone: "warning", next: label } : { text: "Showing your expression on the 3D head, solved with the game's own face rig.", tone: "muted" };
      case "updating": return { text: "Updating the face…", tone: "info" };
      case "idle": return { text: "Move a control or start from an expression: the 3D head shows it at once.", tone: "muted" };
      case "preparing": return { text: snapshot.reason ?? "Preparing…", tone: "info" };
      default: return { text: snapshot.reason ?? "The live face preview isn't available.", tone: "warning", next: label };
    }
  }
  function updateStartFrom(snapshot: FacialPreviewSnapshot | undefined) {
    const points = snapshot?.startPoints, presets = ctx.presets.list();
    const key = JSON.stringify([points?.phase, points?.items.length, presets.items.map(item => [item.id, item.name])]);
    if (startFrom.dataset.key === key) return;
    startFrom.dataset.key = key;
    startPoints = new Map((points?.items ?? []).map(point => [point.id, point]));
    const options: HTMLElement[] = [h("option", { value: "", text: "Choose…" }), h("option", { value: "rest", text: "Rest (no expression)" })];
    if (presets.items.length) options.push(h("optgroup", { label: "Your saved expressions" },
      presets.items.map(item => h("option", { value: `preset:${item.id}`, text: item.name }))));
    const providers = new Map<string, FacialStartPoint[]>();
    for (const point of points?.items ?? []) providers.set(point.provider, [...(providers.get(point.provider) ?? []), point]);
    for (const [provider, items] of providers) options.push(h("optgroup", { label: `Installed: ${provider}` },
      items.map(point => h("option", { value: `installed:${point.id}`, text: point.label, title: [point.clip, ...(point.notes ?? [])].join(" · ") }))));
    if (points && points.phase !== "ready") options.push(h("option", { value: "", disabled: true,
      text: points.phase === "preparing" ? "Reading the installed expressions…" : points.reason ?? "The installed expressions aren't available." }));
    startFrom.replaceChildren(...options);
  }
  function updatePresets() {
    const list = ctx.presets.list();
    presetList.update(list.items.map(item => ({ id: item.id, name: item.name })), undefined, !ctx.facade.editable().available);
    presetsNote.hidden = list.phase !== "failed";
    setText(presetsNote, list.phase === "failed" ? list.reason ?? "Saved expressions are unavailable right now." : "");
  }

  return {
    spec: { id: "expressions.controls", ...EXPRESSIONS_PANEL_META["expressions.controls"], element },
    update() {
      preview = ctx.facial.snapshot();
      const shown = statusText(preview);
      setText(status, shown.text); status.className = `note ${shown.tone} expr-status`;
      next.hidden = !shown.next; if (shown.next) setText(next, shown.next);
      const editable = ctx.facade.editable();
      for (const control of [startFrom, presetName, search.element]) control.disabled = !editable.available;
      applyCapability(save, editable);
      updateStartFrom(preview); updatePresets();
      const controls = preview?.controls;
      if (controls?.length) build(controls);
      waiting.hidden = !!controls?.length;
      setText(waiting, controls?.length ? "" : preview?.phase === "preparing" ? "The face's controls appear once your V's face is read from your game files."
        : "The face's controls come from your V's own face rig in your game files; they appear once it can be read.");
      const current = part();
      for (const entry of entries) entry.update(current);
      for (const group of groups) {
        const set = group.entries.reduce((sum, entry) => sum + (entry.element.querySelectorAll(".expr-row.set:not([hidden])").length), 0);
        group.section.setCount(set);
      }
      const latency = preview?.latency;
      setHelp(previewTip, latency ? [...PREVIEW_HELP, `It updates in about ${Math.round(latency.median)} ms.`] : PREVIEW_HELP);
    },
  };
}
