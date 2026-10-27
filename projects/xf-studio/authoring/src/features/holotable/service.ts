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
import { changeMoment, clockFamily, playbackMemory, SPEEDS, type PlaybackMemory } from "./playback";
import { worldContexts } from "./world-context";
import type { AgentAnswer } from "./agent-types";
import type { Vec3 } from "./types";

export const HOLO_LAYERS = ["v", "camera", "people", "events", "gaps", "areas", "cells", "solids", "pois", "spots", "communities"] as const;
export type HoloLayer = typeof HOLO_LAYERS[number];

export type ViewFocus = { id?: string; layer?: string; position?: Vec3 };
export interface HoloNavigation { focus(target: ViewFocus): boolean; back(): boolean; canBack(): boolean; available(): boolean; baseCounts?(): Readonly<{pois:number;spots:number;communities:number;available?:boolean}> }
export interface HoloPreferences { technical?: boolean; keys?: Record<string, boolean> }

export type HoloAction =
  | { kind: "holo.refresh" }
  | { kind: "holo.open"; dir: string }
  | { kind: "holo.focus"; position: Vec3 }
  | ({ kind: "holo.view.focus"; view: string } & ViewFocus)
  | { kind: "holo.view.back"; view: string }
  | { kind: "holo.watch" }
  | { kind: "holo.follow" }
  | { kind: "holo.seek"; t: number }
  | { kind: "holo.play"; on: boolean }
  | { kind: "holo.speed"; speed: number }
  | { kind: "holo.change.previous" }
  | { kind: "holo.change.next"; allVisible?: boolean }
  | { kind: "holo.change.scope"; layer: string | null }
  | { kind: "holo.layer"; id: HoloLayer; on: boolean }
  | { kind: "holo.level"; level: ContentLevel }
  | { kind: "holo.select"; id: string | null; members?: readonly string[] }
  | { kind: "holo.place"; position: Vec3 }
  | { kind: "holo.agentLayer"; id: string; on: boolean }
  | { kind: "holo.producer"; producer: string; on: boolean }
  | { kind: "holo.branch"; branch: string };
export type HoloOutcome = { ok: true } | { ok: false; code: ReasonCode; message: string };

export type HoloPhase = "idle" | "listing" | "ready" | "opening" | "unavailable" | "failed";
export interface HoloState {
  readonly phase: HoloPhase;
  /** Plain words for anything but ready. */
  readonly message: string;
  readonly openError: { readonly dir: string; readonly title: string; readonly reason: string } | null;
  readonly runs: readonly HoloRun[];
  readonly open: { readonly dir: string; readonly session: HoloSession; readonly world: HoloWorld } | null;
  /** An explicit open asks each view to fit again, including reopening the same recording. */
  readonly openGeneration: number;
  /** The moment shown, in the recording's own seconds (QPC source time). */
  readonly t: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly changeScope: string | null;
  /** Changes whenever navigation invalidates playback animation continuity. */
  readonly motionEpoch: number;
  readonly level: ContentLevel;
  readonly layers: Readonly<Record<HoloLayer, boolean>>;
  /** "v", or an event's id. */
  readonly selected: string | null;
  /** Exact membership of an inseparable screen-space cluster, distinct from a co-located place. */
  readonly selectedCluster?: readonly string[];
  readonly revision: number;
  readonly live: HoloLiveState;
  readonly agents: AgentAnswer;
  readonly agentEnabled: Readonly<Record<string, boolean>>;
  readonly position: Vec3 | null;
  readonly branch: string | undefined;
}

export interface HoloDevice {
  readonly transport: HoloTransport | null;
  readonly playback?: Partial<PlaybackMemory>;
  readonly preferences?: HoloPreferences;
  readonly rememberPreferences?: (value: HoloPreferences) => void;
  readonly rememberPlayback?: (memory: PlaybackMemory) => void;
  /** Calls `tick` about every `ms` until the returned function is called (a test seam; default: a timer). */
  readonly every?: (ms: number, tick: () => void) => () => void;
  /** A one-shot timer for status and live updates; cancelled whenever the module is hidden. */
  readonly later?: (ms: number, tick: () => void) => () => void;
}

