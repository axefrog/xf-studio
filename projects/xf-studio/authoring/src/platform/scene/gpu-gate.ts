/**
 * Whether the GPU process has caught up with what the page sent before the last `mark` (a fence), asked without waiting (profiles phase
 * 4a-v-b). An upload sent while the GPU process is busy (building a shader at a draw, seconds at a time on ANGLE) waits inside the call
 * for room to pass its texels: a 1024² map's upload took 141 ms of the page's thread that way (G2). A caller that marks after each upload
 * and sends the next only once the gate is idle waits a frame instead. Without fences (WebGL 1, test stand-ins) it is always idle.
 */
export function gpuGate(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined) {
  const sync = gl && typeof (gl as WebGL2RenderingContext).fenceSync === "function" ? gl as WebGL2RenderingContext : null;
  let fence: WebGLSync | null = null;
  const lost = () => !!sync && typeof sync.isContextLost === "function" && sync.isContextLost();
  const drop = () => { if (fence && sync && !lost()) sync.deleteSync(fence); fence = null; };
  return {
    idle(): boolean {
      if (!sync || !fence) return true;
      if (lost()) { fence = null; return true; }
      if (sync.getSyncParameter(fence, sync.SYNC_STATUS) !== sync.SIGNALED) return false;
      drop();
      return true;
    },
    mark(): void {
      if (!sync || lost()) return;
      drop();
      fence = sync.fenceSync(sync.SYNC_GPU_COMMANDS_COMPLETE, 0);
      sync.flush();
    },
  };
}
