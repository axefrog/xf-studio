import { IDLES_ENDPOINT } from "../../animation/idle-endpoint";
import { DEFAULT_IDLE } from "../../animation/idle-catalogue";
import { IDLE_STATE_SCHEMA } from "../../animation/idle-body";
import { FACIAL_BLINK_ENDPOINT } from "../api/facial";
import type { CoreBody } from "../../character/render-detail";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** One-shot network reads, consumed by the ordinary motion loaders. Polls and later selections always read afresh. */
export function readMotionAhead(body: CoreBody, signal: AbortSignal, fetcher: Fetch = fetch): Fetch {
  const pending = new Map<string, Promise<Response>>();
  const consumed = new Set<string>();
  const start = (url: string) => {
    signal.throwIfAborted();
    const read = fetcher(url, { signal });
    void read.catch(() => {});
    pending.set(url, read);
    return read;
  };
  signal.addEventListener("abort", () => { pending.clear(); consumed.clear(); }, { once: true });
  start(FACIAL_BLINK_ENDPOINT);
  if (body === "female") void start(IDLES_ENDPOINT).then(async response => {
    // Only the host catalogue decides the first clip. No skeleton/Three allocation or polling starts before binding.
    const state = await response.clone().json();
    signal.throwIfAborted();
    if (!response.ok || state?.schema !== IDLE_STATE_SCHEMA || state.phase !== "ready" || state.source !== "game") return;
    const first = state.catalogue?.idles?.find((entry: { id: string }) => entry.id === DEFAULT_IDLE) ?? state.catalogue?.idles?.[0];
    if (typeof first?.id === "string") {
      const url = `${IDLES_ENDPOINT}?body=${encodeURIComponent(first.id)}`;
      if (!consumed.has(url)) start(url);
    }
  }).catch(() => { /* The ordinary loader reports missing/unreachable motion. */ });
  return (url, init) => {
    signal.throwIfAborted();
    consumed.add(url);
    const read = pending.get(url);
    pending.delete(url);
    return read ?? fetcher(url, { ...init, signal });
  };
}
