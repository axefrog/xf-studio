/**
 * Part presets in the local library (part-preset-store.ts): a feature's part saved on its own under a name, listed per feature, renamed
 * and deleted. DOM-free: the library is reached through a transport the composition root gives. The requests are the `presets` family
 * (compose/system-families.ts), routed by the registry like the library's own requests; they never record Undo (a deleted preset is
 * gone from the library, as the person chose).
 */
import { refusal, type Capability, type PartEnvelope } from "./platform/api";

export type PartPresetRequest =
  | { kind: "partPreset.list"; feature: string }
  | { kind: "partPreset.save"; feature: string; name: string; part: PartEnvelope }
  | { kind: "partPreset.rename"; feature: string; id: string; name: string; revision: number }
  | { kind: "partPreset.delete"; feature: string; id: string; revision: number };
export type PartPreset = { id: string; feature: string; name: string; revision: number; part: PartEnvelope; updatedAt: string };
export type PartPresetList = { phase: "loading" | "ready" | "failed"; items: readonly PartPreset[]; reason?: string };
export type PartPresetOutcome = { ok: true; preset?: PartPreset } | { ok: false; code: string; message: string };
export interface PartPresetTransport {
  list(feature: string): Promise<PartPreset[]>;
  save(input: { feature: string; name: string; part: PartEnvelope }): Promise<PartPreset>;
  rename(id: string, input: { name: string; revision: number }): Promise<{ id: string; name: string; revision: number }>;
  delete(id: string, revision: number): Promise<{ id: string }>;
}
export const PART_PRESET_NAME_LIMIT = 120;

export class PartPresetService {
  private lists = new Map<string, PartPresetList>();
  private busy = false;
  private listeners = new Set<() => void>();
  constructor(private readonly transport: PartPresetTransport) {}
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
  capability(request: PartPresetRequest): Capability {
    if (typeof request.feature !== "string" || !request.feature) return refusal("invalid_value", "That kind of preset isn't known.");
    if (request.kind === "partPreset.list") return { available: true };
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
    return { available: true };
  }
  async execute(request: PartPresetRequest): Promise<PartPresetOutcome> {
    const allowed = this.capability(request);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "invalid_value", message: allowed.reason ?? "That can't be done." };
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
        const renamed = await this.transport.rename(request.id, { name: request.name.trim(), revision: request.revision });
        this.replace(request.feature, items => items.map(item => item.id === renamed.id ? { ...item, name: renamed.name, revision: renamed.revision } : item));
        return { ok: true };
      }
      await this.transport.delete(request.id, request.revision);
      this.replace(request.feature, items => items.filter(item => item.id !== request.id));
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
  private replace(feature: string, change: (items: readonly PartPreset[]) => PartPreset[]) {
    const items = change(this.lists.get(feature)?.items ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
    this.lists.set(feature, { phase: "ready", items });
  }
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
  };
}
