import type { PreparationState } from "../app/viewport-attachment";

/**
 * The words for a scene runtime's preparation (profiles phase 4a-v; scene-residency.ts `PreparationState`), one plain line per stage. The
 * head pane says it in its loading state while nothing is shown yet (`pane`), and in its quiet status line while a V stays shown and the
 * next one is made ready (`next`). Both places show a progress bar, so neither carries a step count (the bar says how far). What a stage
 * waits on picks the verb in the pane (the host preparing skin, hair and clothes, or the files being read); the host's own line wins in
 * the pane while it prepares a core head.
 *
 * Every `next` line fits one line at the status line's narrowest width (`NEXT_LINE_MAX_CHARS`), so its box keeps one height across the
 * stages and a sentence is never cut.
 */
export function preparationLine(state: Pick<PreparationState, "stage" | "waiting" | "detail">, place: "pane" | "next"): string {
  if (place === "next") return NEXT[state.stage];
  if (state.stage === "core" && state.detail) return withoutStepCount(state.detail);
  if (state.stage === "details") return state.waiting === "host" ? PANE.detailsHost : PANE.details;
  return PANE[state.stage];
}

/** The host's "(step n of m)" counts its own steps, which a bar for the whole preparation would contradict, so a line beside a bar never shows it. */
const withoutStepCount = (text: string) => text.replace(/\s*\((?:step|steps)\s+\d+\s+of\s+\d+\)/gi, "").trim();

const PANE = {
  core: "Preparing the masculine V's head from your Cyberpunk 2077 files…",
  build: "Loading your V's head…",
  details: "Loading your V's skin, hair and clothes…",
  detailsHost: "Preparing your V's skin, hair and clothes…",
  programs: "Getting the look ready…",
  textures: "Loading textures…",
  "warm-up": "Almost ready…",
} as const;

const NEXT = {
  core: "Next V: making its head…",
  build: "Next V: loading the head…",
  details: "Next V: hair and clothes…",
  programs: "Next V: readying the look…",
  textures: "Next V: loading textures…",
  "warm-up": "Next V: almost ready…",
} as const satisfies Record<PreparationState["stage"], string>;

/** The longest `next` line, in characters: what fits on one line after the mark in the status line at a 300 px pane (about 180 px wide). */
export const NEXT_LINE_MAX_CHARS = 26;

/** How long a preparation runs before the status line says so: a warm V prepared again in a frame or two never flashes a line. */
export const PREPARATION_LINE_DELAY_MS = 150;
/** Once the line has appeared it stays at least this long, so a preparation that ends right after it showed never reads as a flash. */
export const PREPARATION_LINE_MIN_VISIBLE_MS = 300;

/**
 * When the quiet status line shows the next V's preparation: while it is wanted, and for a short minimum once it has appeared (a held line
 * is the last one shown). `reset()` drops it at once (the pane is no longer showing a V). Times are the caller's clock, so the rule is testable.
 */
export class PreparationLineGate {
  private since: number | null = null;
  /** `wanted`: the preparation has run long enough to be worth a line. `holdMs`: how long a held line must still stay, else null. */
  step(now: number, wanted: boolean): { show: boolean; holdMs: number | null } {
    if (wanted) { this.since ??= now; return { show: true, holdMs: null }; }
    if (this.since === null) return { show: false, holdMs: null };
    const left = PREPARATION_LINE_MIN_VISIBLE_MS - (now - this.since);
    if (left > 0) return { show: true, holdMs: left };
    this.since = null;
    return { show: false, holdMs: null };
  }
  reset() { this.since = null; }
}
