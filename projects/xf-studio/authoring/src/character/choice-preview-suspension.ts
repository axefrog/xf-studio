/**
 * A V's choice-preview device that can be suspended (profiles phase 4a-iv, experiment 043 §10): the device (its worker and the worker's
 * WebGL context) exists only while it is used, and `suspend` ends it without ending the V's context. The scene runtime owner suspends the
 * devices of the Vs no resident head shows, so residency bounds preview workers and GPU contexts as it bounds heads, whatever character
 * state is kept. The next question after a suspension makes a new device, which loads the subject head it last had first.
 * DOM-free: the device itself comes from `make`.
 */
import { type ChoicePreviewPort, PreviewSuperseded } from "./choice-preview-service";

export type SuspendablePreviews = ChoicePreviewPort & {
  /** End the device now (its work in flight fails, as a stopped worker's does); the next question makes a new one. */
  suspend(): void;
  /** Whether a device is alive now. */
  readonly active: boolean;
};

export function suspendablePreviews(make: () => ChoicePreviewPort): SuspendablePreviews {
  let device: ChoicePreviewPort | null = null, loading: Promise<string> | null = null, disposed = false;
  /** The subject head last asked for: a new device loads it before anything else. */
  let subject: "female" | "male" | null = null;
  const current = () => {
    if (disposed) throw new PreviewSuperseded();
    if (!device) {
      const made = device = make();
      loading = subject ? made.subject(subject) : null;
    }
    return device;
  };
  /** A question for the device, once a new one has its subject head. */
  const ask = async <T>(question: (port: ChoicePreviewPort) => Promise<T>): Promise<T> => {
    const port = current();
    await loading?.catch(() => { /* The question that needs the head fails in its turn. */ });
    return question(port);
  };
  return {
    get active() { return !!device; },
    sources: (request, option, kind, positions, derive, signal) => ask(port => port.sources(request, option, kind, positions, derive, signal)),
    // A new device's first message is the subject head (`current`), so a subject asked of no device is that message.
    subject: body => { subject = body; if (!device) { current(); return loading!; } return device.subject(body); },
    stored: key => ask(port => port.stored(key)),
    render: (source, key, frames) => ask(port => port.render(source, key, frames)),
    // A URL of a device already ended was let go with it.
    release: url => device?.release?.(url),
    live: {
      start: source => ask(port => port.live ? port.live.start(source) : Promise.reject(Error("This device draws no live turn."))),
      frame: (turn, measure) => ask(port => port.live ? port.live.frame(turn, measure) : Promise.reject(Error("This device draws no live turn."))),
      stop: () => device?.live?.stop(),
    },
    suspend() { const ended = device; device = null; loading = null; ended?.dispose?.(); },
    dispose() { disposed = true; this.suspend(); },
  };
}
