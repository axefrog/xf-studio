import type { PreparationState } from "../app/viewport-attachment";

/**
 * The words for a scene runtime's preparation (profiles phase 4a-v; scene-residency.ts `PreparationState`), one plain line per stage. The
 * head pane says it in its loading state while nothing is shown yet (`pane`), and in its quiet status line while a V stays shown and the
 * next one is made ready (`next`). What a stage waits on picks the verb (the host preparing skin, hair and clothes, or the files being
 * read); the host's own line wins while it prepares a core head.
 */
export function preparationLine(state: Pick<PreparationState, "stage" | "waiting" | "detail">, place: "pane" | "next"): string {
  const words = place === "next" ? NEXT : PANE;
  if (state.stage === "core" && state.detail) return place === "next" ? `Next V: ${lowerFirst(state.detail)}` : state.detail;
  if (state.stage === "details") return state.waiting === "host" ? words.detailsHost : words.details;
  return words[state.stage];
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const PANE = {
  core: "Preparing the masculine head from your game files…",
  build: "Loading your V's head…",
  details: "Loading your V's skin, hair and clothes…",
  detailsHost: "Preparing your V's skin, hair and clothes…",
  programs: "Getting the lighting ready…",
  textures: "Loading textures…",
  "warm-up": "Almost ready…",
} as const;

const NEXT = {
  core: "Next V: preparing the masculine head from your game files…",
  build: "Next V: loading the head…",
  details: "Next V: loading skin, hair and clothes…",
  detailsHost: "Next V: preparing skin, hair and clothes…",
  programs: "Next V: getting the lighting ready…",
  textures: "Next V: loading textures…",
  "warm-up": "Next V: almost ready…",
} as const;

/** How long a preparation runs before the status line says so: a warm V prepared again in a frame or two never flashes a line. */
export const PREPARATION_LINE_DELAY_MS = 150;
