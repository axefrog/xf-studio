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
 *
 * A change of the V shown (`change: "shown"`, profiles phase 4a-v-b: a lighting setup made ready while the setup before stays drawn) says
 * so in the same place, in the same form ("Lighting: …").
 */
export function preparationLine(state: Pick<PreparationState, "stage" | "waiting" | "detail"> & { readonly change?: PreparationState["change"] },
  place: "pane" | "next"): string {
  if (state.change === "shown") return state.stage === "warm-up" ? LIGHTING.almost : LIGHTING.ready;
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
  core: "Next V: building the head…",
  build: "Next V: loading the head…",
  details: "Next V: hair and clothes…",
  programs: "Next V: readying the look…",
  textures: "Next V: loading textures…",
  "warm-up": "Next V: almost ready…",
} as const satisfies Record<PreparationState["stage"], string>;

/** A lighting setup made ready on the V shown: every stage but the last says the same (the bar says how far). */
const LIGHTING = { ready: "Lighting: getting ready…", almost: "Lighting: almost ready…" } as const;
/** Every line the status line can show while a lighting setup is made ready (for the width budget's test). */
export const LIGHTING_LINES: readonly string[] = Object.values(LIGHTING);

/** The longest `next` line, in characters: what fits on one line after the mark in the status line at a 300 px pane (about 180 px wide). */
export const NEXT_LINE_MAX_CHARS = 26;

/** How long a preparation runs before the status line says so: a warm V prepared again in a frame or two never flashes a line. */
export const PREPARATION_LINE_DELAY_MS = 150;
