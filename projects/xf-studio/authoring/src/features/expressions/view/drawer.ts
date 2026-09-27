/**
 * The expression drawer (research/animation/expression-editor-design.md §4 "View", phase 1), composed from the component library
 * (UI-108): every main-pose control of V's own face rig, grouped by region with readable labels, and the ways to start and keep an
 * expression.
 *
 * - **Layout** follows the design review's target (research/authoring/ui-visual-qa-checklist.md): the panel's padding and rhythm, two
 *   sections (Start from, Face), one readout per value, the whole-face commands in the Face heading, and status text only when there is
 *   something to act on.
 * - **Start from** is a searchable tree that fits its rows (up to six, then it scrolls), grouped by source: your saved expressions, the
 *   built-in natural samples ("Natural", from `data/expression-samples`), the game's own and each mod's. One click (or Enter) starts from a row; the row
 *   the expression started from is marked current. A saved expression's Rename and Delete are in its context menu (right-click,
 *   Shift+F10, its More button), and F2 and Delete work on a focused row; Rename edits in place (a value popover) and Delete asks first
 *   (a confirm popover), since the library can't undo it.
 * - **Save expression…** (in the Start from heading) opens a value popover with a name to accept or change.
 * - **Face:** the heading holds Symmetric (every left/right pair follows its counterpart), a More menu (mirror either side onto the other,
 *   flip the face) and Reset all (back to rest); then a search and one group section per region (count, reset). A left/right pair is a
 *   PairControl, a centre control a SliderWithValue, an opposing pair one BipolarSlider (gaze and the nostrils per side: one slider while
 *   linked, one per side while separate); all have exact entry and reset, and one Undo step per drag. The neck and head turn and tilt correctives sit in
 *   Advanced, folded. Controls the host's solver found move nothing on this face are not offered (a stored value on one is kept and
 *   cleared by Reset all).
 * - **Status:** a problem with the live preview shows at the top in plain words with the one next step; while the face updates, the Face
 *   heading says so in a reserved place (nothing moves); what the preview is and how fast it updates is the Face heading's help tip.
 *   It never freezes: every edit is recorded at once, whatever the preview is doing.
 *
 * It reaches the feature only through its view context (UI-73): the generic facade (the part, actions and form-control transactions),
 * the facial preview's snapshot (the rig's controls, the installed expressions and the built-in samples) and its part presets.
 */
import { applyCapability, button, GroupSection, helpTip, iconButton, note, openConfirmPopover, openMenu, openValuePopover, PairControl, progressBar, SearchField,
  setHelp, SliderWithValue, BipolarSlider, Toggle, TreeView, RememberedSet, type MenuItem, type TreeGroupData, type TreeItemRef, type TreeRowData } from "../../../studio-ui/components";
import { COMING_SOON } from "../../../studio-ui/coming-soon";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { FeatureViewContext } from "../../../studio-ui/views/feature-view";
import type { GenericFeatureFacade } from "../../../studio-presentation";
import type { FacialAxisControl, FacialControl, FacialPreviewSnapshot, FacialStartPoint } from "../../../platform/api/facial";
import type { ExpressionPart } from "../part";
import type { ExpressionAction } from "../core";
import { EXPRESSIONS_PANEL_META } from "./contribution";

type Ctx = FeatureViewContext<GenericFeatureFacade>;
type Availability = { disabled: boolean; reason?: string };
const EMPTY: ExpressionPart = Object.freeze({ controls: {}, links: {} });
/** Whether a pair edits both sides: its stored link, else its default (the feature's rule, core.ts `pairLinked`, read from the snapshot). */
const linkedPair = (part: ExpressionPart, control: FacialControl) => !!control.link && (part.links[control.link.key] ?? control.link.byDefault);
const linkedAxis = (part: ExpressionPart, axis: FacialAxisControl) => !!axis.link && axis.link.keys.every(key => part.links[key] ?? axis.link!.byDefault);
/** The note a mixed axis carries: both ends are set (a game expression can do this); the raw weights stay until the axis is moved. */
const mixedNote = (axis: FacialAxisControl, part: ExpressionPart) => {
  const negative = part.controls[axis.negative] ?? 0, positive = part.controls[axis.positive] ?? 0;
  return negative > 0 && positive > 0 ? `Both ends set (${percent(negative)} % ${axis.ends[0]}, ${percent(positive)} % ${axis.ends[1]}); moving it keeps one.` : undefined;
};
/** Controls show their weight as a percentage (0.35 → 35 %), with whole-percent steps; the part stores 0–1. */
const SLIDER = { min: 0, max: 100, step: 1, unit: "%", format: (percent: number) => `${Math.round(percent)} %`, defaultValue: 0, reset: true } as const;
const percent = (weight: number | undefined) => Math.round((weight ?? 0) * 1000) / 10;

