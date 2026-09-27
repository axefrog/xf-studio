/**
 * Part presets in the local library (part-preset-store.ts): a feature's part saved on its own under a name, listed per feature, renamed
 * and deleted. DOM-free: the library is reached through a transport the composition root gives. The requests are the `presets` family
 * (compose/system-families.ts), routed by the registry like the library's own requests; they never record Undo (a deleted preset is
 * gone from the library, as the person chose).
 */
import { modNameIssue, refusal, refusalOmissions, type Capability, type PackageBuildResult, type PackageCheckResult, type PartEnvelope } from "./platform/api";
import { setCollection, setMembers, type PartPresetSet, type PartPresetSetList, type PartPresetSetTable, type SetExportResult,
  type SetExportState } from "./part-preset-sets";

export type { PartPresetSet, PartPresetSetList, PartPresetSetTable, SetExportResult, SetExportState } from "./part-preset-sets";

export type PartPresetRequest =
  | { kind: "partPreset.list"; feature: string }
  | { kind: "partPreset.save"; feature: string; name: string; part: PartEnvelope }
  | { kind: "partPreset.rename"; feature: string; id: string; name: string; revision: number; part?: PartEnvelope }
  | { kind: "partPreset.delete"; feature: string; id: string; revision: number }
  /** Undo a delete made in this page: the preset back under its ID and in the sets it was in. */
  | { kind: "partPreset.restore"; feature: string; id: string }
  // Sets: a named, ordered list of saved presets, exported as one mod (part-preset-sets.ts).
  | { kind: "partPresetSet.list"; feature: string }
  | { kind: "partPresetSet.create"; feature: string; name: string; members?: string[] }
  | { kind: "partPresetSet.rename"; feature: string; id: string; name: string; revision: number }
  | { kind: "partPresetSet.setMembers"; feature: string; id: string; members: string[]; revision: number }
  | { kind: "partPresetSet.setExport"; feature: string; id: string; revision: number; modName?: string; table?: PartPresetSetTable }
  | { kind: "partPresetSet.delete"; feature: string; id: string; revision: number }
  | { kind: "partPresetSet.check"; feature: string; id: string }
  | { kind: "partPresetSet.build"; feature: string; id: string }
  | { kind: "partPresetSet.reveal"; feature: string; id: string };
export type PartPreset = { id: string; feature: string; name: string; revision: number; part: PartEnvelope; updatedAt: string };
export type PartPresetList = { phase: "loading" | "ready" | "failed"; items: readonly PartPreset[]; reason?: string };
export type PartPresetOutcome = { ok: true; preset?: PartPreset; set?: PartPresetSet } | { ok: false; code: string; message: string };
export interface PartPresetTransport {
  list(feature: string): Promise<PartPreset[]>;
  save(input: { feature: string; name: string; part: PartEnvelope }): Promise<PartPreset>;
  rename(id: string, input: { name: string; revision: number; part?: PartEnvelope }): Promise<{ id: string; name: string; revision: number; part?: PartEnvelope }>;
  delete(id: string, revision: number): Promise<{ id: string; restore?: PartPresetRestore }>;
  restore?(input: PartPresetRestore): Promise<PartPreset>;
  listSets(feature: string): Promise<PartPresetSet[]>;
  createSet(input: { feature: string; name: string; members?: string[] }): Promise<PartPresetSet>;
  updateSet(id: string, input: { revision: number; name?: string; members?: string[]; modName?: string; table?: PartPresetSetTable }): Promise<PartPresetSet>;
  deleteSet(id: string, revision: number): Promise<{ id: string }>;
}
/**
 * What a set's export reaches: the host's Check and Build (the same package route a collection uses) and Show in folder for a build.
 * Absent where the host can't build (then export says so).
 */
