/**
 * Read-only application actions over the host's photo-mode pose catalogue (pose-catalogue-server.ts), the typed seam the Poses panel will
 * use (pose-library-design.md §7, phase P3). They read the host's own game files on its own launch route and never change a recipe, the
 * library, the workspace or Undo; the page names only a body gender and a pose record.
 */
import type { PoseBodyGender, PoseCatalogueState, PoseSample } from "./pose-catalogue";
import { POSE_DESCRIPTORS } from "./studio-action-descriptors";

export type PoseAction = { kind: "poses.load"; bodyGender: PoseBodyGender } | { kind: "poses.sample"; bodyGender: PoseBodyGender; id: string }
  | { kind: "poses.retry"; bodyGender: PoseBodyGender };
export type PoseActionState = {
  busy: PoseAction["kind"] | null;
  /** The latest catalogue state per body gender. */
  catalogue: Partial<Record<PoseBodyGender, PoseCatalogueState>>;
  /** The latest sampled pose. */
  sample: PoseSample | null;
  error?: string;
};
export type PoseOutcome = { ok: true } | { ok: false; code: string; message: string };
export type PoseTransport = (request: { method: "GET"; query: Record<string, string> } | { method: "POST"; body: { kind: "retry"; bodyGender: PoseBodyGender } }) =>
  Promise<{ ok: boolean; status: number; data: unknown }>;

const STATE_SCHEMA = "xfs/pose-catalogue-state-1", SAMPLE_SCHEMA = "xfs/pose-sample-1";
const genders = new Set<string>(["female", "male"]);

export class PoseActions {
  private state: PoseActionState = { busy: null, catalogue: {}, sample: null };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly transport: PoseTransport | null) {}
  descriptors() { return structuredClone(POSE_DESCRIPTORS); }
  snapshot(): Readonly<PoseActionState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(state: PoseActionState) { this.state = state; for (const listener of this.listeners) listener(); }

  capability(action: PoseAction): { available: boolean; reason?: string } {
    if (!(action?.kind in POSE_DESCRIPTORS)) return { available: false, reason: "Unknown pose action." };
    if (!genders.has(action.bodyGender)) return { available: false, reason: "Unknown body type." };
    if (!this.transport) return { available: false, reason: "Poses are unavailable on this host." };
    if (action.kind === "poses.sample") {
      const catalogue = this.state.catalogue[action.bodyGender];
      if (catalogue?.phase !== "ready") return { available: false, reason: "The poses are still being read." };
      const entry = catalogue.catalogue.entries.find(item => item.id === action.id);
      if (!entry) return { available: false, reason: "That pose isn't installed." };
      if (!entry.clip) return { available: false, reason: "That pose's animation isn't installed." };
      if (!entry.clip.decodable) return { available: false, reason: "That pose's animation is in a format XF Studio can't read yet." };
    }
    return { available: true };
  }

  async dispatch(action: PoseAction): Promise<PoseOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
    this.publish({ ...this.state, busy: action.kind, error: undefined });
    try {
      const response = await this.transport!(action.kind === "poses.retry" ? { method: "POST", body: { kind: "retry", bodyGender: action.bodyGender } }
        : { method: "GET", query: action.kind === "poses.sample" ? { gender: action.bodyGender, pose: action.id } : { gender: action.bodyGender } });
      const data = response.data as { schema?: string; code?: string; error?: string } | null;
      const expected = action.kind === "poses.sample" ? SAMPLE_SCHEMA : STATE_SCHEMA;
      if (!response.ok || data?.schema !== expected) {
        const message = data?.error ?? "The poses came back in a form this page doesn't read. Reload the page.";
        this.publish({ ...this.state, busy: null, error: message });
        return { ok: false, code: data?.code ?? "invalid_result", message };
      }
      if (action.kind === "poses.sample") this.publish({ ...this.state, busy: null, sample: data as unknown as PoseSample });
      else this.publish({ ...this.state, busy: null, catalogue: { ...this.state.catalogue, [action.bodyGender]: data as unknown as PoseCatalogueState } });
      return { ok: true };
    } catch {
      const message = "XF Studio couldn't reach its host to read the poses. Restart XF Studio and try again.";
      this.publish({ ...this.state, busy: null, error: message });
      return { ok: false, code: "unreachable", message };
    }
  }
}
