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
import type { ContentLevel, HoloRun, HoloSession, HoloTransport, HoloWorld } from "./types";

export const HOLO_LAYERS = ["v", "camera", "events", "gaps", "areas", "cells"] as const;
export type HoloLayer = typeof HOLO_LAYERS[number];

export type HoloAction =
  | { kind: "holo.refresh" }
  | { kind: "holo.open"; dir: string }
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
}

export interface HoloDevice {
  readonly transport: HoloTransport | null;
  /** Calls `tick` about every `ms` until the returned function is called (a test seam; default: a timer). */
  readonly every?: (ms: number, tick: () => void) => () => void;
}

const STEP_MS = 50;
const SPEED = 4; // a quarter-hour session plays in under four minutes

export function createHolotable(device: HoloDevice, signal: AbortSignal) {
  let state: HoloState = { phase: "idle", message: "", runs: [], open: null, t: 0, playing: false, level: "structure",
    layers: { v: true, camera: true, events: true, gaps: true, areas: true, cells: false }, selected: null, revision: 0 };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<HoloState>) => { state = { ...state, ...patch, revision: state.revision + 1 }; for (const l of listeners) l(); };
  let loading: AbortController | null = null;
  let stopTimer: (() => void) | null = null;
  const every = device.every ?? ((ms: number, tick: () => void) => { const id = setInterval(tick, ms); return () => clearInterval(id); });

  const call = async <T>(method: string, params: Record<string, unknown>, cancel: AbortSignal): Promise<T> => {
    if (!device.transport) throw Object.assign(new Error("Holotable isn't available in this copy of XF Studio."), { code: "unavailable" });
    const answer = await device.transport(method, params, cancel);
    const data = answer.data as { ok?: boolean; result?: T; error?: { message?: string } };
    if (!answer.ok || !data?.ok) throw Object.assign(new Error(data?.error?.message ?? `The Holotable service answered ${answer.status}.`), { code: answer.status === 404 ? "unavailable" : "failed" });
    return data.result as T;
  };
  const fresh = () => { loading?.abort(); loading = new AbortController(); return loading.signal; };
  signal.addEventListener("abort", () => loading?.abort(), { once: true });
  const failed = (e: unknown, cancel: AbortSignal) => {
    if (cancel.aborted || signal.aborted) return;
    const code = (e as { code?: string })?.code;
    set({ phase: code === "unavailable" ? "unavailable" : "failed", message: String((e as Error)?.message ?? e) });
  };

  async function refresh() {
    const cancel = fresh();
    set({ phase: state.open ? state.phase : "listing", message: "Looking for recordings…" });
    try {
      const runs = await call<HoloRun[]>("runs.list", {}, cancel);
      if (cancel.aborted) return;
      set({ runs, phase: state.open ? "ready" : "idle", message: runs.length ? "" : "No recordings yet. A test session with the recorder on leaves one here." });
    } catch (e) { failed(e, cancel); }
  }
  async function open(dir: string, level: ContentLevel, keepTime: boolean) {
    const cancel = fresh();
    pause();
    set({ phase: "opening", message: "Opening the recording…" });
    try {
      const [session, world] = await Promise.all([call<HoloSession>("session.open", { dir, level }, cancel), call<HoloWorld>("world.around", { dir }, cancel)]);
      if (cancel.aborted) return;
      const t = keepTime && state.open?.dir === dir ? state.t : session.meta.from;
      set({ open: { dir, session, world }, phase: "ready", message: "", t, level, selected: keepTime ? state.selected : null });
    } catch (e) { failed(e, cancel); }
  }
  function pause() { stopTimer?.(); stopTimer = null; if (state.playing) set({ playing: false }); }
  function play() {
    const s = state.open?.session; if (!s) return;
    if (state.t >= s.meta.to) set({ t: s.meta.from });
    set({ playing: true });
    stopTimer = every(STEP_MS, () => {
      const end = state.open?.session.meta.to ?? 0, next = Math.min(end, state.t + SPEED * STEP_MS / 1000);
      set({ t: next });
      if (next >= end) pause();
    });
  }
  signal.addEventListener("abort", () => { pause(); listeners.clear(); }, { once: true });

  function capability(action: HoloAction): Capability {
    switch (action.kind) {
      case "holo.refresh": return device.transport ? { available: true } : refusal("unavailable", "Holotable isn't available in this copy of XF Studio.");
      case "holo.open": return state.runs.some(r => r.dir === action.dir) ? { available: true } : refusal("missing_target", "That recording isn't in the list any more.");
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
      case "holo.seek": {
        pause();
        const m = state.open!.session.meta;
        set({ t: Math.max(m.from, Math.min(m.to, action.t)) });
        break;
      }
      case "holo.play": if (action.on) play(); else pause(); break;
      case "holo.layer": set({ layers: { ...state.layers, [action.id]: action.on } }); break;
      case "holo.level": if (action.level !== state.level) await open(state.open!.dir, action.level, true); break;
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
    withdraw: pause,
    /** The module was shown: list the recordings once, on demand (nothing is asked of the host before the view is wanted). */
    shown() { if (state.phase === "idle" && !state.runs.length && device.transport) void refresh(); },
  };
}
export type HolotableService = ReturnType<typeof createHolotable>;
