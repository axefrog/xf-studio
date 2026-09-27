import { h } from "../dom";

/**
 * Stage tag (style guide, Component library "Stage tag"): a module's or a feature's release stage in one word, wherever it is listed
 * or shown (the Modules menu, the Panels flyout, its panels' tabs, a switch), so a preview is never mistaken for a finished part of the
 * Studio. A stable part carries none. Small outlined caps in the signal colour: it tells, it doesn't warn, and it is never the
 * "Soon" tag's muted grey (a planned entry, research tools only).
 */
export type Stage = "stable" | "preview" | "dev";

/** The word a stage shows, or nothing for a stable part. Anything not yet stable reads "Preview". */
export function stageLabel(stage: Stage | undefined): string | undefined {
  return !stage || stage === "stable" ? undefined : "Preview";
}

/** The tag for `stage`, or null for a stable part. Its text is the whole of its meaning, so it is read in place (no extra name). */
export function stageTag(stage: Stage | undefined, className = ""): HTMLElement | null {
  const label = stageLabel(stage);
  return label ? h("span", { class: `stage-tag${className ? ` ${className}` : ""}`, "data-stage": stage!, text: label }) : null;
}
