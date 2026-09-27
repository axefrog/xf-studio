/**
 * The Save Explorer's application service (research/save/save-editor-design.md §8.1, phase 1): list the player's saves, open one
 * read-only, and answer the panel's questions (the node tree, a node, an object, the mod data) from detached read models. Typed actions
 * with capabilities; no DOM, file or network code: the host device (`SaveExplorerDevice`) lists, reads and picks, and the pure read model
 * (explorer.ts) decodes. Nothing here writes a save, and nothing is persisted: an open save lives only in memory.
 *
 * Long work yields between steps (`yieldToHost`): the container opens in one step, then each package and the world-object stream are
 * checked one at a time so the tree's decode status fills in without holding the page.
 */
import { refusal, type Capability, type ReasonCode } from "../../platform/api";
import { openExplorer, type EntryPage, type ModDataView, type NodeInspection, type ObjectInspection, type ObjectRef, type SaveExplorer, type SaveSummary,
  type TreeRow } from "./explorer";
import { parseSaveListing, parseSaveTypeNames, type SaveListing, type SaveTypeNames } from "./listing";

/**
 * The host device: the saves listing, a save's bytes, the file picker, name sources and screenshots. The listing and names arrive
 * unvalidated (`unknown`); the service validates them (listing.ts) before using them.
 */
export type SaveExplorerDevice = {
  list(): Promise<unknown>;
  read(folder: string): Promise<Uint8Array>;
  /** A save file chosen by the person (for saves outside the saves folder); undefined when they cancel. */
  pick(): Promise<{ name: string; bytes: Uint8Array } | undefined>;
  names(): Promise<unknown>;
  /** Where the view can load a listed save's screenshot from, or null. */
  thumbnail(folder: string): string | null;
};

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
  readonly listing: { readonly phase: Phase; readonly available: boolean; readonly saves: readonly SaveListing[]; readonly message?: string };
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

  constructor(private readonly device: SaveExplorerDevice | null,
    private readonly yieldToHost: () => Promise<void> = () => new Promise(done => setTimeout(done, 0))) {}

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
        return this.state.listing.phase === "loading" ? refusal("busy", "Your saves are being listed.") : { available: true };
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
        let picked: { name: string; bytes: Uint8Array } | undefined;
        try { picked = await this.device!.pick(); } catch { return { ok: false, code: "unavailable", message: "The file couldn't be read. Try again." }; }
        if (!picked) return { ok: true, message: "No file chosen." };
        return this.openBytes(picked.bytes, { kind: "file", name: picked.name });
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
    this.publish({ listing: { ...this.state.listing, phase: "loading" } });
    try {
      const result = parseSaveListing(await this.device!.list());
      this.publish({ listing: { phase: "ready", available: result.available, saves: result.saves, ...(result.reason ? { message: result.reason } : {}) } });
      return { ok: true };
    } catch {
      const message = "Your saves couldn't be listed. Check that XF Studio is still running, then choose Refresh.";
      this.publish({ listing: { ...this.state.listing, phase: "failed", message } });
      return { ok: false, code: "unavailable", message };
    }
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

  private async openBytes(bytes: Uint8Array, source: NonNullable<SaveExplorerState["open"]["source"]>, generation = ++this.generation): Promise<SaveExplorerOutcome> {
    // A later open or a close superseded this one while its bytes were read.
    if (generation !== this.generation) return { ok: true };
    if (bytes.byteLength > MAX_SAVE_BYTES) {
      const message = "That file is larger than any Cyberpunk 2077 save, so it wasn't opened.";
      this.publish({ open: { phase: "failed", source, message, checking: false } });
      return { ok: false, code: "limit", message };
    }
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
    // Fill in the tree's decode status one node at a time.
    for (const id of explorer.pending()) {
      await this.yieldToHost();
      if (generation !== this.generation) return { ok: true };
      explorer.check(id);
      this.publish({ revision: this.state.revision + 1 });
    }
    if (generation === this.generation) this.publish({ open: { ...this.state.open, checking: false }, revision: this.state.revision + 1 });
    return { ok: true };
  }
}
