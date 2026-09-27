/**
 * The Poses module's application service (pose-library-design.md §6–7, P3; view-graph-design.md §5.1): the photo-mode poses of V's own
 * body gender as the game lists them, one-click apply, favourites and recent poses per user, the game's outfit filter, and the whole-body
 * framing on request. Typed actions with capabilities; no DOM, Three or network code.
 *
 * - **Catalogue**: read from the host (`/api/poses`, pose-catalogue-host.ts) through the device's transport, polled while the host builds
 *   it; listing never decodes a clip. The body gender is the shown V's (decision Q8: never the other body's poses).
 * - **Apply** (`pose.select`): the pose becomes V's body source through the motion service (`MotionActions.holdPose`), which shows it at
 *   once and plays it when its clip arrives (decoded on demand by the host, kept here for the session). A newer choice supersedes one still
 *   loading. The camera never moves (decision Q3); `pose.frame` frames the posed body.
 * - **Preferences**: favourites, recent and open groups live in the host's per-user document (preferences.ts), changed here at once and
 *   written behind (one write in flight, the newest next). Each change is kept until the host confirms it and is applied on top of
 *   whatever document the host holds: the one that loads after it, or a newer one a 409 answers (then written once more, CORE-112).
 * - **Restore**: a pose the workspace stored is played again once the catalogue is ready, or dropped quietly when it can't be.
 */
import { refusal, type Capability, type ReasonCode } from "../../platform/api";
import type { HeldPose, PoseBodyGender, PoseCatalogueTransport as PoseTransport, PoseItem as PoseEntry, PoseListing as PoseCatalogue,
  PoseListingState as PoseCatalogueState, PosePlacementData as PosePlacement, PoseSampleData as PoseSample } from "./types";
import { buildPoseTree, entryUnavailable, type PoseTree } from "./library";
import { defaultPosePreferences, isPoseRecord, parsePosePreferences, withFavourite, withOpen, withRecent, type PosePreferences } from "./preferences";

/** What the service asks of the host: the pose catalogue's transport and the per-user preferences document. */
export type PoseLibraryDevice = {
  readonly catalogue: PoseTransport | null;
  readonly preferences: {
    load(): Promise<unknown>;
    save(revision: number, preferences: PosePreferences): Promise<{ ok: boolean; status: number; data: unknown }>;
  } | null;
  /** Wait (a test seam; default: a timer). */
  readonly wait?: (ms: number) => Promise<void>;
};
/** The motion service as the Poses module drives it (motion-actions.ts). */
export type PoseMotionPort = {
  snapshot(): { readonly idle: boolean; readonly pose: HeldPose | null; readonly poseLoading: boolean };
  poseCapability(): Capability;
  holdPose(pose: HeldPose, sample: Promise<PoseSample>, placement?: PosePlacement): Promise<boolean>;
  pendingPose(): { id: string; label: string } | null;
  dropPendingPose(): void;
  /** Still (false) or the chosen idle (true): the body sources other than a pose. */
  bodyCapability(idle: boolean): Capability;
  setBody(idle: boolean): void;
};
/** The shown V as the composition root exposes it: her body, the tags of what she wears, her motion and the whole-body view. */
export type PoseStage = {
  bodyGender(): PoseBodyGender | null;
  wornTags(): readonly string[];
  motion(): PoseMotionPort | null;
  frame(): Capability;
  frameCapability(): Capability;
  subscribe(listener: () => void): () => void;
};

export type PoseLibraryAction =
  | { kind: "pose.select"; id: string }
  | { kind: "pose.clear"; to: "still" | "idle" }
  | { kind: "pose.favourite"; id: string; on: boolean }
  | { kind: "pose.frame" }
  | { kind: "pose.showFiltered"; shown: boolean }
  | { kind: "pose.openGroup"; group: string; open: boolean }
  | { kind: "pose.retry" };
export type PoseLibraryOutcome = { ok: true } | { ok: false; code: ReasonCode; message: string };

