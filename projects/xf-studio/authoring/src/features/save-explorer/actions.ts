/**
 * The Save Explorer's application service (research/save/save-editor-design.md §8.1, phase 1): list the player's saves, open one
 * read-only, and answer the panel's questions (the node tree, a node, an object, the mod data) from detached read models. Typed actions
 * with capabilities; no DOM, file or network code: the host device (`SaveExplorerDevice`) lists, reads and picks, and the pure read model
 * (explorer.ts) decodes. Nothing here writes a save, and nothing is persisted: an open save lives only in memory.
 *
 * Long work yields between steps (`yieldToHost`): the container opens in one step, then each package is checked in one step and the
 * world-object stream in bounded steps (SAVE-06), so the tree's decode status fills in without holding the page.
 *
 * A listing that fails is tried again after a short wait (`retryDelays`), saying "Reconnecting…" meanwhile: the host may be restarting.
 * Only when every try fails is the failure shown, in plain words (UI-109). Refresh during the waits tries again at once.
 */
import { refusal, type Capability, type ReasonCode } from "../../platform/api";
import { openExplorer, type EntryPage, type ModDataView, type NodeInspection, type ObjectInspection, type ObjectRef, type SaveExplorer, type SaveSummary,
  type TreeRow } from "./explorer";
import { parseSaveListing, parseSaveTypeNames, type SaveListing, type SavesFolder, type SaveTypeNames } from "./listing";

/**
 * The host device: the saves listing, a save's bytes, the file picker, name sources and screenshots. The listing and names arrive
 * unvalidated (`unknown`); the service validates them (listing.ts) before using them.
 */
export type SaveExplorerDevice = {
  list(): Promise<unknown>;
  read(folder: string): Promise<Uint8Array>;
  /**
   * A save file chosen by the person (for saves outside the saves folder), undefined when they cancel: its name and size, and its bytes
   * read only when asked (the service checks the size first; SAVE-08).
   */
  pick(): Promise<PickedSave | undefined>;
  names(): Promise<unknown>;
  /** Where the view can load a listed save's screenshot from, or null. */
  thumbnail(folder: string): string | null;
  /** Calls the listener when the saves folder chosen in Settings changes (the list is read again); returns how to stop. */
  locationChanged?(listener: () => void): () => void;
};

export type PickedSave = { readonly name: string; readonly size: number; bytes(): Promise<Uint8Array> };
export type SaveExplorerView = "nodes" | "mods";
export type SaveExplorerAction =
  | { kind: "saves.refresh" }
  | { kind: "saves.open"; folder: string }
  | { kind: "saves.openFile" }
  | { kind: "saves.close" }
  | { kind: "saves.selectNode"; node: number }
  | { kind: "saves.inspect"; ref: ObjectRef | null }
  | { kind: "saves.setView"; view: SaveExplorerView };
export type SaveExplorerOutcome = { ok: true; message?: string } | { ok: false; code: ReasonCode; message: string };

type Phase = "idle" | "loading" | "ready" | "failed";
export type SaveExplorerState = {
  readonly listing: { readonly phase: Phase; readonly available: boolean; readonly saves: readonly SaveListing[]; readonly message?: string;
    /** The folder the last listing read, as a person would name it. */
    readonly folder?: SavesFolder;
    /** A try failed and another follows shortly (the host may be restarting). */
    readonly reconnecting?: boolean };
  readonly names: { readonly phase: Phase; readonly scripts: boolean; readonly message?: string };
  readonly open: { readonly phase: "none" | "loading" | "ready" | "failed"; readonly source?: { readonly kind: "listed"; readonly folder: string } |
    { readonly kind: "file"; readonly name: string }; readonly message?: string; readonly summary?: SaveSummary; readonly checking: boolean };
  readonly selection: { readonly node: number | null; readonly object: ObjectRef | null; readonly view: SaveExplorerView };
  /** Changes whenever the tree's decode status or the open save changes. */
  readonly revision: number;
};

