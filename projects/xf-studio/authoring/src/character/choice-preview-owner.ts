/**
 * One owner of a choice-preview device (its worker and the picture URLs it hands out), shared by every requester of a character
 * (creator-requester.ts): each requester draws through its own lease. A lease that ends stops only its own questions, lets go only of
 * the URLs it was given and of the live turn while it holds it; the device itself (its worker) ends only with its owner. The worker draws
 * one live turn at a time: a frame is drawn only for the lease whose turn it is, and one that comes back after the turn moved on (to
 * another lease, or to another start of the same lease) is closed and refused, never shown as the wrong source.
 */
import { type ChoicePreviewPort, PreviewSuperseded } from "./choice-preview-service";

export class ChoicePreviewOwner {
  private disposed = false;
  /** The lease whose live turn the worker draws now, and the turn's number (raised by every start and stop). */
  private live: object | null = null;
  private turn = 0;

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
        if (this.live === token) { this.live = null; this.turn++; if (!this.disposed) device.live?.stop(); }
      },
    };
    const live = device.live;
    if (live) port.live = {
      start: source => {
        if (ended()) return Promise.reject(new PreviewSuperseded());
        this.live = token;
        this.turn++;
        return live.start(source);
      },
      frame: async (angle, measure) => {
        const turn = this.turn, mine = () => this.live === token && this.turn === turn && !ended();
        if (!mine()) throw new PreviewSuperseded();
        const drawn = await live.frame(angle, measure);
        if (!mine()) { drawn.bitmap?.close?.(); throw new PreviewSuperseded(); }
        return drawn;
      },
      stop: () => { if (this.live === token) { this.live = null; this.turn++; live.stop(); } },
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
