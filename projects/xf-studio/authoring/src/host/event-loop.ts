/**
 * Letting the host's event loop breathe during long background work (research/backlog/performance.md, scheduling rule): the localhost
 * and desktop hosts answer every request (a person's change, a poll, a static file) on one thread, so background work that runs for
 * seconds without giving the loop a turn holds every answer back. Background loops call a slicer between units of work; it yields a
 * macrotask (`setImmediate`: pending I/O, such as a waiting request, runs first) once the current slice has used its budget.
 */
export const yieldToEventLoop = (): Promise<void> => new Promise(done => setImmediate(done));

/** How long background work runs before it lets the event loop answer what is waiting. */
export const BACKGROUND_SLICE_MS = 8;

/** A slicer: `await slice()` between units of work yields once `sliceMs` have passed since the last yield (cheap otherwise). */
export function timeSlicer(sliceMs = BACKGROUND_SLICE_MS, now: () => number = () => performance.now(),
  pause: () => Promise<void> = yieldToEventLoop): () => Promise<void> {
  let last = now();
  return async () => {
    if (now() - last < sliceMs) return;
    await pause();
    last = now();
  };
}