/** One drawer entry: a centre or direction control, or a left/right pair. */
type Entry = { element: HTMLElement; group: string; search: string; names: readonly string[];
  /** The link keys its sides follow each other by (a pair's), for its group's mirror toggle. */
  links?: readonly string[];
  update(part: ExpressionPart, state: Availability): void };

/** The form-control transaction of one control (one Undo step per drag or exact entry). */
function controlTransaction(ctx: Ctx, name: string) {
  const id = `expr:${name}`;
  return {
    begin: () => { ctx.facade.controlBegin(id); },
    edit: (percentValue: number) => {
      const value = Math.min(1, Math.max(0, percentValue / 100));
      const outcome = ctx.facade.controlEdit(id, { kind: "expression.setControl", name, value } as ExpressionAction);
      if (!outcome.ok) ctx.feedback.toast("warning", "Expression", outcome.message);
    },
    commit: () => ctx.facade.controlCommit(id),
    cancel: () => ctx.facade.controlCancel(id),
  };
}
function singleEntry(ctx: Ctx, control: FacialControl): Entry {
  const slider = new SliderWithValue({ ...SLIDER, label: control.text, help: control.note, transaction: controlTransaction(ctx, control.name) });
  slider.element.dataset.control = control.name;
  return { element: slider.element, group: control.group, search: `${control.text} ${control.name}`.toLowerCase(), names: [control.name],
    update: (part, state) => slider.update(percent(part.controls[control.name]), state) };
}
function pairEntry(ctx: Ctx, left: FacialControl, right: FacialControl): Entry {
  const tx = { left: controlTransaction(ctx, left.name), right: controlTransaction(ctx, right.name) };
  let active = tx.left;
  const pair = new PairControl({ ...SLIDER, label: left.label, help: left.note,
    transaction: { begin: sides => { active = sides === "right" ? tx.right : tx.left; active.begin(); }, edit: ({ value }) => active.edit(value),
      commit: () => active.commit(), cancel: () => active.cancel() } });
  pair.element.dataset.pair = left.pair ?? "";
  return { element: pair.element, group: left.group, search: `${left.text} ${right.text} ${left.name} ${right.name}`.toLowerCase(), names: [left.name, right.name],
    links: left.link ? [left.link.key] : [],
    update: (part, state) => pair.update({ left: percent(part.controls[left.name]), right: percent(part.controls[right.name]) }, { linked: linkedPair(part, left), ...state }) };
}

/** The form-control transaction of a two-way control: its value from −100 to 100 % sets both ends (one Undo step per drag). */
function axisTransaction(ctx: Ctx, axis: FacialAxisControl) {
  const id = `expr:${axis.key}`;
  return {
    begin: () => { ctx.facade.controlBegin(id); },
    edit: (percentValue: number) => {
      const value = Math.min(1, Math.max(-1, percentValue / 100));
      const outcome = ctx.facade.controlEdit(id, { kind: "expression.setAxis", negative: axis.negative, positive: axis.positive, value } as ExpressionAction);
      if (!outcome.ok) ctx.feedback.toast("warning", "Expression", outcome.message);
    },
    commit: () => ctx.facade.controlCommit(id),
    cancel: () => ctx.facade.controlCancel(id),
  };
}
const axisPercent = (part: ExpressionPart, axis: FacialAxisControl) => percent(part.controls[axis.positive]) - percent(part.controls[axis.negative]);
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
function axisEntry(ctx: Ctx, axis: FacialAxisControl, group: string): Entry {
  const slider = new BipolarSlider({ label: axis.label.replace(/: [^:]*↔.*$/, ""), min: -100, max: 100, step: 1, unit: "%",
    ends: { negative: capital(axis.ends[0]), positive: capital(axis.ends[1]) }, transaction: axisTransaction(ctx, axis) });
  slider.element.dataset.axis = axis.key;
  return { element: slider.element, group, search: `${axis.label} ${axis.negative} ${axis.positive}`.toLowerCase(), names: [axis.negative, axis.positive],
    update: (part, state) => slider.update(axisPercent(part, axis), { ...state, mixed: !!mixedNote(axis, part) }) };
}
/**
 * A left/right pair of two-way controls (gaze per eye, the nostrils). Linked, one slider moves both the way the symmetry rule says (the
 * eyes look the same way, never crossed); separate, the pair's name heads one slider per side. Both layouts are built once and only one
 * shows at a time.
 */
