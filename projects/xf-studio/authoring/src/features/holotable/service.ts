/**
 * The Holotable module's application service (research/live-world-view/proposal.md §4): lists the recordings, opens one with the world
 * around it, and owns the replay's view state (the moment shown, playback, layers, content level, selection). Typed actions with
 * capabilities; no DOM, Three or network code. The data comes from the headless Holotable service through the device's transport.
 *
 * - **Content levels fail closed.** The service answers each session at the level asked for. Switching to `full` fetches the session
 *   again at that level; switching back drops the words with it.
 * - **Latest request wins.** Opening another recording, or changing level while one loads, aborts the request before it.
 * - **Playback** advances the moment on the device's timer while playing, and stops at the end or when the module is hidden.
 */
import { refusal, type Capability, type ReasonCode } from "../../platform/api";
import type { ContentLevel, HoloRun, HoloSession, HoloTransport, HoloWorld, HoloLiveState, HoloLiveCursor, HoloLiveUpdate } from "./types";

export const HOLO_LAYERS = ["v", "camera", "events", "gaps", "areas", "cells", "solids"] as const;
export type HoloLayer = typeof HOLO_LAYERS[number];

export type HoloAction =
  | { kind: "holo.refresh" }
  | { kind: "holo.open"; dir: string }
  | { kind: "holo.watch" }
  | { kind: "holo.follow" }
  | { kind: "holo.seek"; t: number }
  | { kind: "holo.play"; on: boolean }
  | { kind: "holo.layer"; id: HoloLayer; on: boolean }
  | { kind: "holo.level"; level: ContentLevel }
  | { kind: "holo.select"; id: string | null };
export type HoloOutcome = { ok: true } | { ok: false; code: ReasonCode; message: string };

export type HoloPhase = "idle" | "listing" | "ready" | "opening" | "unavailable" | "failed";
export interface HoloState {
  readonly phase: HoloPhase;
  /** Plain words for anything but ready. */
  readonly message: string;
  readonly runs: readonly HoloRun[];
  readonly open: { readonly dir: string; readonly session: HoloSession; readonly world: HoloWorld } | null;
  /** The moment shown, in the recording's own seconds (QPC source time). */
  readonly t: number;
  readonly playing: boolean;
  readonly level: ContentLevel;
  readonly layers: Readonly<Record<HoloLayer, boolean>>;
  /** "v", or an event's id. */
  readonly selected: string | null;
  readonly revision: number;
  readonly live: HoloLiveState;
}

export interface HoloDevice {
  readonly transport: HoloTransport | null;
  /** Calls `tick` about every `ms` until the returned function is called (a test seam; default: a timer). */
  readonly every?: (ms: number, tick: () => void) => () => void;
  /** A one-shot timer for status and live updates; cancelled whenever the module is hidden. */
  readonly later?: (ms: number, tick: () => void) => () => void;
}

const STEP_MS = 50;
const SPEED = 4; // a quarter-hour session plays in under four minutes

