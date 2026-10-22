/**
 * Counts the GPU objects a WebGL 2 context holds (profiles phase 4a, experiments/043-scene-runtimes): every texture, buffer, framebuffer,
 * renderbuffer, program, shader, vertex array, query, sampler and sync object made on the context and not yet deleted. It wraps the
 * context's own `create*`/`delete*` methods (instance properties, so other contexts and the prototype are untouched), so it must be
 * installed before anything draws with the context, Three's renderer included. `renderer.info.memory` counts only geometries and textures
 * that Three tracks; this counts what the driver holds, which is what a disposal that leaks would leave behind.
 *
 * With `stacks`, each object remembers the call stack that made it, so a leak can be traced to its maker (`aliveSince`).
 */
export const GL_OBJECT_KINDS = ["texture", "buffer", "framebuffer", "renderbuffer", "program", "shader", "vertexArray", "query", "sampler", "sync"] as const;
export type GlObjectKind = typeof GL_OBJECT_KINDS[number];
export type GlObjectCounts = Record<GlObjectKind, number>;

const METHODS: Record<GlObjectKind, [create: string, remove: string]> = {
  texture: ["createTexture", "deleteTexture"], buffer: ["createBuffer", "deleteBuffer"], framebuffer: ["createFramebuffer", "deleteFramebuffer"],
  renderbuffer: ["createRenderbuffer", "deleteRenderbuffer"], program: ["createProgram", "deleteProgram"], shader: ["createShader", "deleteShader"],
  vertexArray: ["createVertexArray", "deleteVertexArray"], query: ["createQuery", "deleteQuery"], sampler: ["createSampler", "deleteSampler"],
  sync: ["fenceSync", "deleteSync"],
};

export type GlObjectCounter = {
  /** The objects alive now, by kind. */
  live(): GlObjectCounts;
  /** How many of each kind were ever made (for evidence). */
  made(): GlObjectCounts;
  /** A point in the context's history: `aliveSince` lists what was made after it and is still alive. */
  mark(): number;
  /** The objects made after `mark` that are still alive, with the stack that made each when the counter keeps stacks. */
  aliveSince(mark: number): { kind: GlObjectKind; stack?: string }[];
};

export function countGlObjects(gl: WebGL2RenderingContext, options: { stacks?: boolean } = {}): GlObjectCounter {
  const alive = new Map<unknown, { kind: GlObjectKind; seq: number; stack?: string }>();
  const made = Object.fromEntries(GL_OBJECT_KINDS.map(kind => [kind, 0])) as GlObjectCounts;
  let seq = 0;
  // Deep enough to reach past Three's renderer into the code that asked for the draw.
  if (options.stacks) (Error as { stackTraceLimit?: number }).stackTraceLimit = 40;
  const context = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const kind of GL_OBJECT_KINDS) {
    const [create, remove] = METHODS[kind];
    const make = context[create]!.bind(gl), drop = context[remove]!.bind(gl);
    context[create] = (...args: unknown[]) => {
      const object = make(...args);
      if (object) {
        alive.set(object, { kind, seq: ++seq, ...(options.stacks ? { stack: new Error().stack?.split("\n").slice(2).join("\n") } : {}) });
        made[kind]++;
      }
      return object;
    };
    context[remove] = (object: unknown) => { alive.delete(object); return drop(object); };
  }
  const live = () => {
    const counts = Object.fromEntries(GL_OBJECT_KINDS.map(kind => [kind, 0])) as GlObjectCounts;
    for (const entry of alive.values()) counts[entry.kind]++;
    return counts;
  };
  return {
    live,
    made: () => ({ ...made }),
    mark: () => seq,
    aliveSince: mark => [...alive.values()].filter(entry => entry.seq > mark).map(({ kind, stack }) => ({ kind, ...(stack ? { stack } : {}) })),
  };
}
