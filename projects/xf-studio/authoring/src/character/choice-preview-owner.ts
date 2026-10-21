/**
 * One owner of a choice-preview device (its worker and the picture URLs it hands out), shared by every requester of a character
 * (creator-requester.ts): each requester draws through its own lease. A lease that ends stops only its own questions, lets go only of
 * the URLs it was given and of the live turn while it holds it; the device itself (its worker) ends only with its owner.
 */
import type { ChoicePreviewPort } from "./choice-preview-service";

export class ChoicePreviewOwner {
  private disposed = false;
  /** The lease whose live turn the worker draws now. */
  private live: object | null = null;

  constructor(private readonly device: ChoicePreviewPort) {}

  /** A port for one requester, ended by its `dispose`. */
  lease(): ChoicePreviewPort {
    const device = this.device, life = new AbortController(), urls = new Set<string>(), token = {};
    const ended = () => life.signal.aborted || this.disposed;
    const port: ChoicePreviewPort = {
      sources: (request, option, kind, positions, derive, signal) =>
        device.sources(request, option, kind, positions, derive, AbortSignal.any([signal, life.signal])),
      subject: body => device.subject(body),
      stored: key => device.stored(key),
      render: async (source, key, frames) => {
        const drawn = await device.render(source, key, frames);
        // A picture drawn after its lease ended is let go at once.
        if (ended()) device.release?.(drawn.url); else urls.add(drawn.url);
        return drawn;
      },
      release: url => { if (urls.delete(url)) device.release?.(url); },
      dispose: () => {
        if (life.signal.aborted) return;
        life.abort();
        for (const url of urls) device.release?.(url);
        urls.clear();
        if (this.live === token) { this.live = null; if (!this.disposed) device.live?.stop(); }
      },
    };
    const live = device.live;
    if (live) port.live = {
      start: source => { if (ended()) return Promise.reject(Error("The preview was closed.")); this.live = token; return live.start(source); },
      frame: (turn, measure) => live.frame(turn, measure),
      stop: () => { if (this.live === token) { this.live = null; live.stop(); } },
    };
    return port;
  }

  /** The owner is gone (its character's context): the device ends, every lease with it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.live = null;
    this.device.dispose?.();
  }
}
