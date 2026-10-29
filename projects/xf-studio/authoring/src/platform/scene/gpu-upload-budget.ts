import { contextGeneration, inGeneration } from "./context-generation";
import { gpuGate } from "./gpu-gate";
import { observeGpuWork } from "./gpu-work";

/** At most 64 MiB of RGBA8 texels outstanding, across all uploaders on one renderer. */
export const UPLOAD_TEXELS = 16 * 1024 * 1024;
/** A caller stops waiting after this many frames; expiry must never grant upload credit. */
export const UPLOAD_WAIT_FRAMES = 120;
type Renderer = { getContext?(): unknown };
type Checkpoint = { gate: ReturnType<typeof gpuGate>; texels: number };

/**
 * A fence is a completion checkpoint, not one band's permission slip. Quiet contexts can report it 200–290 ms late. Allow several
 * bands in flight, sealing their combined cost at a frame boundary or when the window fills. Only completion returns that credit;
 * time passing never does. A separate barrier covers preceding non-map work (G2), initially and whenever the renderer submits more.
 */
function makeBudget(renderer: Renderer) {
  let generation = contextGeneration(renderer), used = 0, pending = 0;
  const checkpoints: Checkpoint[] = [];
  const barrier = gpuGate(renderer);
  barrier.mark();
  // Completion grants one burst. Keep work that arrived during the wait dirty for the following turn, without replacing its fence.
  let admission: "waiting" | "burst" | "open" = "waiting";
  let dirty = false;
  const stopObserving = observeGpuWork(renderer, () => { dirty = true; if (admission === "burst") admission = "open"; });
  const current = () => {
    if (inGeneration(renderer, generation)) return true;
    for (const entry of checkpoints) entry.gate.dispose();
    barrier.dispose();
    checkpoints.length = 0; used = pending = 0;
    generation = contextGeneration(renderer);
    if (generation.aborted) return false;
    barrier.mark(); admission = "waiting"; dirty = false;
    return true;
  };
  const collect = () => {
    while (checkpoints.length && checkpoints[0]!.gate.idle()) used -= checkpoints.shift()!.texels;
  };
  const checkpoint = () => {
    if (!current()) return;
    if (admission === "burst") admission = "open";
    if (!pending) return;
    collect();
    const gate = gpuGate(renderer);
    gate.mark();
    checkpoints.push({ gate, texels: pending });
    pending = 0;
  };
  return {
    canSend(texels: number): boolean {
      if (!current()) return false;
      // Never replace a pending barrier: a draw every frame would otherwise keep restarting its wait. Completion admits a burst even
      // with this frame's draw after the fence (as the former per-band gate allowed). Retain that dirty work for the next checkpoint;
      // new work during the burst closes it immediately. Map-only turns need no new admission barrier.
      if (admission === "open" && dirty) { barrier.mark(); admission = "waiting"; dirty = false; }
      if (admission === "waiting") {
        if (!barrier.idle()) return false;
        admission = "burst";
      }
      if (used + texels > UPLOAD_TEXELS) collect();
      if (used + texels <= UPLOAD_TEXELS) return true;
      checkpoint();
      // An indivisible fallback upload larger than the window goes alone, never alongside other outstanding uploads.
      return used === 0;
    },
    sent(texels: number): void {
      used += texels; pending += texels;
      if (used >= UPLOAD_TEXELS) checkpoint();
    },
    checkpoint,
    idle(): boolean {
      if (!current()) return false;
      // This drains maps, not subsequent non-map work. Morph rounds/warm-up have their own completion policy; they must not wait on
      // an additional map-admission barrier after every round.
      checkpoint(); collect();
      return checkpoints.length === 0;
    },
    dispose(): void {
      stopObserving();
      barrier.dispose();
      for (const entry of checkpoints) entry.gate.dispose();
      checkpoints.length = 0; used = pending = 0;
    },
  };
}

// Streaming parts, explicit detail preparation and runtime preparation share one window, not a window each. The last owner releases
// every fence. A context generation change discards its credit as well as its fences; no old completion can admit a new upload.
const budgets = new WeakMap<Renderer, { budget: ReturnType<typeof makeBudget>; owners: number }>();
export function acquireUploadBudget(renderer: Renderer) {
  let entry = budgets.get(renderer);
  if (!entry) { entry = { budget: makeBudget(renderer), owners: 0 }; budgets.set(renderer, entry); }
  entry.owners++;
  const shared = entry;
  let disposed = false;
  return {
    canSend: (texels: number) => !disposed && shared.budget.canSend(texels),
    sent: (texels: number) => { if (!disposed) shared.budget.sent(texels); },
    checkpoint: () => { if (!disposed) shared.budget.checkpoint(); },
    idle: () => !disposed && shared.budget.idle(),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--shared.owners === 0) { shared.budget.dispose(); budgets.delete(renderer); }
    },
  };
}