export type PoseCatalogueView = {
  readonly phase: "waiting" | "unavailable" | "needs-setup" | "preparing" | "ready" | "failed";
  /** Plain words for anything but ready. */
  readonly message: string;
  readonly bodyGender: PoseBodyGender | null;
  /** Changes whenever the catalogue changes. */
  readonly revision: number;
  readonly listed: number;
  readonly categories: number;
};
export type PoseLibraryState = {
  readonly catalogue: PoseCatalogueView;
  /** The pose V holds (or is about to): from the motion service. */
  readonly current: { readonly id: string; readonly label: string; readonly loading: boolean } | null;
  /** V's body source now. */
  readonly body: "still" | "idle" | "pose" | "none";
  readonly preferences: PosePreferences;
  readonly showFiltered: boolean;
  /** Whether a pose can be applied now, with the plain reason when not. */
  readonly playable: Capability;
};

/** The catalogue entries of the module's actions (research/authoring/ui-action-catalogue.md): view state and preferences, no Undo. */
export const POSE_LIBRARY_DESCRIPTORS = Object.freeze({
  "pose.select": { scope: "viewport", effect: "view", async: true, undo: "none", payload: { id: "text" } },
  "pose.clear": { scope: "viewport", effect: "view", async: false, undo: "none", payload: { to: "choice" } },
  "pose.favourite": { scope: "preferences", effect: "write", async: true, undo: "none", payload: { id: "text", on: "boolean" } },
  "pose.frame": { scope: "viewport", effect: "view", async: false, undo: "none", payload: {} },
  "pose.showFiltered": { scope: "poses", effect: "view", async: false, undo: "none", payload: { shown: "boolean" } },
  "pose.openGroup": { scope: "preferences", effect: "write", async: true, undo: "none", payload: { group: "text", open: "boolean" } },
  "pose.retry": { scope: "host", effect: "read", async: true, undo: "none", payload: {} },
} as const satisfies Record<PoseLibraryAction["kind"], { scope: string; effect: string; async: boolean; undo: "none"; payload: object }>);

const SAMPLE_SCHEMA = "xfs/pose-sample-1", STATE_SCHEMA = "xfs/pose-catalogue-state-1";
const POLL_MS = 700, SAMPLE_CACHE = 64;
const WAITING = "Poses appear once your V is shown in the 3D view.";
const UNAVAILABLE = "Poses are unavailable on this host.";
const UNREACHABLE = "XF Studio couldn't reach its host to read the poses. Restart XF Studio and try again.";

