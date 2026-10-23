import { contextGeneration } from "./context-generation";

/**
 * Whether the GPU process has caught up with what the page sent before the last `mark` (a fence), asked without waiting (profiles phase
 * 4a-v-b). An upload sent while the GPU process is busy (building a shader at a draw, seconds at a time on ANGLE) waits inside the call
 * for room to pass its texels: a 1024² map's upload took 141 ms of the page's thread that way (G2). A caller that marks after each upload
 * and sends the next only once the gate is idle waits a frame instead. Without fences (WebGL 1, test stand-ins) it is always idle.
 *
 * The fence belongs to the context generation it was made in (context-generation.ts): once that generation ends the gate is idle and the
 * fence is forgotten (a lost context's objects went with it), and a status the context doesn't report (a fence it no longer knows) counts
 * as passed, so a loss and restore between two polls never leaves the gate closed. `dispose` deletes the last fence.
 */
export function gpuGate(renderer: { getContext?(): unknown }) {
  const gl = typeof renderer.getContext === "function" ? renderer.getContext() as WebGL2RenderingContext | undefined : undefined;
  const sync = gl && typeof gl.fenceSync === "function" ? gl : null;
  let fence: { made: WebGLSync; generation: AbortSignal } | null = null;
  const lost = () => !!sync && (sync.isContextLost?.() ?? false);
  /** Forget the fence, deleting it while its context lives. */
  const drop = () => {
    if (fence && sync && !fence.generation.aborted && !lost()) sync.deleteSync(fence.made);
    fence = null;
  };
  return {
    idle(): boolean {
      if (!sync || !fence) return true;
      if (fence.generation.aborted || lost()) { fence = null; return true; }
      if (sync.getSyncParameter(fence.made, sync.SYNC_STATUS) === sync.UNSIGNALED) return false;
      drop();
      return true;
    },
    mark(): void {
      if (!sync) return;
      drop();
      const generation = contextGeneration(renderer);
      if (generation.aborted) return;
      const made = sync.fenceSync(sync.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!made) return;
      fence = { made, generation };
      sync.flush();
    },
    /** Delete the last fence (the gate's owner is done with it, or going). */
    dispose: drop,
  };
}

/**
 * Wait, a frame at a time and never blocking, until the GPU has done what was sent so far, for at most `frames` frames (a fence never
 * holds a caller for good); `waiting` runs before each frame waited. Resolves with the frames waited; stops early once `signal` aborts.
 */
export async function gpuDrained(renderer: { getContext?(): unknown }, options: { frame(): Promise<void>; frames: number; signal?: AbortSignal;
  waiting?(): void }): Promise<number> {
  const gate = gpuGate(renderer);
  let waited = 0;
  try {
    gate.mark();
    for (; waited < options.frames && !options.signal?.aborted && !gate.idle(); waited++) { options.waiting?.(); await options.frame(); }
  } finally { gate.dispose(); }
  return waited;
}