function axisPairEntry(ctx: Ctx, left: FacialAxisControl, right: FacialAxisControl, group: string): Entry {
  const lateral = left.ends[0] === "left";
  const name = left.gaze ? (lateral ? "Look sideways" : "Look up or down") : left.label.replace(/, left:.*$/, "").replace(/: [^:]*↔.*$/, "");
  const ends = { negative: capital(left.ends[0]), positive: capital(left.ends[1]) };
  const sideNames = left.gaze ? { left: "Left eye", right: "Right eye" } : { left: "Left", right: "Right" };
  const make = (label: string, axis: FacialAxisControl) => new BipolarSlider({ label, min: -100, max: 100, step: 1, unit: "%", ends, transaction: axisTransaction(ctx, axis) });
  const both = make(name, left), sides = { left: make(sideNames.left, left), right: make(sideNames.right, right) };
  const separate = h("div", { class: "expr-axis-sides", role: "group", "aria-label": name }, h("p", { class: "expr-caption", text: name }), sides.left.element, sides.right.element);
  const element = h("div", { class: "expr-axis-pair", "data-axis": left.key }, both.element, separate);
  return { element, group, search: `${name} ${left.label} ${right.label} ${left.negative} ${left.positive}`.toLowerCase(),
    names: [left.negative, left.positive, right.negative, right.positive], links: left.link?.keys ?? [],
    update: (part, state) => {
      const linked = linkedAxis(part, left);
      both.element.hidden = !linked; separate.hidden = linked;
      both.update(axisPercent(part, left), { ...state, mixed: !!mixedNote(left, part) });
      sides.left.update(axisPercent(part, left), { ...state, mixed: !!mixedNote(left, part) });
      sides.right.update(axisPercent(part, right), { ...state, mixed: !!mixedNote(right, part) });
    } };
}

/** Rows of the Start from tree: what one starts from. */
type Start = { kind: "saved"; id: string } | { kind: "sample"; id: string } | { kind: "installed"; id: string };
const startKey = (start: Start) => `${start.kind}:${start.id}`;
/** Session memory of the Start from tree's open groups (saved and natural open at first). */
/** The Start from tree's open groups, remembered across reloads (Saved and Natural open by default). */
const openStartGroups = new RememberedSet("expressions:start/", group => group === "saved" || group === "natural");
/** Search-match ranges of `query` in `label`. */
const matches = (label: string, query: string): [number, number][] => {
  if (!query) return [];
  const at = label.toLowerCase().indexOf(query);
  return at < 0 ? [] : [[at, at + query.length]];
};

