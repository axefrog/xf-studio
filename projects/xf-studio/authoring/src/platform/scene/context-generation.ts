/**
 * A renderer's context generations (profiles phase 4a-v-b, experiments/043-scene-runtimes §11). A generation is the life of one WebGL
 * context: it ends when the context is lost, and the next begins when it is restored. GL objects made in one generation mean nothing in
 * the next, and neither does any record that the GPU holds something ready (a program linked, a map uploaded, a fence passed), since
 * Three drops its program cache and every texture's storage with the context.
 *
 * So anything that holds GL objects across frames, or records GPU readiness, is scoped to the generation it was made in:
 * - it keeps the generation's signal (`contextGeneration`) with the state, and treats the state as gone once that signal has aborted,
 *   never deleting a lost context's objects (they went with it) and never trusting a lost generation's record;
 * - any wait on such state runs under the signal too, so it ends with the generation (by abort, or a restart after the restore) instead
 *   of waiting for good.
 *
 * The renderer device ends and begins generations from its canvas's context events (renderer-device.ts); a context found lost before its
 * event arrives ends its generation at once. A renderer no device drives (a test's stand-in) keeps one generation unless the test ends it.
 */

type Contexted = { getContext?: () => { isContextLost?: () => boolean } | null | undefined };
const generations = new WeakMap<object, AbortController>();
const lostError = () => new DOMException("The WebGL context was lost.", "ContextLostError");
const contextLost = (renderer: object) => {
  const own = renderer as Contexted;
  return typeof own.getContext === "function" && own.getContext()?.isContextLost?.() === true;
};

/**
 * The signal of `renderer`'s context generation now: it aborts (a `ContextLostError`) when the context is lost, and is aborted already
 * while it is lost. State kept with it is valid while it hasn't aborted.
 */
export function contextGeneration(renderer: object): AbortSignal {
  let life = generations.get(renderer);
  if (!life) generations.set(renderer, life = new AbortController());
  // Lost, its event not told yet (the browser queues it): the generation ends now.
  if (!life.signal.aborted && contextLost(renderer)) life.abort(lostError());
  return life.signal;
}

/** The context was lost: its generation ends (the renderer device calls this on `webglcontextlost`). */
export function endContextGeneration(renderer: object, reason: unknown = lostError()): void {
  const life = generations.get(renderer);
  if (life) { if (!life.signal.aborted) life.abort(reason); }
  else { const ended = new AbortController(); ended.abort(reason); generations.set(renderer, ended); }
}

/** The context was restored: a new generation begins (the renderer device calls this on `webglcontextrestored`). */
export function beginContextGeneration(renderer: object): void {
  endContextGeneration(renderer);
  generations.set(renderer, new AbortController());
}