/** The catalogue entries of the explorer's actions (research/authoring/ui-action-catalogue.md): all read-only, none recorded in Undo. */
export const SAVE_EXPLORER_DESCRIPTORS = Object.freeze({
  "saves.refresh": { scope: "saves", effect: "read", async: true, undo: "none", payload: {} },
  "saves.open": { scope: "save", effect: "read", async: true, undo: "none", payload: { folder: "text" } },
  "saves.openFile": { scope: "saves", effect: "read", async: true, device: "picker", undo: "none", payload: {} },
  "saves.close": { scope: "save", effect: "view", async: false, undo: "none", payload: {} },
  "saves.selectNode": { scope: "save", effect: "view", async: false, undo: "none", payload: { node: "index" } },
  "saves.inspect": { scope: "save", effect: "view", async: false, undo: "none", payload: { ref: "object" } },
  "saves.setView": { scope: "save", effect: "view", async: false, undo: "none", payload: { view: "choice" } },
} as const satisfies Record<SaveExplorerAction["kind"], { scope: string; effect: string; async: boolean; undo: "none"; payload: object; device?: string }>);

/** Largest save the explorer opens (saves are 1–10 MB). */
export const MAX_SAVE_BYTES = 128 * 1024 * 1024;
/** The waits before each further try of a failed listing: six tries over about fifteen seconds, enough for the host to restart and rebuild. */
export const LISTING_RETRY_DELAYS: readonly number[] = [500, 1000, 2000, 4000, 8000];
const initial = (): SaveExplorerState => ({ listing: { phase: "idle", available: false, saves: [] }, names: { phase: "idle", scripts: false },
  open: { phase: "none", checking: false }, selection: { node: null, object: null, view: "nodes" }, revision: 0 });

