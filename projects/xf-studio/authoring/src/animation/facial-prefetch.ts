/**
 * When the page reads the installed expressions ahead of the Expressions view (PREV-179 follow-up, the responsive-UX policy): once V is drawn
 * with nothing being prepared and the idle's face has settled, and the page has stayed that way for `QUIET_MS`, the facial preview asks the
 * host to read them at background priority (`FacialPreview.prefetch`). The person's own actions go first: the host decodes the prefetch's
 * clips behind every other request, and anything that starts preparing again restarts the wait. Opening the drawer meanwhile joins the
 * same read on the host. No Three, DOM or network here: the page's services are passed in.
 */
import { IDLE_FACE_PREPARING } from "./game-blink-messages";

/** How long the page must stay quiet before the prefetch starts. */
export const QUIET_MS = 2_000;

/** What the page watches: whether it is quiet now, and a way to hear that it may have changed (returns the unsubscribe). */
export type QuietWatch = { quiet(): boolean; subscribe(listener: () => void): () => void };
export type QuietTimer = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
const TIMER: QuietTimer = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** Run `prefetch` once, after the page has been quiet for `quietMs`; returns the release (stops watching). */
export function prefetchWhenQuiet(prefetch: () => void, watch: QuietWatch, options: { quietMs?: number; timer?: QuietTimer } = {}): () => void {
  const timer = options.timer ?? TIMER, quietMs = options.quietMs ?? QUIET_MS;
  let pending: unknown = null, done = false;
  const stop = () => { if (pending !== null) timer.clear(pending); pending = null; };
  const check = () => {
    if (done) return;
    if (!watch.quiet()) { stop(); return; }
    if (pending !== null) return;
    pending = timer.set(() => {
      pending = null;
      if (done || !watch.quiet()) return;
      done = true; release();
      prefetch();
    }, quietMs);
  };
  const unsubscribe = watch.subscribe(check);
  const release = () => { done = true; stop(); unsubscribe(); };
  check();
  return release;
}

/**
 * The head's quiet: V's details neither preparing nor updating, and the idle's face not still being read (the Motion panel's reason while
 * it is, `IDLE_FACE_PREPARING`).
 */
export function headQuiet(head: {
  details: { snapshot(): { phase: string; updating: boolean }; subscribe(listener: () => void): () => void };
  scene: { readonly evidence: { readonly idle: { readonly faceError: string } }; onIdleFaceChange(listener: () => void): () => void };
}): QuietWatch {
  return {
    quiet: () => {
      const details = head.details.snapshot();
      return details.phase !== "preparing" && !details.updating && head.scene.evidence.idle.faceError !== IDLE_FACE_PREPARING;
    },
    subscribe: listener => { const a = head.details.subscribe(listener), b = head.scene.onIdleFaceChange(listener); return () => { a(); b(); }; },
  };
}