export interface SetExportTransport {
  package(action: "check" | "build", collection: unknown): Promise<PackageCheckResult | PackageBuildResult>;
  reveal(candidateId: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}
/** Most members a set holds. */
export const PART_PRESET_SET_MEMBERS = 500;
/** A provisional Check (the game files still being read) runs again after this long, at most this many times. */
export const PROVISIONAL_RECHECK_MS = 4000;
const PROVISIONAL_RECHECKS = 45;
export const PART_PRESET_NAME_LIMIT = 120;
/** What the library needs to put a deleted preset back (part-preset-store.ts `restore`). */
export type PartPresetRestore = { feature: string; id: string; name: string; part: PartEnvelope; createdAt: string; memberships: { set: string; index: number }[] };

export class PartPresetService {
  private lists = new Map<string, PartPresetList>();
  /** Deletes this page can undo, by preset ID. */
  private deleted = new Map<string, PartPresetRestore>();
  private setLists = new Map<string, PartPresetSetList>();
  private exports: SetExportState = { busy: null, results: {} };
  private busy = false;
  private listeners = new Set<() => void>();
  constructor(private readonly transport: PartPresetTransport, private readonly exporter?: SetExportTransport,
    private readonly options: { recheckMs?: number } = {}) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }

  /** A feature's presets (loaded on first ask). */
  snapshot(feature: string): PartPresetList {
    const known = this.lists.get(feature);
    if (known) return known;
    const loading: PartPresetList = { phase: "loading", items: [] };
    this.lists.set(feature, loading);
    void this.execute({ kind: "partPreset.list", feature });
    return loading;
  }
  /** A feature's sets (loaded on first ask). */
  sets(feature: string): PartPresetSetList {
    const known = this.setLists.get(feature);
    if (known) return known;
    const loading: PartPresetSetList = { phase: "loading", items: [] };
    this.setLists.set(feature, loading);
    void this.execute({ kind: "partPresetSet.list", feature });
    return loading;
  }
  /** Each set's latest Check or Build (dropped when the set is deleted), and what runs now. */
  exportState(): SetExportState { return this.exports; }
  private set(feature: string, id: string) { return this.setLists.get(feature)?.items.find(item => item.id === id); }
  capability(request: PartPresetRequest): Capability {
    if (typeof request.feature !== "string" || !request.feature) return refusal("invalid_value", "That kind of preset isn't known.");
    if (request.kind === "partPreset.list" || request.kind === "partPresetSet.list") return { available: true };
    if (request.kind.startsWith("partPresetSet.")) return this.setCapability(request);
    if (this.busy) return refusal("busy", "A preset change is being saved.");
    if (request.kind === "partPreset.save" || request.kind === "partPreset.rename") {
      const name = typeof request.name === "string" ? request.name.trim() : "";
      if (!name) return { available: false, code: "needs_input", reason: "Give the preset a name.", issue: { code: "name.blank", field: "name", message: "Give the preset a name." } };
      if (name.length > PART_PRESET_NAME_LIMIT) return { available: false, code: "limit", reason: `A preset name is at most ${PART_PRESET_NAME_LIMIT} characters.`,
        issue: { code: "name.too-long", field: "name", message: `A preset name is at most ${PART_PRESET_NAME_LIMIT} characters.` } };
    }
    if (request.kind === "partPreset.save" && (!request.part || typeof request.part.schema !== "string")) return refusal("invalid_value", "There is nothing to save.");
    if ((request.kind === "partPreset.rename" || request.kind === "partPreset.delete") &&
      !this.lists.get(request.feature)?.items.some(item => item.id === request.id)) return refusal("missing_target", "That preset no longer exists.");
    if (request.kind === "partPreset.restore" && (!this.deleted.has(request.id) || !this.transport.restore))
      return refusal("missing_target", "That can't be undone any more.");
    return { available: true };
  }
  private setCapability(request: PartPresetRequest): Capability {
    const nameIssue = (value: unknown) => {
      const name = typeof value === "string" ? value.trim() : "";
      if (!name) return { available: false, code: "needs_input" as const, reason: "Give the set a name.", issue: { code: "name.blank" as const, field: "name", message: "Give the set a name." } };
      if (name.length > PART_PRESET_NAME_LIMIT) return { available: false, code: "limit" as const, reason: `A set name is at most ${PART_PRESET_NAME_LIMIT} characters.`,
        issue: { code: "name.too-long" as const, field: "name", message: `A set name is at most ${PART_PRESET_NAME_LIMIT} characters.` } };
      return undefined;
    };
    if (request.kind === "partPresetSet.check" || request.kind === "partPresetSet.build" || request.kind === "partPresetSet.reveal") {
      const set = this.set(request.feature, request.id);
      if (!set) return refusal("missing_target", "That set no longer exists.");
      if (!this.exporter) return refusal("unavailable", "Making mod files isn't available here.");
      // A current Check found nothing to package: Build would refuse the same way, so it says why now.
      const checked = this.exports.results[set.id];
      if (request.kind === "partPresetSet.build" && checked?.kind === "failed" && checked.code === "no_exportable_content" && checked.revision === set.revision)
        return refusal("needs_input", "Nothing in this set can become mod files yet. Fix what Check listed, then check again.");
      if (this.exports.busy) return refusal("busy", this.exports.busy.action === "build" ? "A set's mod files are being built. Wait for it to finish."
        : "A set is being checked. Wait a moment.");
      if (request.kind === "partPresetSet.reveal") {
        const last = this.exports.results[set.id];
        return last?.kind === "build" && last.result.products.length ? { available: true } : refusal("missing_target", "Build this set's mod first.");
      }
      const presets = this.lists.get(request.feature)?.items ?? [];
      if (!setMembers(set, presets).some(member => member.preset))
        return refusal("needs_input", set.members.length ? "Every expression in this set was deleted from your library. Add saved expressions first."
          : "Add saved expressions to this set first.");
      return { available: true };
    }
    if (this.busy) return refusal("busy", "A change is being saved.");
    if (request.kind === "partPresetSet.create") return nameIssue(request.name) ?? { available: true };
    const set = this.set(request.feature, (request as { id: string }).id);
    if (!set) return refusal("missing_target", "That set no longer exists.");
    if (request.kind === "partPresetSet.rename") return nameIssue(request.name) ?? { available: true };
    if (request.kind === "partPresetSet.setMembers") {
      const members = request.members;
      if (!Array.isArray(members) || new Set(members).size !== members.length || members.some(id => typeof id !== "string"))
        return refusal("invalid_value", "That list of expressions can't be used.");
      if (members.length > PART_PRESET_SET_MEMBERS) return refusal("limit", `A set holds at most ${PART_PRESET_SET_MEMBERS} expressions.`);
    }
    if (request.kind === "partPresetSet.setExport") {
      const name = request.modName?.trim();
      const issue = name ? modNameIssue(name) : undefined;
      if (issue) return { available: false, code: "invalid_value", reason: issue, issue: { code: "format", field: "modName", message: issue } };
      if (request.table !== undefined && request.table !== "installed" && request.table !== "sharing") return refusal("invalid_value", "That table choice isn't known.");
    }
    return { available: true };
  }
  async execute(request: PartPresetRequest): Promise<PartPresetOutcome> {
    const allowed = this.capability(request);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "invalid_value", message: allowed.reason ?? "That can't be done." };
    if (request.kind.startsWith("partPresetSet.")) return this.executeSet(request);
    const mutate = request.kind !== "partPreset.list";
    if (mutate) { this.busy = true; this.notify(); }
    try {
      if (request.kind === "partPreset.list") {
        this.lists.set(request.feature, { phase: "ready", items: await this.transport.list(request.feature) });
        return { ok: true };
      }
      if (request.kind === "partPreset.save") {
        const preset = await this.transport.save({ feature: request.feature, name: request.name.trim(), part: request.part });
        this.replace(request.feature, items => [...items, preset]);
        return { ok: true, preset };
      }
      if (request.kind === "partPreset.rename") {
        const renamed = await this.transport.rename(request.id, { name: request.name.trim(), revision: request.revision, ...(request.part ? { part: request.part } : {}) });
        this.replace(request.feature, items => items.map(item => item.id === renamed.id
          ? { ...item, name: renamed.name, revision: renamed.revision, ...(renamed.part ? { part: renamed.part } : {}) } : item));
        return { ok: true };
      }
      if (request.kind === "partPreset.restore") {
        const preset = await this.transport.restore!(this.deleted.get(request.id)!);
        this.deleted.delete(request.id);
        this.replace(request.feature, items => [...items.filter(item => item.id !== preset.id), preset]);
        await this.reloadSets(request.feature);
        return { ok: true, preset };
      }
      if (request.kind !== "partPreset.delete") return { ok: false, code: "invalid_value", message: "Unknown command." };
      const removed = await this.transport.delete(request.id, request.revision);
      if (removed.restore) this.deleted.set(request.id, removed.restore);
      this.replace(request.feature, items => items.filter(item => item.id !== request.id));
      // Deleting a saved preset takes it out of its sets too (the library does both in one step).
      await this.reloadSets(request.feature);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Saved presets are unavailable right now.";
      if (request.kind === "partPreset.list") this.lists.set(request.feature, { phase: "failed", items: [], reason: message });
      return { ok: false, code: "unavailable", message };
    } finally {
      if (mutate) this.busy = false;
      this.notify();
    }
  }
  private async executeSet(request: PartPresetRequest): Promise<PartPresetOutcome> {
    if (request.kind === "partPresetSet.check" || request.kind === "partPresetSet.build") return this.runExport(request.feature, request.id, request.kind === "partPresetSet.build" ? "build" : "check");
    if (request.kind === "partPresetSet.reveal") {
      const last = this.exports.results[request.id];
      if (last?.kind !== "build") return { ok: false, code: "missing_target", message: "Build this set's mod first." };
      this.exports = { ...this.exports, busy: { id: request.id, action: "reveal" } }; this.notify();
      try {
        const candidate = last.result.products[0]!.package.split(/[\\/]/).pop()!;
        const outcome = await this.exporter!.reveal(candidate);
        return outcome.ok ? { ok: true } : outcome;
      } finally { this.exports = { ...this.exports, busy: null }; this.notify(); }
    }
    const mutate = request.kind !== "partPresetSet.list";
    if (mutate) { this.busy = true; this.notify(); }
    try {
      switch (request.kind) {
        case "partPresetSet.list":
          this.setLists.set(request.feature, { phase: "ready", items: await this.transport.listSets(request.feature) });
          return { ok: true };
        case "partPresetSet.create": {
          const set = await this.transport.createSet({ feature: request.feature, name: request.name.trim(), ...(request.members ? { members: request.members } : {}) });
          this.replaceSets(request.feature, items => [...items, set]);
          return { ok: true, set };
        }
        case "partPresetSet.delete":
          await this.transport.deleteSet(request.id, request.revision);
          this.replaceSets(request.feature, items => items.filter(item => item.id !== request.id));
          { const { [request.id]: _gone, ...results } = this.exports.results; this.exports = { ...this.exports, results }; }
          return { ok: true };
        default: {
          const change = request.kind === "partPresetSet.rename" ? { name: request.name.trim() }
            : request.kind === "partPresetSet.setMembers" ? { members: request.members }
            : request.kind === "partPresetSet.setExport" ? { ...(request.modName !== undefined ? { modName: request.modName.trim() } : {}), ...(request.table ? { table: request.table } : {}) }
            : {};
          const set = await this.transport.updateSet((request as { id: string }).id, { revision: (request as { revision: number }).revision, ...change });
          this.replaceSets(request.feature, items => items.map(item => item.id === set.id ? set : item));
          return { ok: true, set };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Saved sets are unavailable right now.";
      if (request.kind === "partPresetSet.list") this.setLists.set(request.feature, { phase: "failed", items: [], reason: message });
      return { ok: false, code: "unavailable", message };
    } finally {
      if (mutate) this.busy = false;
      this.notify();
    }
  }
  /** Check or Build one set: its package-only collection through the host's package route (never installs anything). */
  private async runExport(feature: string, id: string, action: "check" | "build", attempt = 0): Promise<PartPresetOutcome> {
    const set = this.set(feature, id)!, presets = this.lists.get(feature)?.items ?? [];
    const missing = setMembers(set, presets).filter(member => !member.preset).length;
    this.exports = { ...this.exports, busy: { id, action } }; this.notify();
    let entry: SetExportResult;
    try {
      const result = await this.exporter!.package(action, setCollection(set, presets));
      entry = action === "build" ? { kind: "build", result: result as PackageBuildResult, revision: set.revision, missing }
        : { kind: "check", result: result as PackageCheckResult, revision: set.revision, missing };
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      const omissions = refusalOmissions((error as { omissions?: unknown })?.omissions);
      entry = { kind: "failed", action, code: typeof code === "string" ? code : "package_failed",
        message: error instanceof Error ? error.message : "The request failed.", revision: set.revision, ...(omissions ? { omissions } : {}) };
    }
    this.exports = { busy: null, results: { ...this.exports.results, [id]: entry } };
    this.notify();
    // A Check made before the game files were read (they are read in the background) runs again by itself until they are.
    const provisional = entry.kind === "check" && entry.result.products.some(product => product.features.some(feature =>
      (feature.details as { provisional?: unknown }).provisional === true));
    if (provisional && attempt < PROVISIONAL_RECHECKS) setTimeout(() => {
      const now = this.set(feature, id);
      if (!now || now.revision !== set.revision || this.exports.busy || this.exports.results[id] !== entry) return;
      void this.runExport(feature, id, "check", attempt + 1);
    }, this.options.recheckMs ?? PROVISIONAL_RECHECK_MS);
    return entry.kind === "failed" ? { ok: false, code: entry.code, message: entry.message } : { ok: true };
  }
  /** Read a feature's sets again (a preset delete or restore changed their members), when they were read before. */
  private async reloadSets(feature: string) {
    if (!this.setLists.has(feature)) return;
    try { this.setLists.set(feature, { phase: "ready", items: await this.transport.listSets(feature) }); } catch { /* The next ask reads them. */ }
  }
  private replaceSets(feature: string, change: (items: readonly PartPresetSet[]) => PartPresetSet[]) {
    const items = change(this.setLists.get(feature)?.items ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
    this.setLists.set(feature, { phase: "ready", items });
  }
  private replace(feature: string, change: (items: readonly PartPreset[]) => PartPreset[]) {
    const items = change(this.lists.get(feature)?.items ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
    this.lists.set(feature, { phase: "ready", items });
  }
}

/** The browser's route for a set's export: the host's package route (Check and Build) and Show in folder of the mod-install route. */
export function setExportTransport(installEndpoint: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)): SetExportTransport {
  return {
    package: async (action, collection) => {
      const response = await fetcher("/api/package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, collection }) });
      const body = await response.json().catch(() => null) as { code?: string; error?: string; omissions?: unknown } | null;
      if (!response.ok || !body) throw Object.assign(Error(body?.error ?? "XF Studio couldn't reach its mod builder. Restart XF Studio and try again."),
        { code: body?.code ?? "package_failed", ...(refusalOmissions(body?.omissions) ? { omissions: refusalOmissions(body?.omissions) } : {}) });
      return body as unknown as PackageCheckResult | PackageBuildResult;
    },
    reveal: async candidateId => {
      const response = await fetcher(installEndpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reveal", candidateId }) });
      const body = await response.json().catch(() => null) as { code?: string; error?: string; message?: string } | null;
      return response.ok ? { ok: true } : { ok: false, code: body?.code ?? "reveal_failed", message: body?.error ?? body?.message ?? "XF Studio couldn't open that folder. Try again." };
    },
  };
}

/** The browser's transport to the library's part presets (`/api/part-presets`, or the verification workspace's own). */
export function partPresetTransport(prefix: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)): PartPresetTransport {
  const call = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetcher(url, init);
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw Error(body.error ?? "Saved presets are unavailable right now.");
    return body as T;
  };
  const send = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    list: feature => call(`${prefix}?feature=${encodeURIComponent(feature)}`, { cache: "no-store" }),
    save: input => call(prefix, send("POST", input)),
    rename: (id, input) => call(`${prefix}/${id}`, send("PATCH", input)),
    delete: (id, revision) => call(`${prefix}/${id}?revision=${revision}`, { method: "DELETE" }),
    restore: input => call(`${prefix}/restore`, send("POST", input)),
    listSets: feature => call(`${prefix}/sets?feature=${encodeURIComponent(feature)}`, { cache: "no-store" }),
    createSet: input => call(`${prefix}/sets`, send("POST", input)),
    updateSet: (id, input) => call(`${prefix}/sets/${id}`, send("PATCH", input)),
    deleteSet: (id, revision) => call(`${prefix}/sets/${id}?revision=${revision}`, { method: "DELETE" }),
  };
}
