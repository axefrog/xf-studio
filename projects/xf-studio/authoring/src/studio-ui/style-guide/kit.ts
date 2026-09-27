import { iconMarkup, type IconName } from "../icons";
import { GUIDANCE } from "./guidance";

/** String builders for the self-contained style guide. Static specimens use the app's real classes. */
export const i = (name: IconName) => iconMarkup(name);
export const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export type Status = "implemented" | "future" | "rule";
export type Pattern = {
  id: string; title: string; status: Status; specimen?: string; wide?: boolean;
  what: string; when: string; combine?: string; adapt?: string; drives?: string; a11y?: string; avoid?: string;
};
const statusLabel: Record<Status, string> = { implemented: "Implemented", future: "Future direction · not built", rule: "Rule" };

export function pattern(input: Pattern) {
  const extra = GUIDANCE[input.id] ?? {};
  const p = { ...input, combine: input.combine ?? extra.combine, adapt: input.adapt ?? extra.adapt, drives: input.drives ?? extra.drives };
  const row = (label: string, value?: string) => value ? `<dt>${label}</dt><dd>${value}</dd>` : "";
  return `<article class="pattern${p.wide ? " wide" : ""}" id="${p.id}" data-status="${p.status}">
  <header class="pattern-head"><h3>${p.title}</h3><span class="status-tag ${p.status}">${statusLabel[p.status]}</span></header>
  ${p.specimen ? `<div class="specimen" data-compare>${p.specimen}</div>` : ""}
  <dl class="guidance">${row("What", p.what)}${row("When", p.when)}${row("Combine", p.combine)}${row("Adapt", p.adapt)}${row("Driven by", p.drives)}${row("Keyboard &amp; access", p.a11y)}${row("Avoid", p.avoid)}</dl>
</article>`;
}
export function section(id: string, number: string, title: string, intro: string, patterns: string[]) {
  return `<section class="guide-section" id="${id}" aria-labelledby="${id}-title">
  <header class="guide-section-head"><span class="section-number">${number}</span><h2 id="${id}-title">${title}</h2></header>
  <p class="section-intro">${intro}</p>
  <div class="patterns">${patterns.join("\n")}</div>
</section>`;
}
export const code = (text: string) => `<code>${esc(text)}</code>`;
/** A button; `unavailable` is the main-action pattern (UI-84): focusable, `aria-disabled`, its reason as its description. */
export const btn = (label: string, options: { icon?: IconName; variant?: string; small?: boolean; disabled?: boolean; unavailable?: string; iconOnly?: boolean; pressed?: boolean; title?: string } = {}) =>
  `<button type="button" class="btn${options.variant ? ` ${options.variant}` : ""}${options.small ? " small" : ""}${options.iconOnly ? " icon-only" : ""}"${options.disabled ? " disabled" : ""}${options.unavailable ? ` aria-disabled="true" data-reason="${esc(options.unavailable)}" aria-description="${esc(options.unavailable)}"` : ""}${options.pressed !== undefined ? ` aria-pressed="${options.pressed}"` : ""}${options.title ?? options.unavailable ? ` title="${esc((options.title ?? options.unavailable)!)}"` : ""}${options.iconOnly ? ` aria-label="${esc(label)}"` : ""}>${options.icon ? i(options.icon) : ""}${options.iconOnly ? "" : `<span>${label}</span>`}</button>`;
/** The visible reason of an unavailable main action, as the page's reason tip shows it (reason-tip.ts). */
export const reasonTip = (reason: string) => `<div class="reason-tip static-tip" role="tooltip" style="position:static">${esc(reason)}</div>`;
/** The shared expander (expander.ts), as a level's markup: the chevron, the label and an optional count. */
export const expander = (level: "group" | "section" | "subsection" | "row" | "maker", label: string, expanded: boolean, count?: string, extra = "") =>
  `<button type="button" class="expander${extra ? ` ${extra}` : ""}" data-level="${level}" aria-expanded="${expanded}"><span class="expander-chevron" aria-hidden="true">${i("chevronRight")}</span><span class="expander-label">${label}</span>${count ? `<span class="expander-count">${count}</span>` : ""}</button>`;
/** A help icon (help-tip.ts): what something is, in its tip; `open` also shows the tip beside it, as the page's one tip draws it. */
export const helpTip = (what: string, text: string, open = false) =>
  `<button type="button" class="help-tip" aria-label="About ${esc(what)}" aria-description="${esc(text)}" data-help="${esc(text)}">${i("help")}</button>${open ? `<div class="help-bubble" role="tooltip" style="position:static;margin-top:var(--sp-2)"><p>${esc(text)}</p></div>` : ""}`;
