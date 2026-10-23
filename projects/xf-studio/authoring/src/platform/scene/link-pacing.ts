/**
 * How many programs may be linking on the driver's threads at once while a scene is prepared ahead (profiles phase 4a-v-b). Each link is a
 * shader compile that keeps a core busy for up to seconds (the game rig's skin: 20 s each on real data, experiment 043 §11), and asking for
 * all of a setup's at once (20–50) took every core, so the page's own thread waited hundreds of milliseconds at a time (G2: tasks of
 * 100–500 ms with nothing of the page's in them) and uploads ran slow. A quarter of the cores, two to six.
 */
export const linksInFlight = (cores = typeof navigator === "undefined" ? 8 : navigator.hardwareConcurrency || 8) =>
  Math.max(2, Math.min(6, Math.floor(cores / 4)));

/** A program asked for ahead: whether the driver has linked it, asked without waiting (KHR_parallel_shader_compile). */
type Linking = { isReady?(): boolean };

/**
 * The programs asked for and not linked yet. `admit` waits, a frame at a time, until fewer than `limit` are linking, so a new program can
 * be asked for, or until its `signal` aborts (a superseded preparation, or the context's generation ending: a lost context's links never
 * finish, so a wait on them must end with it); the caller checks the signal after. `add` records the ones a step asked for. Without
 * `parallel` (no KHR_parallel_shader_compile) it never waits.
 */
export function linkPacer(options: { parallel: boolean; limit?: number; frame(): Promise<void>; waiting?(): void }) {
  const limit = options.limit ?? linksInFlight(), known = new Set<Linking>();
  let linking: Linking[] = [];
  return {
    async admit(signal?: AbortSignal) {
      if (!options.parallel) return;
      for (;;) {
        if (signal?.aborted) return;
        linking = linking.filter(program => !(program.isReady?.() ?? true));
        if (linking.length < limit) return;
        options.waiting?.();
        await options.frame();
      }
    },
    add(programs: Iterable<Linking>) { for (const program of programs) if (!known.has(program)) { known.add(program); linking.push(program); } },
  };
}