export class PoseLibraryActions {
  private listeners = new Set<() => void>();
  private catalogue: PoseCatalogue | null = null;
  private view: PoseCatalogueView;
  private preferences: PosePreferences = defaultPosePreferences();
  private preferencesRevision: number | null = null;
  /**
   * The person's preference changes the host hasn't confirmed yet, in order (CORE-112): applied to the host's document when it loads, and
   * again to the newer one a 409 answers, so a change made before the load or after a host restart is never lost or written over others.
   */
  private pendingPreferences: ((prefs: PosePreferences) => PosePreferences)[] = [];
  private loadingPreferences: Promise<void> | null = null;
  private saving = false;
  private showFiltered = false;
  private loadingFor: PoseBodyGender | null = null;
  private generation = 0;
  private readonly samples = new Map<string, Promise<PoseSample>>();
  private readonly byId = new Map<string, PoseEntry>();
  private treeCache: { key: string; tree: PoseTree } | null = null;
  private restoring = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly device: PoseLibraryDevice, private readonly stage: PoseStage) {
    this.view = { phase: device.catalogue ? "waiting" : "unavailable", message: device.catalogue ? WAITING : UNAVAILABLE, bodyGender: null, revision: 0, listed: 0, categories: 0 };
    this.unsubscribe = stage.subscribe(() => this.follow());
    void this.loadPreferences();
    this.follow();
  }
  dispose() { this.unsubscribe(); this.generation++; this.listeners.clear(); }
  descriptors() { return structuredClone(POSE_LIBRARY_DESCRIPTORS); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(); }

  snapshot(): PoseLibraryState {
    const motion = this.stage.motion(), shown = motion?.snapshot();
    const current = shown?.pose ? { id: shown.pose.id, label: shown.pose.label, loading: shown.poseLoading } : null;
    return structuredClone({ catalogue: this.view, current, body: !shown ? "none" : shown.pose ? "pose" : shown.idle ? "idle" : "still",
      preferences: this.preferences, showFiltered: this.showFiltered, playable: this.playable() }) as PoseLibraryState;
  }
  /** The tree for a search (detached, cached per catalogue, preferences, outfit and search). */
  tree(query = ""): PoseTree {
    const worn = this.stage.wornTags();
    const key = JSON.stringify([this.view.revision, this.preferences.favourites, this.preferences.recent, worn, this.showFiltered, query]);
    if (this.treeCache?.key !== key) this.treeCache = { key, tree: buildPoseTree(this.catalogue, this.preferences, { query, wornTags: worn, showFiltered: this.showFiltered }) };
    return this.treeCache.tree;
  }
  /** One catalogue entry (detached), for the panel's details. */
  entry(id: string): PoseEntry | null { const entry = this.byId.get(id); return entry ? structuredClone(entry) : null; }

  private playable(): Capability {
    const motion = this.stage.motion();
    if (!motion) return refusal("not_ready", "Poses play on V once the 3D view is ready.");
    return motion.poseCapability();
  }

  capability(action: PoseLibraryAction): Capability {
    if (!action || !(action.kind in POSE_LIBRARY_DESCRIPTORS)) return refusal("invalid_value", "Unknown pose action.");
    switch (action.kind) {
      case "pose.select": {
        if (this.view.phase !== "ready") return refusal("not_ready", this.view.message || "The poses are still being read.");
        const entry = isPoseRecord(action.id) ? this.byId.get(action.id) : undefined;
        if (!entry) return refusal("invalid_value", "That pose isn't installed now.");
        const reason = entryUnavailable(entry);
        if (reason) return refusal("asset_unavailable", reason);
        return this.playable();
      }
      case "pose.clear": {
        const motion = this.stage.motion();
        if (!motion) return refusal("not_ready", "Poses play on V once the 3D view is ready.");
        if (action.to !== "still" && action.to !== "idle") return refusal("invalid_value", "Choose Still or the idle.");
        return motion.bodyCapability(action.to === "idle");
      }
      case "pose.favourite":
        if (!isPoseRecord(action.id) || typeof action.on !== "boolean") return refusal("invalid_value", "Unknown pose.");
        if (action.on && !this.byId.has(action.id) && !this.preferences.favourites.some(item => item.id === action.id))
          return refusal("invalid_value", "That pose isn't installed now.");
        return this.device.preferences ? { available: true } : refusal("unavailable", "Favourites can't be kept on this host.");
      case "pose.frame": return this.stage.frameCapability();
      case "pose.showFiltered": return typeof action.shown === "boolean" ? { available: true } : refusal("invalid_value", "Show or hide them.");
      case "pose.openGroup":
        return isPoseRecord(action.group) && typeof action.open === "boolean" ? { available: true } : refusal("invalid_value", "Unknown group.");
      case "pose.retry":
        return this.view.phase === "failed" ? { available: true } : refusal("invalid_value", "The poses were read; nothing to try again.");
    }
  }

  async dispatch(action: PoseLibraryAction): Promise<PoseLibraryOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "invalid_value", message: allowed.reason ?? "That can't be done now." };
    switch (action.kind) {
      case "pose.select": return this.select(this.byId.get(action.id)!, true);
      case "pose.clear":
        this.stage.motion()!.setBody(action.to === "idle");
        this.notify();
        return { ok: true };
      case "pose.favourite": {
        const entry = this.byId.get(action.id), known = this.preferences.favourites.find(item => item.id === action.id);
        const ref = { id: action.id, label: entry?.label ?? known?.label ?? action.id };
        this.setPreferences(prefs => withFavourite(prefs, ref, action.on));
        return { ok: true };
      }
      case "pose.frame": {
        const framed = this.stage.frame();
        return framed.available ? { ok: true } : { ok: false, code: framed.code ?? "not_ready", message: framed.reason ?? "V can't be framed now." };
      }
      case "pose.showFiltered": this.showFiltered = action.shown; this.notify(); return { ok: true };
      case "pose.openGroup": this.setPreferences(prefs => withOpen(prefs, action.group, action.open)); return { ok: true };
      case "pose.retry": {
        const gender = this.view.bodyGender;
        if (!gender || !this.device.catalogue) return { ok: false, code: "unavailable", message: UNAVAILABLE };
        try { await this.device.catalogue({ method: "POST", body: { kind: "retry", bodyGender: gender } }); } catch { /* the poll says so */ }
        this.loadingFor = null;
        this.follow(true);
        return { ok: true };
      }
    }
  }

  /** Apply a pose: shown at once, played when its clip arrives; `recent` records it (a restored pose isn't a new choice). */
  private async select(entry: PoseEntry, recent: boolean): Promise<PoseLibraryOutcome> {
    const motion = this.stage.motion()!;
    if (recent) { const ref = { id: entry.id, label: entry.label }; this.setPreferences(prefs => withRecent(prefs, ref)); }
    try {
      await motion.holdPose({ id: entry.id, label: entry.label, moves: entry.badges.includes("moves") }, this.sample(entry),
        { offset: [...entry.placement.offset] as [number, number, number], rotation: [...entry.placement.rotation] as [number, number, number] });
      return { ok: true };
    } catch (error) {
      return { ok: false, code: "asset_unavailable", message: (error as Error)?.message || "That pose couldn't be played. Try another." };
    } finally { this.notify(); }
  }
  /** One pose's clip from the host, decoded on demand and kept for the session (a failed read is asked again next time). */
  private sample(entry: PoseEntry): Promise<PoseSample> {
    const gender = this.view.bodyGender!, key = `${gender}|${entry.id}`;
    const known = this.samples.get(key);
    if (known) return known;
    const pending = (async () => {
      let response: Awaited<ReturnType<PoseTransport>>;
      try { response = await this.device.catalogue!({ method: "GET", query: { gender, pose: entry.id } }); }
      catch { throw Error(UNREACHABLE); }
      const data = response.data as { schema?: string; error?: string } | null;
      if (!response.ok || data?.schema !== SAMPLE_SCHEMA) throw Error(data?.error ?? "That pose's animation couldn't be read from your game.");
      return data as unknown as PoseSample;
    })();
    this.samples.set(key, pending);
    pending.catch(() => this.samples.delete(key));
    for (const old of [...this.samples.keys()].slice(0, Math.max(0, this.samples.size - SAMPLE_CACHE))) this.samples.delete(old);
    return pending;
  }

  /** Follow the stage: load the catalogue for V's body gender, restore a stored pose, and republish. */
  private follow(force = false) {
    const gender = this.stage.bodyGender();
    if (gender && this.device.catalogue && (force || gender !== this.loadingFor)) void this.load(gender);
    this.restore();
    this.notify();
  }
  private async load(gender: PoseBodyGender) {
    this.loadingFor = gender;
    const generation = ++this.generation;
    if (this.view.bodyGender !== gender) { this.catalogue = null; this.byId.clear(); }
    for (let attempt = 0; generation === this.generation; attempt++) {
      let state: PoseCatalogueState | null = null;
      try {
        const response = await this.device.catalogue!({ method: "GET", query: { gender } });
        const data = response.data as { schema?: string } | null;
        state = data?.schema === STATE_SCHEMA ? data as unknown as PoseCatalogueState : null;
      } catch { state = null; }
      if (generation !== this.generation) return;
      if (!state) { this.publishView({ phase: "failed", message: UNREACHABLE, bodyGender: gender }); return; }
      if (state.phase === "ready") {
        this.catalogue = state.catalogue;
        this.byId.clear();
        for (const entry of state.catalogue.entries) this.byId.set(entry.id, entry);
        this.publishView({ phase: "ready", message: "", bodyGender: gender, listed: state.catalogue.counts.listed, categories: state.catalogue.counts.categories });
        this.restore();
        return;
      }
      this.publishView({ phase: state.phase, message: state.message, bodyGender: gender });
      if (state.phase !== "preparing") { this.restore(); return; }
      await (this.device.wait ?? (ms => new Promise(done => setTimeout(done, ms))))(POLL_MS);
    }
  }
  private publishView(next: Partial<PoseCatalogueView> & Pick<PoseCatalogueView, "phase" | "message" | "bodyGender">) {
    this.view = { listed: 0, categories: 0, ...next, revision: this.view.revision + 1 };
    this.treeCache = null;
    this.notify();
  }
  /** A pose the workspace stored plays again once it can, or is dropped when it can't. */
  private restore() {
    const motion = this.stage.motion(), pending = motion?.pendingPose();
    if (!motion || !pending || this.restoring) return;
    if (this.view.phase === "waiting" || this.view.phase === "preparing") return;
    const entry = this.view.phase === "ready" ? this.byId.get(pending.id) : undefined;
    if (!entry || entryUnavailable(entry) || !motion.poseCapability().available) { motion.dropPendingPose(); return; }
    this.restoring = true;
    void this.select(entry, false).finally(() => { this.restoring = false; });
  }

  private loadPreferences(): Promise<void> {
    if (!this.device.preferences) return Promise.resolve();
    return this.loadingPreferences ??= this.readPreferences().finally(() => { this.loadingPreferences = null; });
  }
  private async readPreferences() {
    try {
      const state = await this.device.preferences!.load() as { revision?: unknown; preferences?: unknown } | null;
      if (state && Number.isInteger(state.revision)) {
        this.preferencesRevision = state.revision as number;
        // Changes made before the document arrived go on top of it, never over it.
        this.preferences = this.applyPending(parsePosePreferences(state.preferences));
        this.treeCache = null;
        this.notify();
        if (this.pendingPreferences.length) void this.save();
      }
    } catch { /* Favourites stay for this session; the next change reads the document again. */ }
  }
  private applyPending(base: PosePreferences, also: readonly ((prefs: PosePreferences) => PosePreferences)[] = []): PosePreferences {
    return [...also, ...this.pendingPreferences].reduce((prefs, change) => change(prefs), base);
  }
  private setPreferences(change: (prefs: PosePreferences) => PosePreferences) {
    this.preferences = change(this.preferences);
    this.pendingPreferences.push(change);
    this.treeCache = null;
    this.notify();
    void this.save();
  }
  private async save() {
    const store = this.device.preferences;
    if (!store || this.saving || !this.pendingPreferences.length) return;
    // Not loaded yet (or the load failed): read it first; the load saves what is waiting.
    if (this.preferencesRevision === null) { void this.loadPreferences(); return; }
    this.saving = true;
    const sent = this.pendingPreferences.splice(0);
    let failed = false;
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await store.save(this.preferencesRevision!, this.preferences);
        const data = response.data as { revision?: unknown; preferences?: unknown } | null;
        if (data && Number.isInteger(data.revision)) this.preferencesRevision = data.revision as number;
        if (response.ok) break;
        // Another window saved first, or the host restarted: its document is the newest, and this window's changes go on top of it,
        // written once more.
        if (response.status === 409 && data) {
          this.preferences = this.applyPending(parsePosePreferences(data.preferences), sent);
          this.treeCache = null;
          this.notify();
          if (attempt === 0) continue;
        }
        failed = true;
        break;
      }
    } catch { failed = true; } finally {
      this.saving = false;
      // A failed write is tried again with the next change, never in a loop.
      if (failed) this.pendingPreferences.unshift(...sent);
      else if (this.pendingPreferences.length) setTimeout(() => void this.save(), 0);
    }
  }
}