/** Expand all / Collapse all (expander.ts `ExpandAll`). */
export const expandAll = (what: string, expand = true) =>
  `<button type="button" class="icon-btn small expand-all" data-expand="${expand}" aria-label="${expand ? "Expand" : "Collapse"} everything in ${esc(what)}" title="${expand ? "Expand" : "Collapse"} everything in ${esc(what)}">${i("expandAll")}${i("collapseAll")}</button>`;
export const badge = (label: string, tone = "neutral") => `<span class="badge ${tone}">${label}</span>`;
export const chip = (label: string, tone = "") => `<span class="chip ${tone}">${label}</span>`;
export const eyebrow = (label: string) => `<h3 class="section-title">${label}</h3>`;
export const note = (text: string, tone = "muted") => `<p class="note ${tone}">${text}</p>`;
export const slider = (label: string, value: number, readout: string, options: { disabled?: boolean; note?: string } = {}) =>
  `<div class="control"><label class="control-label"><span>${label}</span><output class="readout">${readout}</output></label><input class="slider" type="range" min="0" max="1" step=".01" value="${value}" style="--fill:${value * 100}%"${options.disabled ? " disabled" : ""} aria-label="${esc(label)}">${options.note ? `<small class="control-note">${options.note}</small>` : ""}</div>`;
export const toggle = (label: string, checked: boolean, options: { disabled?: boolean; note?: string } = {}) =>
  `<div class="control toggle-row"><label class="toggle"><input type="checkbox" role="switch" class="switch"${checked ? " checked" : ""}${options.disabled ? " disabled" : ""}><span class="switch-track" aria-hidden="true"></span><span class="toggle-label">${label}</span></label>${options.note ? `<small class="control-note">${options.note}</small>` : ""}</div>`;
export const segmented = (label: string, options: string[], selected: number, disabled: number[] = []) =>
  `<div class="control compact"><span class="control-label"><span>${label}</span></span><div class="segmented" role="group" aria-label="${esc(label)}">${options.map((option, index) =>
    `<button type="button" class="segment" aria-pressed="${index === selected}"${disabled.includes(index) ? " disabled" : ""}><span>${option}</span></button>`).join("")}</div></div>`;
export const tab = (label: string, icon: IconName, active = false, hidden = false) =>
  `<button type="button" class="dock-tab" role="tab" aria-selected="${active}" aria-label="${esc(label)}" title="${esc(label)}"${hidden ? " hidden" : ""}>${i(icon)}<span class="dock-tab-label">${label}</span><span class="dock-tab-close" aria-hidden="true">${i("close")}</span></button>`;
/**
 * A tab group as the dock renders it: its panel header (tab strip at a condensing stage, drag area, actions) over its body. A collapsed
 * group folds along a column (a header row) unless `fold: "row"` makes it a full-height vertical strip.
 */
