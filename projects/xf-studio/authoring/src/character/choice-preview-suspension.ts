/**
 * A V's choice-preview device under the scene runtime owner's budget (profiles phase 4a-iv, experiment 043 §10). The device (its worker
 * and the worker's WebGL context) exists only while the owner admits the V (a resident head shows it) and a question wants it. Admission
 * withdrawn ends the device without ending the V's context.
 *
 * - **Questions wait for admission.** A question asked while the V isn't admitted (a requester of a V no resident head shows) makes no
 *   device: it waits, and runs once the owner admits the V again, so devices never outnumber the residency budget. Every wait is tied to
 *   a lifetime: its requester's (the signal each requester's lease passes, choice-preview-owner.ts), the live turn's for a live question
 *   (a newer start or `stop` ends it), and the wrapper's own. Whichever ends first refuses the question and lets go of it.
 * - **A new device is given back what the old one held** before it answers anything: the subject head, then the live turn's source. A
 *   question whose device was ended under it is asked again of the next one, so a suspension fails no work, and a live turn its service
 *   still holds keeps drawing.
 *
 * DOM-free: the device itself comes from `make`.
 */
import { type ChoicePreviewPort, PreviewSuperseded } from "./choice-preview-service";
import type { ChoicePreviewSource } from "./choice-preview";

export type SuspendablePreviews = ChoicePreviewPort & {
  /** The owner's decision: whether this V may have a device now. False ends the device; true lets the waiting questions run. */
  admit(admitted: boolean): void;
  /** Whether a device is alive now. */
  readonly active: boolean;
  /** How many questions wait for admission now (evidence). */
  readonly waiting: number;
  /** The V's context is gone: the device ends, and every waiting question is refused. */
  dispose(): void;
};

const NO_LIVE = () => Promise.reject(Error("This device draws no live turn."));

export function suspendablePreviews(make: () => ChoicePreviewPort): SuspendablePreviews {
  let device: ChoicePreviewPort | null = null, admitted = false, disposed = false;
  /** The subject head last asked for, and the device that loaded it (with its answer). */
  let subject: "female" | "male" | null = null;
  let head: { on: ChoicePreviewPort; body: "female" | "male"; identity: Promise<string> } | null = null;
  /** The live turn wanted now (its source), the device it was uploaded to (with that upload), and its lifetime (ended by a newer start or `stop`). */
  let live: { source: ChoicePreviewSource; on: ChoicePreviewPort | null; upload: Promise<void>; turn: AbortController } | null = null;
  const waiting = new Set<() => void>();
  const wake = () => { for (const resume of [...waiting]) resume(); };

  /** The subject head on `on`, loaded once per device and body (one that couldn't load is asked again next time). */
  function headOn(on: ChoicePreviewPort): Promise<string> {
    if (!subject) return Promise.resolve("");
    if (head?.on !== on || head.body !== subject) {
      const entry = head = { on, body: subject, identity: on.subject(subject) };
      entry.identity.catch(() => { if (head === entry) head = null; });
    }
    return head.identity;
  }
  /** The live turn's source on `on`, uploaded once per device. */
  function liveOn(on: ChoicePreviewPort): Promise<void> {
    if (!live) return Promise.resolve();
    if (live.on !== on) { live.on = on; live.upload = on.live ? on.live.start(live.source) : NO_LIVE(); }
    return live.upload;
  }
  /** The device, once the V is admitted: made on first use, with its subject head loaded before anything else. */
  async function admittedDevice(signal?: AbortSignal): Promise<ChoicePreviewPort> {
    while (!disposed && !admitted) {
      signal?.throwIfAborted();
      await new Promise<void>(resume => {
        const done = () => { waiting.delete(done); signal?.removeEventListener("abort", done); resume(); };
        waiting.add(done);
        signal?.addEventListener("abort", done, { once: true });
      });
    }
    if (disposed) throw new PreviewSuperseded();
    signal?.throwIfAborted();
    const on = device ??= make();
    await headOn(on).catch(() => { /* The question that needs the head fails in its turn. */ });
    return on;
  }
  /** Ask the admitted device; a question whose device was ended under it is asked again of the next one. */
  async function ask<T>(question: (on: ChoicePreviewPort) => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (;;) {
      const on = await admittedDevice(signal);
      try { return await question(on); }
      catch (error) { if (disposed || device === on || signal?.aborted) throw error; }
    }
  }
  /** The live turn ends: every question still waiting for it is refused. */
  function endTurn() {
    const ended = live;
    live = null;
    ended?.turn.abort(new PreviewSuperseded());
  }
  const within = (signal: AbortSignal | undefined, turn: AbortSignal) => signal ? AbortSignal.any([signal, turn]) : turn;
  function end() {
    const ended = device;
    device = null; head = null;
    if (live) live.on = null;
    ended?.dispose?.();
  }

  return {
    get active() { return !!device; },
    get waiting() { return waiting.size; },
    admit(on) {
      if (disposed || on === admitted) return;
      admitted = on;
      if (on) wake(); else end();
    },
    sources: (request, option, kind, positions, derive, signal) => ask(on => on.sources(request, option, kind, positions, derive, signal), signal),
    subject: (body, signal) => { subject = body; return ask(on => headOn(on), signal); },
    stored: (key, signal) => ask(on => on.stored(key), signal),
    render: (source, key, frames, signal) => ask(on => on.render(source, key, frames), signal),
    // A URL of a device already ended was let go with it.
    release: url => device?.release?.(url),
    live: {
      start: (source, signal) => {
        endTurn();
        const wanted = live = { source, on: null, upload: Promise.resolve(), turn: new AbortController() };
        return ask(on => liveOn(on), within(signal, wanted.turn.signal));
      },
      frame: (angle, measure, signal) => {
        const current = live;
        if (!current) return Promise.reject(new PreviewSuperseded());
        return ask(async on => { await liveOn(on); return on.live ? on.live.frame(angle, measure) : NO_LIVE(); }, within(signal, current.turn.signal));
      },
      stop: () => { endTurn(); device?.live?.stop(); },
    },
    dispose() { disposed = true; endTurn(); end(); wake(); },
  };
}