export function createHolotable(device: HoloDevice, signal: AbortSignal) {
  let state: HoloState = { phase: "idle", message: "", runs: [], open: null, t: 0, playing: false, level: "structure",
    layers: { v: true, camera: true, events: true, gaps: true, areas: true, cells: false, solids: true }, selected: null, revision: 0,
    live: { available: false, recording: false, watching: false, following: false, phase: "idle", behindS: 0, more: false, droppedBatches: 0, message: "" } };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<HoloState>) => { state = { ...state, ...patch, revision: state.revision + 1 }; for (const l of listeners) l(); };
  let loading: AbortController | null = null;
  let stopTimer: (() => void) | null = null;
  const every = device.every ?? ((ms: number, tick: () => void) => { const id = setInterval(tick, ms); return () => clearInterval(id); });
  const later = device.later ?? ((ms: number, tick: () => void) => { const id = setTimeout(tick, ms); return () => clearTimeout(id); });
  let visible = false, stopLiveTimer: (() => void) | null = null, stopStatusTimer: (() => void) | null = null;
  let liveCtl: AbortController | null = null, statusCtl: AbortController | null = null;
  let watchId: string | null = null, liveSince: HoloLiveCursor | undefined, worldSince = -1;
  let resumeWatch = false;

  const call = async <T>(method: string, params: Record<string, unknown>, cancel: AbortSignal): Promise<T> => {
    if (!device.transport) throw Object.assign(new Error("Holotable isn't available in this copy of XF Studio."), { code: "unavailable" });
    const answer = await device.transport(method, params, cancel);
    const data = answer.data as { ok?: boolean; result?: T; error?: { code?: string; message?: string } };
    if (!answer.ok || !data?.ok) throw Object.assign(new Error(data?.error?.message ?? `The Holotable service answered ${answer.status}.`), { code: answer.status === 404 ? "unavailable" : data?.error?.code ?? "failed" });
    return data.result as T;
  };
  // Listing and opening are separate requests: a refresh never cancels an open in flight. Each supersedes only its own kind.
  let listing: AbortController | null = null;
  /** The level the open in flight was asked for (null: none in flight). A newer request for the committed level supersedes it. */
  let pendingLevel: ContentLevel | null = null;
  const fresh = () => { loading?.abort(); loading = new AbortController(); return loading.signal; };
  const freshList = () => { listing?.abort(); listing = new AbortController(); return listing.signal; };
  signal.addEventListener("abort", () => { loading?.abort(); listing?.abort(); }, { once: true });
  const failed = (e: unknown, cancel: AbortSignal) => {
    if (cancel.aborted || signal.aborted) return;
    const code = (e as { code?: string })?.code;
    set({ phase: code === "unavailable" ? "unavailable" : "failed", message: String((e as Error)?.message ?? e) });
  };

  async function liveStatus() {
    if (!visible || !device.transport || signal.aborted) return;
    statusCtl?.abort(); const cancel = new AbortController(); statusCtl = cancel;
    try {
      const live = await call<Omit<HoloLiveState, "following">>("live.status", {}, cancel.signal);
      if (!cancel.signal.aborted && visible) set({ live: { ...state.live, available: live.available === true, recording: live.recording === true } });
    } catch { if (!cancel.signal.aborted && visible) set({ live: { ...state.live, available: false, recording: false } }); }
    finally { if (visible && !signal.aborted && !cancel.signal.aborted) stopStatusTimer = later(5000, () => { void liveStatus(); }); }
  }
  function stopWatching(clear = true, keepCursor = false) {
    liveCtl?.abort(); liveCtl = null; stopLiveTimer?.(); stopLiveTimer = null;
    const id = watchId; watchId = null;
    if (!keepCursor) { liveSince = undefined; worldSince = -1; }
    if (id && !signal.aborted) void call("live.stop", { watch: id }, signal).catch(() => {});
    if (clear) set({ live: { ...state.live, watching: false, following: false }, playing: false });
  }
  const emptyWorld = (): HoloWorld => ({ provenance: null, areas: [], cells: [] });
  async function takeLive(cancel: AbortSignal) {
    const id = watchId;
    let recovering = false;
    if (!id || cancel.aborted || !visible) return;
    try {
      // Drain at most four bounded service updates per tick; this never causes an extra bridge read.
      for (let i = 0; i < 4; i++) {
        const update = await call<HoloLiveUpdate>("live.poll", { watch: id, since: liveSince, level: state.level }, cancel);
        if (cancel.aborted || watchId !== id || !visible) return;
        liveSince = update.since;
        const old = update.reset ? null : state.open?.session;
        const session: HoloSession | null = update.meta ? { meta: update.meta,
          v: [...(old?.v ?? []), ...update.v], camera: [...(old?.camera ?? []), ...update.camera],
          events: [...(old?.events ?? []), ...update.events], gaps: [...(old?.gaps ?? []), ...update.gaps] } : null;
        const following = state.live.following;
        const t = following && session ? session.v.at(-1)?.t ?? session.meta.from : state.t;
        const behindS = update.state.behindS + (session?.v.length ? Math.max(0, session.meta.to - session.v.at(-1)!.t) : 0);
        set({ live: { ...update.state, following, behindS }, ...(session ? { open: { dir: "live", session, world: update.reset ? emptyWorld() : state.open?.world ?? emptyWorld() }, phase: "ready", t } : {}),
          message: update.state.message || (!session?.v.length ? "Waiting for recorder samples…" : "") });
        if (!update.more) break;
      }
      const geometry = await call<{ version: number; world: HoloWorld | null; pending: boolean; cold: boolean }>("world.around", { watch: id, since: worldSince }, cancel);
      if (cancel.aborted || watchId !== id) return;
      worldSince = geometry.version;
      if (geometry.world && state.open?.dir === "live") set({ open: { ...state.open, world: geometry.world } });
      if (geometry.cold && !state.live.message) set({ message: "Reading the city around this recording from the game files… This happens once." });
    } catch (e) {
      if (!cancel.aborted && visible) {
        set({ live: { ...state.live, phase: "disconnected" }, message: "The game stopped sending. Showing what arrived; Holotable reconnects when the game is back." });
        if ((e as { code?: string }).code === "bad_request" || (e as { code?: string }).code === "exited") {
          recovering = true;
          liveSince = undefined; worldSince = -1;
          stopLiveTimer = later(5000, () => { if (visible && !cancel.aborted) void watch(true); });
          return;
        }
      }
    } finally {
      if (!recovering && !cancel.aborted && visible && watchId === id) stopLiveTimer = later(1000, () => { void takeLive(cancel); });
    }
  }
  async function watch(keep = false) {
    stopWatching(false, keep); loading?.abort(); pendingLevel = null; pause();
    liveCtl = new AbortController(); const cancel = liveCtl.signal;
    set({ live: { ...state.live, watching: true, following: true }, playing: true, open: keep ? state.open : null, phase: "ready", message: "Waiting for recorder samples…", selected: null });
    try {
      // A late watch response is stopped explicitly even after the view has been hidden.
      const result = await call<{ watch: string }>("live.watch", {}, signal);
      if (cancel.aborted || !visible) { void call("live.stop", result, signal).catch(() => {}); return; }
      watchId = result.watch;
      await takeLive(cancel);
    } catch (e) { failed(e, cancel); }
  }

  async function refresh() {
    const cancel = freshList();
    set({ phase: state.open || state.live.watching ? state.phase : "listing", message: state.live.watching ? state.message : "Looking for recordings…" });
    try {
      const runs = await call<HoloRun[]>("runs.list", {}, cancel);
      if (cancel.aborted) return;
      set({ runs, phase: state.open || state.live.watching ? "ready" : "idle", message: state.live.watching ? state.message : runs.length ? "" : "No recordings yet. A test session with the recorder on leaves one here." });
    } catch (e) { failed(e, cancel); }
  }
  async function open(dir: string, level: ContentLevel, keepTime: boolean) {
    stopWatching();
    const cancel = fresh();
    pendingLevel = level;
    pause();
    set({ phase: "opening", message: "Opening the recording…" });
    try {
      const [session, status] = await Promise.all([call<HoloSession>("session.open", { dir, level }, cancel), call<{ cold: boolean }>("world.status", { dir }, cancel)]);
      if (cancel.aborted) return;
      if (status.cold) set({ message: "Reading the city around this recording from the game files… This happens once." });
      const world = await call<HoloWorld>("world.around", { dir }, cancel);
      if (cancel.aborted) return;
      pendingLevel = null;
      const t = keepTime && state.open?.dir === dir ? state.t : session.meta.from;
      set({ open: { dir, session, world }, phase: "ready", message: "", t, level, selected: keepTime ? state.selected : null });
    } catch (e) { if (!cancel.aborted) pendingLevel = null; failed(e, cancel); }
  }
  /** Asking again for the level already shown cancels a switch still loading, so a late answer can never show what was taken back. */
  function setLevel(level: ContentLevel) {
    if (state.open?.dir === "live") {
      // Refetch bounded deltas at the requested disclosure level; clear words immediately when hiding them.
      if (level === state.level) return;
      set({ level, open: { ...state.open, session: { ...state.open.session, events: [] } } });
      if (liveSince) liveSince = { ...liveSince, events: 0 };
      if (watchId && visible) {
        liveCtl?.abort(); stopLiveTimer?.(); liveCtl = new AbortController(); void takeLive(liveCtl.signal);
      }
      return;
    }
    if (level !== state.level) return open(state.open!.dir, level, true);
    if (pendingLevel !== null && pendingLevel !== level) { loading?.abort(); loading = null; pendingLevel = null; set({ phase: "ready", message: "" }); }
  }
  function pause() { stopTimer?.(); stopTimer = null; if (state.playing) set({ playing: false }); }
  function play() {
    const s = state.open?.session; if (!s || stopTimer) return; // one timer, however often Play is asked
    if (state.t >= s.meta.to) set({ t: s.meta.from });
    set({ playing: true });
    stopTimer = every(STEP_MS, () => {
      const end = state.open?.session.meta.to ?? 0, next = Math.min(end, state.t + SPEED * STEP_MS / 1000);
      set({ t: next });
      if (next >= end) pause();
    });
  }
  signal.addEventListener("abort", () => { visible = false; stopWatching(false); statusCtl?.abort(); stopStatusTimer?.(); pause(); listeners.clear(); }, { once: true });

  function capability(action: HoloAction): Capability {
    switch (action.kind) {
      case "holo.refresh": return device.transport ? { available: true } : refusal("unavailable", "Holotable isn't available in this copy of XF Studio.");
      case "holo.open": return state.runs.some(r => r.dir === action.dir) ? { available: true } : refusal("missing_target", "That recording isn't in the list any more.");
      case "holo.watch": return state.live.available && state.live.recording ? { available: true } : refusal("not_ready", "The recorder is off. It runs during XF test sessions.");
      case "holo.follow": return state.live.watching ? { available: true } : refusal("not_ready", "Watch the live game first.");
      case "holo.seek": case "holo.play": case "holo.select": return state.open ? { available: true } : refusal("not_ready", "Open a recording first.");
      case "holo.layer": return HOLO_LAYERS.includes(action.id) ? { available: true } : refusal("invalid_value", "Unknown layer.");
      case "holo.level": return state.open ? { available: true } : refusal("not_ready", "Open a recording first.");
    }
  }
  async function dispatch(action: HoloAction): Promise<HoloOutcome> {
    const cap = capability(action);
    if (!cap.available) return { ok: false, code: cap.code ?? "unavailable", message: cap.reason ?? "" };
    switch (action.kind) {
      case "holo.refresh": await refresh(); break;
      case "holo.open": await open(action.dir, state.level, false); break;
      case "holo.watch": await watch(); break;
      case "holo.follow": {
        pause(); set({ live: { ...state.live, following: true }, playing: true, t: state.open?.session.v.at(-1)?.t ?? state.t }); break;
      }
      case "holo.seek": {
        pause();
        if (state.live.watching) set({ live: { ...state.live, following: false } });
        const m = state.open!.session.meta;
        set({ t: Math.max(m.from, Math.min(m.to, action.t)) });
        break;
      }
      case "holo.play":
        if (state.live.following) set({ live: { ...state.live, following: false }, playing: false });
        if (action.on) play(); else pause(); break;
      case "holo.layer": set({ layers: { ...state.layers, [action.id]: action.on } }); break;
      case "holo.level": await setLevel(action.level); break;
      case "holo.select": set({ selected: action.id }); break;
    }
    return { ok: true };
  }
  return {
    capability,
    dispatch,
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The module was hidden: playback stops (nothing runs for a view no one sees). */
    withdraw() { resumeWatch = state.live.watching; visible = false; stopStatusTimer?.(); statusCtl?.abort(); pause(); stopWatching(true, resumeWatch); },
    /** The module was shown: list the recordings once, on demand (nothing is asked of the host before the view is wanted). */
    shown() {
      if (visible || signal.aborted) return; visible = true;
      if (state.phase === "idle" && !state.runs.length && device.transport) void refresh();
      void liveStatus();
      if (resumeWatch) { resumeWatch = false; void watch(true); }
    },
  };
}
export type HolotableService = ReturnType<typeof createHolotable>;