export function expressionDrawer(ctx: Ctx): PanelController {
  // A problem with the live preview (and its one next step) shows at the top; nothing shows while all is well.
  const status = note("", "warning"); status.classList.add("expr-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const next = button({ label: "Try again", small: true, onClick: () => runNext() });
  const statusLine = h("div", { class: "expr-status-line" }, status, next);
  // While the face updates, a sweep runs along the Face heading's foot (floating, so it moves nothing) and the live region says so.
  const updating = progressBar({ label: "Updating the face", className: "expr-updating" });
  const updatingText = h("span", { class: "sr-only", role: "status", "aria-live": "polite" });
  const report = (outcome: { ok: boolean; message?: string }) => { if (!outcome.ok) ctx.feedback.toast("warning", "Expression", outcome.message ?? "That didn't work."); };

  // ---- Start from ----
  let startQuery = "";
  const startSearch = new SearchField({ label: "Find an expression to start from", placeholder: "Find an expression", onFilter: query => { startQuery = query.toLowerCase(); paintStart(); },
    onArrowDown: () => tree.focus() });
  const tree: TreeView = new TreeView({ label: "Start from", emptyText: "No expression matches.", maxRows: 6, minRows: 3,
    onActivate: key => begin(key),
    onToggle: (group, open) => { openStartGroups.set(group, open); paintStart(); },
    onKey: (event, item) => {
      if (item.kind !== "row" || !item.id.startsWith("saved:")) return false;
      if (event.key === "F2") { renamePreset(item.id.slice(6), rowElement(item)); return true; }
      if (event.key === "Delete") { deletePreset(item.id.slice(6), rowElement(item)); return true; }
      return false;
    },
    onMenu: (item, anchor) => { if (item.kind === "row" && item.id.startsWith("saved:")) presetMenu(item.id.slice(6), anchor); },
    trailing: row => row.id.startsWith("saved:") ? iconButton({ label: `More actions for “${row.label}”`, icon: "more", small: true, menu: true,
      onClick: event => presetMenu(row.id.slice(6), event.currentTarget as Element) }) : null });
  const rowElement = (item: TreeItemRef) => tree.element.querySelector<HTMLElement>(`[data-id="${CSS.escape(item.id)}"]`) ?? tree.element;
  const save = button({ label: "Save expression…", icon: "save", small: true, title: "Save this expression to your library under a name, to start from it later",
    onClick: event => savePreset(event.currentTarget as Element) });
  const presetsNote = note("", "muted");

  // ---- Face ----
  let controlQuery = "";
  const controlSearch = new SearchField({ label: "Find a face control", placeholder: "Find a control", onFilter: query => { controlQuery = query.toLowerCase(); filter(); } });
  // Symmetric: every left/right pair linked (one Undo step), so a change on one side follows on the other by its rule.
  const symmetric = new Toggle({ label: "Symmetric",
    onChange: on => ctx.dispatch({ kind: "expression.setLinks", links: Object.fromEntries(allLinkKeys().map(key => [key, on])) } as ExpressionAction) });
  symmetric.element.classList.add("expr-symmetric");
  symmetric.input.title = "Each left/right pair follows the other: skin as a mirror image, the eyes looking the same way. Turn it off to set each side on its own.";
  // The one-off whole-face commands, in the heading's More menu.
  const more = iconButton({ label: "More face commands", icon: "more", small: true, menu: true, onClick: event => faceMenu(event.currentTarget as Element) });
  // Reset all: back to V's resting face (the Start from marker clears too).
  const resetAll = iconButton({ label: "Reset all", icon: "reset", small: true, title: "Reset all: back to V's resting face",
    onClick: () => ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "rest" }, controls: {}, links: {} } as ExpressionAction) });
  const faceHelp = helpTip("the face controls");
  const groupsHost = h("div", { class: "expr-groups" });
  const waiting = note("", "muted");
  const noControls = h("div", { class: "expr-no-match" });

  const element = h("div", { class: "panel-content expr-drawer" },
    statusLine,
    h("section", { class: "section", "aria-label": "Start from" },
      h("div", { class: "section-head" }, h("h3", { class: "section-title", text: "Start from" }), h("span", { class: "block-actions" }, save)),
      startSearch.element, tree.element, presetsNote),
    h("section", { class: "section", "aria-label": "Face" },
      h("div", { class: "section-head" }, h("h3", { class: "section-title", text: "Face" }), faceHelp,
        h("span", { class: "block-actions" }, symmetric.element, more, resetAll), updating.element, updatingText),
      controlSearch.element, waiting, noControls, groupsHost));

  let entries: Entry[] = [], groups: { id: string; title: string; section: GroupSection; entries: Entry[]; keys: string[]; mirror?: HTMLButtonElement }[] = [], built = "";
  let preview: FacialPreviewSnapshot | undefined, startPoints = new Map<string, FacialStartPoint>(), current = EMPTY, availability: Availability = { disabled: false };
  const part = (): ExpressionPart => (ctx.facade.view()?.part as ExpressionPart | undefined) ?? EMPTY;

  function begin(key: string) {
    const [kind, ...rest] = key.split(":"), id = rest.join(":");
    if (kind === "saved") {
      const preset = ctx.presets.list().items.find(item => item.id === id);
      if (!preset) return;
      // The library lists parts already read at their current schema.
      const body = preset.part.body as Partial<ExpressionPart> | null;
      ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: preset.id, name: preset.name }, controls: body?.controls ?? {},
        ...(body?.links ? { links: body.links } : {}) } as ExpressionAction);
    } else if (kind === "sample") {
      const sample = preview?.samples.find(item => item.id === id);
      if (sample) ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: sample.id, name: sample.name }, controls: sample.controls,
        links: sample.links } as ExpressionAction);
    } else if (kind === "installed") {
      const point = startPoints.get(id);
      if (point) ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "installed", clip: point.clip, set: point.set, row: point.row, provider: point.provider },
        controls: point.controls } as ExpressionAction);
    }
  }
  /** The Start from row the current expression started from. */
  function currentStart(): string | undefined {
    const origin = current.origin;
    if (!origin) return undefined;
    if (origin.kind === "preset") return startKey(origin.id.startsWith("xf-sample:") ? { kind: "sample", id: origin.id } : { kind: "saved", id: origin.id });
    if (origin.kind === "installed") {
      const point = [...startPoints.values()].find(item => item.clip === origin.clip && item.set === origin.set && (origin.row === undefined || item.row === origin.row));
      return point ? startKey({ kind: "installed", id: point.id }) : undefined;
    }
    return undefined;
  }
  function startGroups(): TreeGroupData[] {
    const q = startQuery, keep = (label: string, extra = "") => !q || `${label} ${extra}`.toLowerCase().includes(q);
    const row = (start: Start, label: string, extra?: { secondary?: string; search?: string }): TreeRowData | null =>
      keep(label, extra?.search) ? { id: startKey(start), label, highlight: matches(label, q), ...(extra?.secondary ? { secondary: extra.secondary } : {}) } : null;
    const rows = (list: (TreeRowData | null)[]) => list.filter((item): item is TreeRowData => !!item);
    const saved = ctx.presets.list().items;
    const groups: TreeGroupData[] = [
      { id: "saved", label: "Your saved expressions", rows: rows(saved.map(item => row({ kind: "saved", id: item.id }, item.name))) },
      { id: "natural", label: "Natural", secondary: "built in", rows: rows((preview?.samples ?? []).map(sample => row({ kind: "sample", id: sample.id }, sample.name, { search: sample.summary }))) },
    ];
    // The installed expressions by who provides them: the game first, then each mod in the order the table lists them.
    const providers = new Map<string, FacialStartPoint[]>();
    for (const point of startPoints.values()) providers.set(point.provider, [...(providers.get(point.provider) ?? []), point]);
    const order = [...providers.keys()].sort((a, b) => Number(b === "Base game") - Number(a === "Base game"));
    for (const provider of order) groups.push({ id: `provider:${provider}`, label: provider === "Base game" ? "The game" : provider,
      ...(provider === "Base game" ? {} : { secondary: "mod" }),
      rows: rows(providers.get(provider)!.map(point => row({ kind: "installed", id: point.id }, point.label, { search: point.clip }))) });
    return groups;
  }
  function paintStart() {
    const groups = startGroups();
    // A search shows every group with a match open; otherwise the person's own open groups.
    const expanded = startQuery ? new Set(groups.filter(group => group.rows.length).map(group => group.id)) : openStartGroups.of(groups.map(group => group.id));
    const points = preview?.startPoints;
    const loading = points?.phase === "preparing" ? "Reading the installed expressions…" : undefined;
    tree.update({ groups, expanded, current: currentStart(), loading });
  }
  function presetMenu(id: string, anchor: Element | { x: number; y: number }) {
    const preset = ctx.presets.list().items.find(item => item.id === id);
    if (!preset) return;
    const edit = ctx.facade.editable();
    const items: MenuItem[] = [
      { kind: "heading", label: preset.name },
      { kind: "action", label: "Start from it", icon: "play", capability: edit, run: () => begin(`saved:${id}`) },
      { kind: "action", label: "Rename…", icon: "rename", shortcut: "F2", capability: edit, run: () => renamePreset(id, anchor) },
      { kind: "separator" },
      { kind: "action", label: "Delete…", icon: "trash", shortcut: "Del", danger: true, capability: edit, run: () => deletePreset(id, anchor) },
    ];
    openMenu(items, anchor, { label: `${preset.name} actions` });
  }
  function faceMenu(anchor: Element) {
    const edit = ctx.facade.editable();
    openMenu([
      { kind: "action", label: "Mirror left onto right", icon: "mirror", capability: edit, run: () => ctx.dispatch({ kind: "expression.mirror", from: "left" } as ExpressionAction) },
      { kind: "action", label: "Mirror right onto left", icon: "mirror", capability: edit, run: () => ctx.dispatch({ kind: "expression.mirror", from: "right" } as ExpressionAction) },
      { kind: "action", label: "Flip face", icon: "mirror", capability: edit, run: () => ctx.dispatch({ kind: "expression.mirror", from: "flip" } as ExpressionAction) },
      // Decided but not built yet (coming-soon.ts): face handles and sculpting (phase 2 and later), export to the game (phase 3).
      { kind: "separator" },
      ...(["expressionHandles", "expressionSculpt", "expressionExport"] as const).map((id): MenuItem => ({ kind: "action", label: COMING_SOON[id].label,
        icon: id === "expressionExport" ? "export" : "handles", tag: "Soon", quietReason: true, capability: { available: false, reason: COMING_SOON[id].reason }, run: () => {} })),
    ], anchor, { label: "Face commands" });
  }
  function renamePreset(id: string, anchor: Element | { x: number; y: number }) {
    const preset = ctx.presets.list().items.find(item => item.id === id);
    if (!preset || !ctx.facade.editable().available) return;
    openValuePopover({ kind: "text", label: "Name", value: preset.name, maxLength: 120 }, anchor, {
      title: "Rename saved expression", apply: "Rename",
      validate: value => ctx.presets.capability({ kind: "partPreset.rename", id, name: String(value), revision: preset.revision }),
      commit: value => void ctx.presets.execute({ kind: "partPreset.rename", id, name: String(value).trim(), revision: preset.revision }).then(report),
    });
  }
  function deletePreset(id: string, anchor: Element | { x: number; y: number }) {
    const preset = ctx.presets.list().items.find(item => item.id === id);
    if (!preset || !ctx.facade.editable().available) return;
    openConfirmPopover(anchor, { title: "Delete saved expression", message: `Delete “${preset.name}” from your library? This can't be undone.`,
      confirm: "Delete", danger: true,
      onConfirm: () => void ctx.presets.execute({ kind: "partPreset.delete", id, revision: preset.revision }).then(outcome => {
        report(outcome); if (outcome.ok) ctx.feedback.announce(`Deleted “${preset.name}” from your library.`); }) });
  }
  function savePreset(anchor: Element) {
    const origin = current.origin, suggested = current.label ?? (origin?.kind === "preset" ? origin.name
      : origin?.kind === "installed" ? startPoints.get([...startPoints.values()].find(point => point.clip === origin.clip)?.id ?? "")?.label : undefined) ?? "My expression";
    openValuePopover({ kind: "text", label: "Name", value: suggested, maxLength: 120 }, anchor, {
      title: "Save expression", apply: "Save",
      validate: value => ctx.presets.capability({ kind: "partPreset.save", name: String(value) }),
      commit: value => {
        const name = String(value).trim();
        void ctx.presets.execute({ kind: "partPreset.save", name }).then(outcome => {
          if (outcome.ok) { openStartGroups.set("saved", true); ctx.feedback.announce(`Saved “${name}” to your library.`); } else report(outcome);
        });
      },
    });
  }
  function runNext() {
    const step = preview?.next;
    if (step === "game-setup") ctx.openSettings("game");
    else if (step === "guide") void ctx.links.open("project-knowledge");
    else if (step === "stop-idle") ctx.platform({ kind: "motion.setIdle", enabled: false });
    else if (step === "retry") ctx.facial.retry();
  }
  function filter() {
    const query = controlQuery;
    for (const entry of entries) entry.element.hidden = !!query && !entry.search.includes(query);
    let shown = 0;
    for (const group of groups) {
      const visible = group.entries.filter(entry => !entry.element.hidden).length;
      shown += visible;
      group.section.update({ set: setCount(group.entries), forceOpen: !!query && visible > 0, hidden: visible === 0, ...availability });
      if (group.mirror) {
        const on = group.keys.every(key => current.links[key] ?? true);
        group.mirror.setAttribute("aria-pressed", String(on));
        group.mirror.title = on ? `Mirror sides: ${group.title} — each pair follows the other. Press to set each side on its own.`
          : `Mirror sides: ${group.title} is off — each side is set on its own. Press to mirror them (the next change sets both).`;
        applyCapability(group.mirror, availability.disabled ? { available: false, reason: availability.reason } : { available: true });
      }
    }
    noControls.replaceChildren(...(query && entries.length && !shown ? [controlSearch.noMatches("controls")] : []));
  }
  const setCount = (list: readonly Entry[]) => list.reduce((sum, entry) => sum + entry.names.filter(name => (current.controls[name] ?? 0) > 0).length, 0);
  /** Every link key on this face: the pairs' and the paired axes'. */
  function allLinkKeys(): string[] {
    const keys = new Set<string>();
    for (const control of preview?.controls ?? []) if (control.link && !control.inert) keys.add(control.link.key);
    for (const axis of preview?.axes ?? []) for (const key of axis.link?.keys ?? []) keys.add(key);
    return [...keys];
  }
  function build(controls: readonly FacialControl[], axes: readonly FacialAxisControl[]) {
    const offered = controls.filter(control => !control.inert);
    const key = offered.map(control => control.name).join(",") + "|" + axes.map(axis => axis.key).join(",");
    if (key === built) return;
    built = key;
    const byName = new Map(offered.map(control => [control.name, control])), done = new Set<string>();
    // A confirmed opposing pair is one two-way control, placed where its first end sits; a left axis with a counterpart pairs with it.
    const axisOf = new Map<string, FacialAxisControl>(), byKey = new Map(axes.map(axis => [axis.key, axis]));
    for (const axis of axes) if (byName.has(axis.negative) && byName.has(axis.positive)) { axisOf.set(axis.negative, axis); axisOf.set(axis.positive, axis); }
    entries = [];
    for (const control of offered) {
      if (done.has(control.name)) continue;
      const axis = axisOf.get(control.name);
      if (axis) {
        const other = axis.link ? byKey.get(axis.link.counterpart) : undefined;
        for (const name of [axis.negative, axis.positive, ...(other ? [other.negative, other.positive] : [])]) done.add(name);
        if (other && axis.side === "left") entries.push(axisPairEntry(ctx, axis, other, control.group));
        else if (other && axis.side === "right") entries.push(axisPairEntry(ctx, other, axis, control.group));
        else entries.push(axisEntry(ctx, axis, control.group));
        continue;
      }
      done.add(control.name);
      const partner = control.partner ? byName.get(control.partner) : undefined;
      // A mirror pair is one entry (left first); a direction pair is two, each with its own direction word.
      if (partner && !control.direction && control.side === "left") { done.add(partner.name); entries.push(pairEntry(ctx, control, partner)); }
      else entries.push(singleEntry(ctx, control));
    }
    groups = (preview?.groups ?? []).map(group => {
      const own = entries.filter(entry => entry.group === group.id);
      // The region's mirror toggle, where it has left/right pairs: on, each pair follows its counterpart (skin as a mirror image, the
      // eyes looking the same way); off, each side is set on its own. One Undo step for the whole region.
      const keys = [...new Set(own.flatMap(entry => entry.links ?? []))];
      const mirror = keys.length ? iconButton({ label: `Mirror sides: ${group.label}`, icon: "mirror", small: true, mode: true, pressed: true,
        onClick: () => ctx.dispatch({ kind: "expression.setLinks", links: Object.fromEntries(keys.map(key => [key, mirror!.getAttribute("aria-pressed") !== "true"])) } as ExpressionAction) })
        : undefined;
      const section = new GroupSection({ title: group.label, key: `expressions.${group.id}`, expanded: group.id === "mouth" || group.id === "brows",
        className: "expr-group", level: "subsection", actions: mirror ? [mirror] : [], onReset: () => ctx.dispatch({ kind: "expression.reset", scope: "group", target: group.id } as ExpressionAction) });
      section.element.dataset.group = group.id;
      section.body.append(...own.map(entry => entry.element));
      return { id: group.id, title: group.label, section, entries: own, keys, mirror };
    }).filter(group => group.entries.length);
    groupsHost.replaceChildren(...groups.map(group => group.section.element));
  }
  /** A problem with the live preview, in plain words with its one next step; nothing while all is well (or while it only updates). */
  function statusText(snapshot: FacialPreviewSnapshot | undefined): { text: string; tone: "muted" | "warning" | "info"; next?: string } | undefined {
    if (!snapshot) return { text: "The live face preview isn't connected here.", tone: "muted" };
    const nextLabel = { "game-setup": "Open Settings", guide: "How live expressions work", "stop-idle": "Stop the idle", retry: "Try again" } as const;
    const label = snapshot.next ? nextLabel[snapshot.next] : undefined;
    // A limit of this version (its next step is the guide) is said calmly; something the person can fix is a warning.
    const tone = snapshot.next === "guide" ? "muted" : "warning";
    switch (snapshot.phase) {
      case "ready": return snapshot.reason ? { text: snapshot.reason, tone, next: label } : undefined;
      case "updating": case "idle": return undefined;
      case "preparing": return { text: snapshot.reason ?? "Preparing the live face preview…", tone: "info" };
      default: return { text: snapshot.reason ?? "The live face preview isn't available.", tone, next: label };
    }
  }
  function updatePresetsNote() {
    const list = ctx.presets.list();
    presetsNote.hidden = list.phase !== "failed";
    setText(presetsNote, list.phase === "failed" ? list.reason ?? "Saved expressions are unavailable right now." : "");
  }

  return {
    spec: { id: "expressions.controls", ...EXPRESSIONS_PANEL_META["expressions.controls"], element },
    update() {
      preview = ctx.facial.snapshot();
      current = part();
      const shown = statusText(preview);
      statusLine.hidden = !shown;
      setText(status, shown?.text ?? ""); status.className = `note ${shown?.tone ?? "muted"} expr-status`;
      next.hidden = !shown?.next; if (shown?.next) setText(next.querySelector("span") ?? next, shown.next);
      updating.element.classList.toggle("active", preview?.phase === "updating");
      setText(updatingText, preview?.phase === "updating" ? "Updating the face…" : "");
      const editable = ctx.facade.editable();
      availability = editable.available ? { disabled: false } : { disabled: true, reason: editable.reason };
      for (const control of [save, more, resetAll]) applyCapability(control, editable);
      startPoints = new Map((preview?.startPoints.items ?? []).map(point => [point.id, point]));
      paintStart(); updatePresetsNote();
      const controls = preview?.controls;
      if (controls?.length) build(controls, preview?.axes ?? []);
      const keys = allLinkKeys();
      // All mirrored: on; none: off; some regions mirrored and others not: mixed (a press mirrors them all).
      const mirrored = keys.filter(key => current.links[key] ?? true).length;
      const mixed = mirrored > 0 && mirrored < keys.length;
      symmetric.update(keys.length > 0 && mirrored === keys.length, { ...availability, mixed });
      symmetric.input.title = mixed ? "Some regions mirrored. Press to mirror them all."
        : "Each left/right pair follows the other: skin as a mirror image, the eyes looking the same way. Turn it off to set each side on its own.";
      waiting.hidden = !!controls?.length;
      setText(waiting, controls?.length ? "" : "Your V's face controls appear once your game files are read.");
      for (const entry of entries) entry.update(current, availability);
      filter();
      const latency = preview?.latency;
      setHelp(faceHelp, [`Every control of your V's own face rig, solved live on the 3D head with the game's face rig. Not yet compared with photo mode.${latency
        ? ` It updates in about ${Math.round(latency.median)} ms.` : ""}`, "Symmetric makes each left/right pair follow the other: skin as a mirror image, the eyes looking the same way."]);
    },
  };
}
