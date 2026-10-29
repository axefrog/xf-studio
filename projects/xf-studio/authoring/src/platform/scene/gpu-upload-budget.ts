import { contextGeneration, inGeneration } from "./context-generation";
import { gpuGate } from "./gpu-gate";

/** At most 64 MiB of RGBA8 texels outstanding, across all uploaders on one renderer. */
export const UPLOAD_TEXELS = 16 * 1024 * 1024;
/** A caller stops waiting after this many frames; expiry must never grant upload credit. */
export const UPLOAD_WAIT_FRAMES = 120;
type Renderer = { getContext?(): unknown };
type Checkpoint = { gate: ReturnType<typeof gpuGate>; texels: number };

/**
 * A fence is a completion checkpoint, not one band's permission slip. Quiet contexts can report it 200–290 ms late. Allow several
 * bands in flight, sealing their combined cost at a frame boundary or when the window fills. Only completion returns that credit;
 * time passing never does. An opening fence keeps the first upload behind preceding GPU-process work (G2), too.
 */
function makeBudget(renderer: Renderer) {
  let generation = contextGeneration(renderer), used = 0, pending = 0;
  const checkpoints: Checkpoint[] = [];
  const opening = () => {
    const gate = gpuGate(renderer);
    gate.mark();
    checkpoints.push({ gate, texels: 0 });
  };
  opening();
  const current = () => {
    if (inGeneration(renderer, generation)) return true;
    for (const entry of checkpoints) entry.gate.dispose();
    checkpoints.length = 0; used = pending = 0;
    generation = contextGeneration(renderer);
    if (generation.aborted) return false;
    opening();
    return true;
  };
  const collect = () => {
    while (checkpoints.length && checkpoints[0]!.gate.idle()) used -= checkpoints.shift()!.texels;
  };
  const checkpoint = () => {
    if (!current() || !pending) return;
    collect();
    const gate = gpuGate(renderer);
    gate.mark();
    checkpoints.push({ gate, texels: pending });
    pending = 0;
  };
  return {
    canSend(texels: number): boolean {
      if (!current()) return false;
      // The zero-cost opening checkpoint must pass even when the window has room.
      if (checkpoints[0]?.texels === 0 || used + texels > UPLOAD_TEXELS) collect();
      if (checkpoints[0]?.texels === 0) return false;
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
      checkpoint(); collect();
      return checkpoints.length === 0;
    },
    dispose(): void {
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
