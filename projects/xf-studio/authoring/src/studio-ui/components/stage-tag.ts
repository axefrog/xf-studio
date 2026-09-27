import { h } from "../dom";

/**
 * Stage tag (style guide, Component library "Stage tag"): a module's or a feature's release stage in a word or two, wherever it is
 * listed or shown (the Modules menu, the Panels flyout, its panels' tabs, a switch), so an unfinished part is never mistaken for a
 * finished one. A stable part carries none. The word is "Early access", a word nothing else in the Studio uses ("preview" means the 3D
 * view); a tab, where room is short, shows its short form "Early" and keeps the whole word in its name and tooltip. Small outlined caps
 * in the signal colour: it tells, it doesn't warn, and it is never the "Soon" tag's muted grey (a planned entry, research tools only).
 */
export type Stage = "stable" | "preview" | "dev";

/** The words a stage shows, or nothing for a stable part. Anything not yet stable is early access. */
export function stageLabel(stage: Stage | undefined): string | undefined {
  return !stage || stage === "stable" ? undefined : "Early access";
}
/** The short form, for a tab: "Early". */
export function stageShortLabel(stage: Stage | undefined): string | undefined {
  return stageLabel(stage) && "Early";
}

/**
 * The tag for `stage`, or null for a stable part. Its text is the whole of its meaning, so it is read in place (no extra name). The
 * `short` form is a tab's, whose own name and tooltip say the whole word.
 */
export function stageTag(stage: Stage | undefined, className = "", short = false): HTMLElement | null {
  const label = short ? stageShortLabel(stage) : stageLabel(stage);
  return label ? h("span", { class: `stage-tag${className ? ` ${className}` : ""}`, "data-stage": stage!, text: label }) : null;
}