export function group(tabs: [string, IconName][], active: number, body: string,
  options: { stage?: "full" | "truncated" | "icons" | "overflow"; activeIcon?: boolean; shown?: number; floating?: boolean; focus?: boolean; collapsed?: boolean; fold?: "column" | "row"; style?: string } = {}) {
  const stage = options.stage ?? "full", shown = options.shown ?? tabs.length, hidden = tabs.length - shown;
  const vertical = options.collapsed && options.fold === "row", orientation = vertical ? "vertical" : "horizontal";
  const names = tabs.map(([label]) => label).join(", ");
  return `<section class="dock-group${options.floating ? " floating" : ""}${options.focus ? " focus-within" : ""}${options.collapsed ? " collapsed" : ""}"${options.collapsed ? ` data-fold="${vertical ? "row" : "column"}"` : ""}${options.style ? ` style="${options.style}"` : ""}>
    <div class="dock-tabbar panel-header" data-orientation="${orientation}"><div class="tab-strip${options.activeIcon ? " active-icon" : ""}" data-stage="${stage}" data-orientation="${orientation}"><div class="dock-tabs" role="tablist"${vertical ? ' aria-orientation="vertical"' : ""}>${tabs.map(([label, icon], index) => tab(label, icon, index === active, index >= shown && index !== active)).join("")}</div>${hidden > 0 ? `<button type="button" class="icon-btn tab-strip-more" aria-haspopup="menu" aria-label="${hidden} more tabs" title="${hidden} more tabs">${i(vertical ? "chevronDown" : "chevronRight")}</button>` : ""}</div>
    <div class="dock-tabbar-fill"></div><div class="panel-header-actions"><button type="button" class="icon-btn dock-collapse-btn" aria-expanded="${!options.collapsed}" aria-label="${options.collapsed ? "Expand" : "Collapse"} ${esc(names)}" title="${options.collapsed ? "Expand" : "Collapse (the tab bar stays)"}">${i(options.collapsed ? "chevronRight" : "chevronDown")}</button><button type="button" class="icon-btn dock-menu-btn" aria-haspopup="menu" aria-label="Layout options for ${esc(names)}" title="Layout options">${i("more")}</button></div></div>
    <div class="dock-body"${options.collapsed ? " hidden" : ""}>${body}</div></section>`;
}
export function row(name: string, meta: string, options: { selected?: boolean; hidden?: boolean; swatch?: string; finish?: string; eye?: boolean; warn?: boolean; edge?: boolean; preset?: boolean } = {}) {
  const lead = options.preset ? `<span class="item-lead"><span class="preset-mark"></span></span>` : options.swatch ? `<span class="item-lead"><button type="button" class="icon-btn small visibility" aria-pressed="${!options.hidden}">${i(options.hidden ? "eyeOff" : "eye")}</button><span class="swatch" style="--swatch:${options.swatch}" data-finish="${options.finish ?? "matte"}"></span></span>` : "";
  return `<li class="item-row${options.selected ? " selected" : ""}${options.hidden ? " hidden-layer" : ""}"><span class="item-grip">${i("grip")}</span>${lead}<button type="button" class="item-main"><span class="item-name">${name}</span><span class="item-meta">${meta}</span></button><span class="item-trailing">${options.warn ? `<span class="finish-flag" data-reason="export" title="Preview-study finish">${i("warning")}</span>` : options.edge ? `<span class="finish-flag" data-reason="edge" title="Cut off where the makeup area ends">${i("info")}</span>` : ""}${btn("More actions", { icon: "more", iconOnly: true, small: true, variant: "ghost" })}</span></li>`;
}
export function menu(items: string, style = "") { return `<div class="menu static-menu" role="menu"${style ? ` style="${style}"` : ""}>${items}</div>`; }
export function menuItem(label: string, options: { icon?: IconName; hint?: string; reason?: string; checked?: boolean; danger?: boolean; kbd?: string; sub?: boolean; focus?: boolean } = {}) {
  return `<div class="menu-item${options.danger ? " danger" : ""}${options.focus ? " demo-focus" : ""}" role="${options.checked !== undefined ? "menuitemcheckbox" : "menuitem"}"${options.reason ? ' aria-disabled="true"' : ""}${options.checked !== undefined ? ` aria-checked="${options.checked}"` : ""}>
    <span class="menu-icon">${options.checked ? i("check") : options.icon ? i(options.icon) : ""}</span>
    <span class="menu-text"><span class="menu-label">${label}</span>${options.reason ? `<small class="menu-reason">${options.reason}</small>` : options.hint ? `<small class="menu-hint">${options.hint}</small>` : ""}</span>
    ${options.kbd ? `<kbd>${options.kbd}</kbd>` : ""}${options.sub ? `<span class="menu-sub">${i("chevronRight")}</span>` : ""}</div>`;
}
export const menuHeading = (label: string, detail?: string) => `<div class="menu-heading"><span>${label}</span>${detail ? `<small>${detail}</small>` : ""}</div>`;
export const menuSep = `<div class="menu-sep"></div>`;
export const toast = (tone: string, source: string, message: string, actions: string[] = []) =>
  `<div class="toast ${tone} static-toast" role="status"><span class="toast-icon">${i(tone === "success" ? "check" : tone === "warning" ? "warning" : tone === "error" ? "error" : "info")}</span><div class="toast-body"><strong>${source}</strong><p>${message}</p>${actions.length ? `<div class="toast-actions">${actions.map(action => btn(action, { small: true })).join("")}</div>` : ""}</div><button type="button" class="icon-btn" aria-label="Dismiss">${i("close")}</button></div>`;
export const empty = (title: string, body: string, actions = "") => `<div class="empty"><p class="empty-title">${title}</p><p class="empty-body">${body}</p>${actions ? `<div class="empty-actions">${actions}</div>` : ""}</div>`;