const STEP_MS = 50;


export function createHolotable(device: HoloDevice, signal: AbortSignal) {
  let memory = playbackMemory(device.playback);
  let state: HoloState = { phase: "idle", message: "", openError: null, runs: [], open: null, openGeneration: 0, t: 0, playing: false, speed: memory.recording, changeScope: null, motionEpoch: 0, level: "full",
    agents: { layers: [], here: [], specs: { schema: "xfh/projections-1", kinds: {} } }, agentEnabled: {}, position: null, branch: undefined,
    layers: { v: true, camera: true, people: false, events: true, gaps: true, areas: true, cells: false, solids: true, pois: false, spots: false, communities: false }, selected: null, revision: 0,
    live: { available: false, recording: false, watching: false, following: false, phase: "idle", behindS: 0, more: false, droppedBatches: 0, message: "" } };
  const views = new Map<string,HoloNavigation>();
  let preferences: HoloPreferences = { ...device.preferences, keys: { ...device.preferences?.keys } };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<HoloState>) => {
    let changeScope=patch.changeScope===undefined?state.changeScope:patch.changeScope;
    if(changeScope&&(!(patch.agents??state.agents).layers.some(l=>l.id===changeScope)||(patch.agentEnabled??state.agentEnabled)[changeScope]===false))changeScope=null;
    state = { ...state, ...patch, selectedCluster: Object.hasOwn(patch,"selectedCluster") || patch.selected !== undefined && patch.selected !== state.selected ? patch.selectedCluster : state.selectedCluster, changeScope, revision: state.revision + 1 }; for (const l of listeners) l();
  };
  let loading: AbortController | null = null;
  let contextCtl: AbortController | null = null, contextCentre: { dir: string; position: Vec3 } | null = null;
  function stopContext() { contextCtl?.abort(); contextCtl = null; contextCentre = null; }
  async function wantContext(position: Vec3) {
    const opened = state.open;
    if (!visible || !opened?.session.meta.standalone || signal.aborted || contexts.active()) return;
    if (contextCentre?.dir === opened.dir && Math.hypot(...position.map((n, i) => n - contextCentre!.position[i])) <= 150) return;
    contextCtl?.abort(); const ctl = new AbortController(); contextCtl = ctl;
    contextCentre = { dir: opened.dir, position: [...position] as Vec3 };
    try {
      const world = await call<HoloWorld>("world.around", { dir: opened.dir, center: position, margin: 350 }, ctl.signal);
      if (!ctl.signal.aborted && visible && state.open?.dir === opened.dir) set({ open: { ...state.open, world } });
    } catch { /* Solid context is optional; retain the layers and any previous world. */ }
  }
  let stopTimer: (() => void) | null = null;
  const every = device.every ?? ((ms: number, tick: () => void) => { const id = setInterval(tick, ms); return () => clearInterval(id); });
  const later = device.later ?? ((ms: number, tick: () => void) => { const id = setTimeout(tick, ms); return () => clearTimeout(id); });
  let visible = false, stopLiveTimer: (() => void) | null = null, stopStatusTimer: (() => void) | null = null;
  let liveCtl: AbortController | null = null, statusCtl: AbortController | null = null;
  let watchId: string | null = null, liveSince: HoloLiveCursor | undefined;
  let resumeWatch = false;
  let layerWatch: string | null = null, layerCtl: AbortController | null = null, stopLayerTimer: (() => void) | null = null;
  let layerGeneration = 0;

  const call = async <T>(method: string, params: Record<string, unknown>, cancel: AbortSignal): Promise<T> => {
    if (!device.transport) throw Object.assign(new Error("Holotable isn't available in this copy of XF Studio."), { code: "unavailable" });
    const answer = await device.transport(method, params, cancel);
    const data = answer.data as { ok?: boolean; result?: T; error?: { code?: string; message?: string } };
    if (!answer.ok || !data?.ok) throw Object.assign(new Error(data?.error?.message ?? `The Holotable service answered ${answer.status}.`), { code: answer.status === 404 ? "unavailable" : data?.error?.code ?? "failed" });
    return data.result as T;
  };
  const contentConsumer=crypto.randomUUID();let contentDemand=Promise.resolve();
  const contexts=worldContexts({later,
    source:()=>visible&&state.open&&(state.open.dir!=="live"||watchId) ? {identity:`${state.open.dir}:${state.open.session.meta.session}:${state.open.session.meta.run}`,
      params:{...(state.open.dir==="live"?{watch:watchId}:{dir:state.open.dir}),...((state.layers.pois||state.layers.spots||state.layers.communities)?{content:true}:{})}} : undefined,
    load:(params,cancel)=>call<HoloWorld>("world.around",{...params,...(params.content?{contentConsumer}:{})},cancel),
    // Preserve acquire/release order, including the final release after this service's signal ends.
    contentDemand:wanted=>{contentDemand=contentDemand.then(()=>call("world.content.demand",{consumer:contentConsumer,wanted},AbortSignal.timeout(5000))).then(()=>{},()=>{});},
    changed:world=>{if(state.open&&!signal.aborted)set({open:{...state.open,world:{...world,extent:world.extent??state.open.world.extent}}});},
  },signal);
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

  function clearAgents() { set({ agents: { ...state.agents, layers: [], here: [] } }); }
  async function takeLayers() {
    if (!visible || !layerWatch || !state.open || signal.aborted) return;
    layerCtl?.abort(); const ctl = new AbortController(); layerCtl = ctl;
    const at = state.t, dir = state.open.dir, level = state.level, branch = state.branch, epoch = state.motionEpoch;
    try {
      const answer = await call<AgentAnswer>("layers.poll", { watch: layerWatch, ...(dir === "live" ? { liveWatch: watchId } : { dir }), t: at, level, branch,
        hidden: Object.keys(state.agentEnabled).filter(k => !state.agentEnabled[k]), position: state.position }, ctl.signal);
      if (ctl.signal.aborted || layerCtl !== ctl || state.motionEpoch !== epoch || state.t !== at || state.open?.dir !== dir || state.level !== level || !Array.isArray(answer.layers)) return;
      set({ agents: answer });
    } catch (e) {
      if (!ctl.signal.aborted && layerCtl === ctl && state.motionEpoch === epoch && state.t === at && state.open?.dir === dir && (e as Error).name !== "AbortError") clearAgents();
      if (!ctl.signal.aborted && (e as { code?: string }).code === "bad_request") layerWatch = null;
    }
  }
  async function startLayers() {
    const generation = ++layerGeneration;
    try {
      const result = await call<{ watch: string }>("layers.watch", {}, signal);
      if (generation !== layerGeneration || !visible || signal.aborted) { if (result.watch) void call("layers.stop", result, new AbortController().signal).catch(() => {}); return; }
      if (!result.watch) return;
      layerWatch = result.watch; await takeLayers();
      const current = () => generation === layerGeneration && (!layerWatch || layerWatch === result.watch) && visible && !signal.aborted;
      if (!current()) return;
      const tick = async () => {
        if (!current()) return;
        if (!layerWatch) { await startLayers(); return; }
        if (state.open) await takeLayers();
        else { // Keep the lease alive and discover sets published while Recordings is empty.
          try { await call("layers.renew", { watch: layerWatch }, signal); await refresh(); } catch {}
        }
        if (current()) stopLayerTimer = later(1000, () => { void tick(); });
      };
      if (current()) stopLayerTimer = later(1000, () => { void tick(); });
    } catch { /* Older hosts can still replay the base tracks. */ }
  }
  function stopLayers() {
    layerGeneration++;
    layerCtl?.abort(); stopLayerTimer?.(); stopLayerTimer = null;
    const watch = layerWatch; layerWatch = null;
    if (watch) void call("layers.stop", { watch }, new AbortController().signal).catch(() => {});
  }

  async function liveStatus() {
    if (!visible || !device.transport || signal.aborted) return;
    statusCtl?.abort(); const cancel = new AbortController(); statusCtl = cancel;
    try {
      // The existing five-second status poll renews content only while a view still wants it.
      const live = await call<Omit<HoloLiveState, "following">>("live.status", contexts.wantsContent()?{contentConsumer}:{}, cancel.signal);
      if (!cancel.signal.aborted && visible) set({ live: { ...state.live, available: live.available === true, recording: live.recording === true } });
    } catch { if (!cancel.signal.aborted && visible) set({ live: { ...state.live, available: false, recording: false } }); }
    finally { if (visible && !signal.aborted && !cancel.signal.aborted) stopStatusTimer = later(5000, () => { void liveStatus(); }); }
  }
  function stopWatching(clear = true, keepCursor = false) {
    liveCtl?.abort(); liveCtl = null; stopLiveTimer?.(); stopLiveTimer = null;
    const id = watchId; watchId = null;
    if (!keepCursor) liveSince = undefined;
    if (id && !signal.aborted) void call("live.stop", { watch: id }, signal).catch(() => {});
    if (clear) set({ live: { ...state.live, watching: false, following: false }, playing: false, speed: memory[clockFamily(state)] });
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
          actors: [...(old?.actors ?? []), ...(update.actors ?? [])], v: [...(old?.v ?? []), ...update.v], camera: [...(old?.camera ?? []), ...update.camera],
          events: [...(old?.events ?? []), ...update.events], gaps: [...(old?.gaps ?? []), ...update.gaps] } : null;
        const following = state.live.following;
        let t = state.t, selected = state.selected;
        if (session) {
          if (following) t = Math.max(session.meta.from, Math.min(session.meta.to, session.v.at(-1)?.t ?? session.meta.from));
          else if (update.reset) t = session.meta.from;
        }
        if (update.reset && selected && !(selected === "v" ? session?.v.length : session?.events.some(e => e.id === selected))) selected = null;
        const behindS = update.state.behindS + (session?.v.length ? Math.max(0, session.meta.to - session.v.at(-1)!.t) : 0);
        set({ live: { ...update.state, following, behindS }, selected, ...(session ? { open: { dir: "live", session, world: update.reset ? emptyWorld() : state.open?.world ?? emptyWorld() }, phase: "ready", t } : {}),
          message: update.state.message || (!session?.v.length ? "Waiting for recorder samples…" : "") });
        if (update.reset) { contexts.reset(); set({ motionEpoch: state.motionEpoch + 1 }); clearAgents(); }
        if (!update.more) break;
      }
      contexts.refresh();
      void takeLayers();
    } catch (e) {
      if (!cancel.aborted && visible) {
        set({ live: { ...state.live, phase: "disconnected" }, message: "The game stopped sending. Showing what arrived; Holotable reconnects when the game is back." });
        if ((e as { code?: string }).code === "bad_request" || (e as { code?: string }).code === "exited") {
          recovering = true;
          liveSince = undefined;
          stopLiveTimer = later(5000, () => { if (visible && !cancel.aborted) void watch(true); });
          return;
        }
      }
    } finally {
      if (!recovering && !cancel.aborted && visible && watchId === id) stopLiveTimer = later(1000, () => { void takeLive(cancel); });
    }
  }
  async function watch(keep = false) {
    stopWatching(false, keep); stopContext(); contexts.reset(); loading?.abort(); pendingLevel = null; pause();
    liveCtl = new AbortController(); const cancel = liveCtl.signal;
    set({ live: { ...state.live, watching: true, following: true }, playing: true, speed: 1, motionEpoch: state.motionEpoch + 1, openGeneration: state.openGeneration+(keep?0:1), open: keep ? state.open : null, phase: "ready", openError: null, message: "Waiting for recorder samples…", selected: null });
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
      set({ runs: [...runs].sort((a,b) => Number(!!b.standalone)-Number(!!a.standalone)), phase: state.openError ? "failed" : state.open || state.live.watching ? "ready" : "idle", message: state.openError ? state.openError.reason : state.live.watching ? state.message : runs.length ? "" : "No recordings yet. A test session with the recorder on leaves one here." });
    } catch (e) { failed(e, cancel); }
  }
  async function open(dir: string, level: ContentLevel, keepTime: boolean) {
    stopWatching(); stopContext(); contexts.reset();
    const cancel = fresh();
    pendingLevel = level;
    pause();
    clearAgents();
    set({ phase: "opening", openError: null, message: "Opening the recording…" });
    const run = state.runs.find(r => r.dir === dir), title = run?.title ?? (run ? `Session ${run.session.slice(0,8)} · run ${run.run}` : "recording");
    try {
      const session = await call<HoloSession>("session.open", { dir, level }, cancel);
      if (cancel.aborted) return;
      let world = keepTime && state.open?.dir === dir ? state.open.world : emptyWorld();
      if (!session.meta.standalone) {
        try {
          const status = await call<{ cold: boolean }>("world.status", { dir }, cancel);
          if (!cancel.aborted && status.cold) set({ message: "Reading the city around this recording from the game files… This happens once." });
        } catch { /* Status cannot prevent opening. */ }
        try { world = await call<HoloWorld>("world.around", { dir }, cancel); } catch { /* Context cannot prevent opening. */ }
      }
      if (cancel.aborted) return;
      pendingLevel = null;
      const t = keepTime && state.open?.dir === dir ? state.t : session.meta.from;
      set({ speed: session.meta.standalone?.clock === "game" ? memory.game : memory.recording, motionEpoch: state.motionEpoch + 1, openGeneration: state.openGeneration+(keepTime?0:1), open: { dir, session, world }, phase: "ready", message: "", t, level, selected: keepTime ? state.selected : null,
        position: keepTime ? state.position : null, branch: keepTime ? state.branch : session.meta.standalone?.branches[0] });
      const extent = session.meta.standalone?.extent;
      if (extent) void wantContext(extent.min.map((n,i)=>(n+extent.max[i])/2) as unknown as Vec3);
      clearAgents(); await takeLayers();
    } catch (e) {
      if (!cancel.aborted && !signal.aborted) {
        pendingLevel = null; const reason = String((e as Error)?.message ?? e);
        set({ phase: "failed", open: null, openError: { dir, title, reason }, message: reason });
      }
    }
  }
  /** Asking again for the level already shown cancels a switch still loading, so a late answer can never show what was taken back. */
  function setLevel(level: ContentLevel) {
    set({ motionEpoch: state.motionEpoch + 1 });
    clearAgents();
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
    if (level !== state.level) {
      if (level === "structure" && state.open) set({ level, open: { ...state.open, session: { ...state.open.session, events: state.open.session.events.map(e => { const { detail, incident, ...rest } = e; return e.level === "full" ? rest : e; }) } } });
      return open(state.open!.dir, level, true);
    }
    if (pendingLevel !== null && pendingLevel !== level) { loading?.abort(); loading = null; pendingLevel = null; set({ phase: "ready", message: "" }); }
  }
  function pause() { stopTimer?.(); stopTimer = null; if (state.playing) set({ playing: false }); }
  function play() {
    const s = state.open?.session; if (!s || stopTimer) return; // one timer, however often Play is asked
    if (state.t >= s.meta.to) set({ t: s.meta.from });
    set({ playing: true });
    stopTimer = every(STEP_MS, () => {
      const end = state.open?.session.meta.to ?? 0, next = Math.min(end, state.t + state.speed * STEP_MS / 1000);
      set({ t: next });
      void takeLayers();
      if (next >= end) pause();
    });
  }
  const dropSolids=()=>{if(state.open?.world.solids?.length)set({open:{...state.open,world:{...state.open.world,solids:[]}}});};
  signal.addEventListener("abort", () => { visible = false; stopContext(); stopLayers(); stopWatching(false); statusCtl?.abort(); stopStatusTimer?.(); pause(); dropSolids(); views.clear(); listeners.clear(); }, { once: true });

  function capability(action: HoloAction): Capability {
    if (signal.aborted) return refusal("unavailable", "Holotable is switched off. Turn the experiment on to use it.");
    switch (action.kind) {
      case "holo.refresh": return device.transport ? { available: true } : refusal("unavailable", "Holotable isn't available in this copy of XF Studio.");
      case "holo.open": return state.runs.some(r => r.dir === action.dir) ? { available: true } : refusal("missing_target", "That recording isn't in the list any more.");
      case "holo.watch": return state.live.available && state.live.recording ? { available: true } : refusal("not_ready", "The recorder is off. It runs during XF test sessions.");
      case "holo.follow": return state.live.watching ? { available: true } : refusal("not_ready", "Watch the live game first.");
      case "holo.speed": return state.open && !state.live.following && SPEEDS[clockFamily(state)].some(s => s.value === action.speed)
        ? { available: true } : refusal("not_ready", state.live.following ? "Live always plays at 1×. Pause to replay at another speed." : "Open a recording and choose one of its speeds.");
      case "holo.change.previous": case "holo.change.next": return state.open && changeMoment(state, action.kind === "holo.change.previous" ? -1 : 1, action.kind === "holo.change.next" && action.allVisible === true) !== undefined
        ? { available: true } : refusal("not_ready", action.kind === "holo.change.previous" ? "No earlier change in visible layers." : "No later change in visible layers.");
      case "holo.change.scope": return action.layer===null||state.agents.layers.some(l=>l.id===action.layer&&state.agentEnabled[l.id]!==false) ? {available:true} : refusal("missing_target","That layer is hidden or no longer available.");
      case "holo.select":
        if(action.members!==undefined&&(!action.id?.startsWith("cluster:")||!Array.isArray(action.members)||!action.members.every(k=>typeof k==="string")))return refusal("invalid_value","Cluster members must be item keys.");
      case "holo.seek": case "holo.play": return state.open ? { available: true } : refusal("not_ready", "Open a recording first.");
      case "holo.view.focus":
        if(!views.get(action.view)?.available())return refusal("missing_target","Open a Holotable view first");
        if([action.id,action.layer,action.position].filter(v=>v!==undefined).length!==1||action.position&&(!Array.isArray(action.position)||action.position.length!==3||!action.position.every(Number.isFinite)))return refusal("invalid_value","Name one item, layer or valid position to focus.");
        return {available:true};
      case "holo.view.back":
        if(!views.get(action.view)?.available())return refusal("missing_target","Open a Holotable view first");
        return views.get(action.view)!.canBack() ? {available:true} : refusal("not_ready","No earlier viewpoint in this view.");
      case "holo.focus": return state.open?.session.meta.standalone && action.position.length === 3 && action.position.every(Number.isFinite) ? { available: true } : refusal("not_ready", "Open a layers-only set first.");
      case "holo.place": return state.open && action.position.length === 3 && action.position.every(Number.isFinite) ? { available: true } : refusal("invalid_value", "Select a place in an open view.");
      case "holo.agentLayer": return state.agents.layers.some(l => l.id === action.id) ? { available: true } : refusal("missing_target", "That layer is no longer here.");
      case "holo.producer": return state.agents.layers.some(l => l.producer === action.producer) ? { available: true } : refusal("missing_target", "That producer is no longer here.");
      case "holo.branch": return state.open?.session.meta.standalone?.branches.includes(action.branch) ? { available: true } : refusal("invalid_value", "Unknown branch.");
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
      case "holo.view.focus": if(!views.get(action.view)!.focus(action)) return {ok:false,code:"missing_target",message:"No placed items to focus."}; break;
      case "holo.view.back": views.get(action.view)!.back(); break;
      case "holo.focus": void wantContext(action.position); break;
      case "holo.watch": await watch(); break;
      case "holo.follow": {
        pause(); set({ live: { ...state.live, following: true }, speed: 1, motionEpoch: state.motionEpoch + 1, playing: true, t: state.open?.session.v.at(-1)?.t ?? state.t }); break;
      }
      case "holo.speed": {
        memory = { ...memory, [clockFamily(state)]: action.speed };
        device.rememberPlayback?.({ ...memory }); set({ speed: action.speed }); break;
      }
      case "holo.change.scope": set({changeScope:action.layer});break;
      case "holo.change.previous": case "holo.change.next": {
        const t = changeMoment(state, action.kind === "holo.change.previous" ? -1 : 1, action.kind === "holo.change.next" && action.allVisible === true)!;
        pause(); set({ t, motionEpoch: state.motionEpoch + 1, live: { ...state.live, following: false }, speed: memory[clockFamily(state)] }); break;
      }
      case "holo.seek": {
        pause();
        if (state.live.watching) set({ live: { ...state.live, following: false } });
        const m = state.open!.session.meta;
        set({ t: Math.max(m.from, Math.min(m.to, action.t)), speed: memory[clockFamily(state)], motionEpoch: state.motionEpoch + 1 });
        break;
      }
      case "holo.play":
        if (state.live.following) set({ live: { ...state.live, following: false }, playing: false, speed: memory[clockFamily(state)] });
        if (action.on) play(); else pause(); break;
      case "holo.layer": set({ layers: { ...state.layers, [action.id]: action.on },
        selected: !action.on && action.id === "people" && state.selected?.startsWith("person:") ? null : !action.on && state.selected?.startsWith(`base:${action.id}:`) ? null : state.selected });
        if (["pois", "spots", "communities"].includes(action.id)) contexts.refresh(true);
        break;
      case "holo.level": await setLevel(action.level); break;
      case "holo.select": set({ selected: action.id, selectedCluster: action.members ? [...action.members] : undefined, position: null }); break;
      case "holo.place": set({ position: action.position, selected: null }); break;
      case "holo.agentLayer": set({ motionEpoch: state.motionEpoch + 1, agentEnabled: { ...state.agentEnabled, [action.id]: action.on } }); break;
      case "holo.producer": set({ motionEpoch: state.motionEpoch + 1, agentEnabled: { ...state.agentEnabled, ...Object.fromEntries(state.agents.layers.filter(l => l.producer === action.producer).map(l => [l.id, action.on])) } }); break;
      case "holo.branch": set({ motionEpoch: state.motionEpoch + 1, branch: action.branch, selected: null, position: null }); clearAgents(); break;
    }
    if (["holo.change.previous", "holo.change.next", "holo.seek", "holo.place", "holo.agentLayer", "holo.producer", "holo.branch", "holo.level"].includes(action.kind)) await takeLayers();
    return { ok: true };
  }
  return {
    capability,
    dispatch,
    navigation(view: string, adapter: HoloNavigation, lifetime: AbortSignal) {
      if(signal.aborted||lifetime.aborted)return;
      views.set(view,adapter);
      const release=()=>{if(views.get(view)===adapter)views.delete(view);};
      if(lifetime.aborted)release();else lifetime.addEventListener("abort",release,{once:true});
    },
    visibleBaseCounts(view:string|undefined) { return view ? views.get(view)?.baseCounts?.() : undefined; },
    preference(key: "technical" | "key", view?: string): boolean { return key==="technical" ? preferences.technical??false : preferences.keys?.[view??""]??true; },
    remember(key: "technical" | "key", value: boolean, view?: string) {
      preferences=key==="technical"?{...preferences,technical:value}:{...preferences,keys:{...preferences.keys,[view??""]:value}};
      device.rememberPreferences?.(preferences);
    },
    snapshot: () => state,
    /** Read-only asset demand for one visible view. Its AbortSignal owns the lease, never the shared clock. */
    context(lifetime:AbortSignal) { stopContext(); return contexts.lease(lifetime); },
    speedOptions: () => SPEEDS[clockFamily(state)],
    /** The next change in any visible layer, independent of the temporary stepping scope. */
    nextVisibleChange: () => changeMoment(state,1,true),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The module was hidden: playback stops (nothing runs for a view no one sees). */
    withdraw() { set({ motionEpoch: state.motionEpoch + 1 }); resumeWatch = state.live.watching; visible = false; stopContext(); contexts.reset(); dropSolids(); stopLayers(); stopStatusTimer?.(); statusCtl?.abort(); pause(); stopWatching(true, resumeWatch); },
    /** The module was shown: list the recordings once, on demand (nothing is asked of the host before the view is wanted). */
    shown() {
      if (visible || signal.aborted) return; visible = true;
      if (state.phase === "idle" && !state.runs.length && device.transport) void refresh();
      void liveStatus();
      void startLayers();
      if (resumeWatch) { resumeWatch = false; void watch(true); }
    },
  };
}
export type HolotableService = ReturnType<typeof createHolotable>;