export class SaveExplorerActions {
  private state: SaveExplorerState = initial();
  private listeners = new Set<() => void>();
  private explorer: SaveExplorer | null = null;
  private names: SaveTypeNames | null = null;
  private namesRequest: Promise<SaveTypeNames | null> | null = null;
  /** Bumped by every open and close, so a slower earlier open never publishes over a later one. */
  private generation = 0;
  /** Bumped by every listing, so a try still waiting to repeat stops once a newer one starts. */
  private listGeneration = 0;
  private readonly retryDelays: readonly number[];
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly device: SaveExplorerDevice | null,
    private readonly yieldToHost: () => Promise<void> = () => new Promise(done => setTimeout(done, 0)),
    options: { retryDelays?: readonly number[]; wait?: (ms: number) => Promise<void> } = {}) {
    this.retryDelays = options.retryDelays ?? LISTING_RETRY_DELAYS;
    this.wait = options.wait ?? (ms => new Promise(done => setTimeout(done, ms)));
    // A saves folder chosen in Settings: a list already read is read again from the new folder.
    device?.locationChanged?.(() => { if (this.state.listing.phase !== "idle") void this.refresh(); });
  }

  descriptors() { return structuredClone(SAVE_EXPLORER_DESCRIPTORS); }
  snapshot(): SaveExplorerState { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(next: Partial<SaveExplorerState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  capability(action: SaveExplorerAction): Capability {
    if (!action || !(action.kind in SAVE_EXPLORER_DESCRIPTORS)) return refusal("invalid_value", "That isn't a Save Explorer command.");
    const open = this.state.open;
    switch (action.kind) {
      case "saves.refresh":
        if (!this.device) return refusal("unavailable", "Listing saves isn't available here.");
        // While a failed try waits to repeat, Refresh tries again at once.
        return this.state.listing.phase === "loading" && !this.state.listing.reconnecting ? refusal("busy", "Your saves are being listed.") : { available: true };
      case "saves.open":
        if (!this.device) return refusal("unavailable", "Opening saves isn't available here.");
        if (typeof action.folder !== "string" || !this.state.listing.saves.some(save => save.folder === action.folder))
          return refusal("missing_target", "That save isn't in the list. Refresh the list and choose it again.");
        return open.phase === "loading" ? refusal("busy", "A save is opening.") : { available: true };
      case "saves.openFile":
        if (!this.device) return refusal("unavailable", "Opening saves isn't available here.");
        return open.phase === "loading" ? refusal("busy", "A save is opening.") : { available: true };
      case "saves.close": return open.phase === "none" ? refusal("missing_target", "No save is open.") : { available: true };
      case "saves.selectNode":
        return this.explorer && Number.isInteger(action.node) && this.explorer.save.nodes[action.node] ? { available: true }
          : refusal("missing_target", "That node isn't in the open save.");
      case "saves.inspect":
        if (action.ref === null) return { available: true };
        return this.explorer && this.validRef(action.ref) ? { available: true } : refusal("missing_target", "That object isn't in the open save.");
      case "saves.setView":
        return action.view === "nodes" || action.view === "mods" ? { available: true } : refusal("invalid_value", "Choose Nodes or Mod data.");
    }
  }

  async dispatch(action: SaveExplorerAction): Promise<SaveExplorerOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "invalid_value", message: allowed.reason ?? "That can't be done now." };
    switch (action.kind) {
      case "saves.refresh": return this.refresh();
      case "saves.open": return this.openListed(action.folder);
      case "saves.openFile": {
        let picked: PickedSave | undefined;
        try { picked = await this.device!.pick(); } catch { return { ok: false, code: "unavailable", message: "The file couldn't be read. Try again." }; }
        if (!picked) return { ok: true, message: "No file chosen." };
        const source = { kind: "file" as const, name: picked.name };
        // Refused by its size before anything is read (SAVE-08).
        if (!(picked.size <= MAX_SAVE_BYTES)) { this.generation++; return this.tooLarge(source); }
        let bytes: Uint8Array;
        try { bytes = await picked.bytes(); } catch { return { ok: false, code: "unavailable", message: "The file couldn't be read. Try again." }; }
        return this.openBytes(bytes, source);
      }
      case "saves.close":
        this.generation++; this.explorer = null;
        this.publish({ open: { phase: "none", checking: false }, selection: { node: null, object: null, view: this.state.selection.view }, revision: this.state.revision + 1 });
        return { ok: true };
      case "saves.selectNode":
        this.publish({ selection: { ...this.state.selection, node: action.node, object: null } });
        return { ok: true };
      case "saves.inspect":
        this.publish({ selection: { ...this.state.selection, object: action.ref ? structuredClone(action.ref) : null } });
        return { ok: true };
      case "saves.setView":
        this.publish({ selection: { ...this.state.selection, view: action.view } });
        return { ok: true };
    }
  }

  // ---- Detached reads for the panel ----
  tree(): readonly TreeRow[] { return this.explorer ? structuredClone(this.explorer.tree()) : []; }
  node(id: number): NodeInspection | undefined {
    const found = this.explorer?.node(id);
    return found ? structuredClone(found) : undefined;
  }
  entries(offset: number, limit: number, filter = ""): EntryPage { return this.explorer ? structuredClone(this.explorer.entries(offset, limit, filter)) : { rows: [], total: 0, offset: 0 }; }
  object(ref: ObjectRef): ObjectInspection | undefined {
    if (!this.explorer || !this.validRef(ref)) return undefined;
    const found = this.explorer.object(ref);
    return found ? structuredClone(found) : undefined;
  }
  modData(): ModDataView | undefined { return this.explorer ? structuredClone(this.explorer.modData()) : undefined; }
  thumbnail(folder: string): string | null { return this.device && this.state.listing.saves.some(save => save.folder === folder && save.screenshot) ? this.device.thumbnail(folder) : null; }

  private validRef(ref: ObjectRef) {
    const explorer = this.explorer;
    if (!explorer || !ref || !Number.isInteger(ref.node) || !Number.isInteger(ref.index) || ref.index < 0) return false;
    const inspection = explorer.save.nodes[ref.node];
    return !!inspection && (ref.kind === "chunk" || ref.kind === "entry");
  }

  private async refresh(): Promise<SaveExplorerOutcome> {
    const generation = ++this.listGeneration;
    this.publish({ listing: { ...this.state.listing, phase: "loading", reconnecting: false } });
    for (let attempt = 0; ; attempt++) {
      try {
        const result = parseSaveListing(await this.device!.list());
        if (generation !== this.listGeneration) return { ok: true };
        this.publish({ listing: { phase: "ready", available: result.available, saves: result.saves, ...(result.reason ? { message: result.reason } : {}),
          ...(result.folder ? { folder: result.folder } : {}) } });
        return { ok: true };
      } catch {
        if (generation !== this.listGeneration) return { ok: true };
        const delay = this.retryDelays[attempt];
        if (delay === undefined) break;
        // Most often the host is restarting: say so, and try again shortly.
        this.publish({ listing: { ...this.state.listing, phase: "loading", reconnecting: true } });
        await this.wait(delay);
        if (generation !== this.listGeneration) return { ok: true };
      }
    }
    const message = "XF Studio couldn't list your saves just now. Choose Refresh to try again.";
    this.publish({ listing: { ...this.state.listing, phase: "failed", reconnecting: false, message } });
    return { ok: false, code: "unavailable", message };
  }

  /** The name sources, fetched once; without them the save still opens, with hashes where names would be. */
  private ensureNames(): Promise<SaveTypeNames | null> {
    if (this.names) return Promise.resolve(this.names);
    if (this.namesRequest) return this.namesRequest;
    this.publish({ names: { phase: "loading", scripts: false } });
    this.namesRequest = this.device!.names().then(parseSaveTypeNames).then(names => {
      this.names = names;
      this.publish({ names: { phase: "ready", scripts: names.scripts.available, ...(names.scripts.reason ? { message: names.scripts.reason } : {}) } });
      return names;
    }, () => {
      this.namesRequest = null;
      this.publish({ names: { phase: "failed", scripts: false, message: "Type names couldn't be loaded, so names show as numbers." } });
      return null;
    });
    return this.namesRequest;
  }

  private async openListed(folder: string): Promise<SaveExplorerOutcome> {
    const generation = ++this.generation;
    this.publish({ open: { phase: "loading", source: { kind: "listed", folder }, checking: false } });
    let bytes: Uint8Array;
    try { bytes = await this.device!.read(folder); }
    catch {
      if (generation !== this.generation) return { ok: true };
      const message = "That save couldn't be read. Refresh the list; if it's still there, try again.";
      this.publish({ open: { phase: "failed", source: { kind: "listed", folder }, message, checking: false } });
      return { ok: false, code: "unavailable", message };
    }
    return this.openBytes(bytes, { kind: "listed", folder }, generation);
  }

  private tooLarge(source: NonNullable<SaveExplorerState["open"]["source"]>): SaveExplorerOutcome {
    const message = "That file is larger than any Cyberpunk 2077 save, so it wasn't opened.";
    this.publish({ open: { phase: "failed", source, message, checking: false } });
    return { ok: false, code: "limit", message };
  }

  private async openBytes(bytes: Uint8Array, source: NonNullable<SaveExplorerState["open"]["source"]>, generation = ++this.generation): Promise<SaveExplorerOutcome> {
    // A later open or a close superseded this one while its bytes were read.
    if (generation !== this.generation) return { ok: true };
    if (bytes.byteLength > MAX_SAVE_BYTES) return this.tooLarge(source);
    this.publish({ open: { phase: "loading", source, checking: false } });
    const names = await this.ensureNames();
    await this.yieldToHost();
    if (generation !== this.generation) return { ok: true };
    let explorer: SaveExplorer;
    try { explorer = openExplorer(bytes, { engine: names?.engine ?? null, scripts: names?.scripts.available ? names.scripts.names : null }); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const message = `This file couldn't be opened as a Cyberpunk 2077 save${detail ? ` (${detail})` : ""}.`;
      this.publish({ open: { phase: "failed", source, message, checking: false } });
      return { ok: false, code: "invalid_value", message };
    }
    this.explorer = explorer;
    const first = explorer.save.roots[0] ?? null;
    this.publish({ open: { phase: "ready", source, summary: explorer.summary(), checking: true },
      selection: { node: first, object: null, view: this.state.selection.view }, revision: this.state.revision + 1 });
    // Fill in the tree's decode status one node at a time, each in bounded steps (the world objects take several).
    for (const id of explorer.pending()) {
      let done = false;
      while (!done) {
        await this.yieldToHost();
        if (generation !== this.generation) return { ok: true };
        done = explorer.checkStep(id);
        this.publish({ revision: this.state.revision + 1 });
      }
    }
    if (generation === this.generation) this.publish({ open: { ...this.state.open, checking: false }, revision: this.state.revision + 1 });
    return { ok: true };
  }
}
