import type * as THREE from "three";

/**
 * A program Three linked: its first use reads its uniforms and attributes back from the driver (a synchronous round trip that waits
 * for whatever the GPU still has queued), which a caller preparing ahead takes between frames instead of inside the first frame.
 */
export type LinkedProgram = { getUniforms(): unknown; getAttributes(): unknown;
  /** Whether the driver has finished linking it, asked without waiting (true at once without KHR_parallel_shader_compile). */
  isReady?(): boolean };
/** Every program Three holds for `materials` (a transparent two-sided material has one per side). */
export function linkedPrograms(renderer: THREE.WebGLRenderer, materials: Iterable<THREE.Material>): LinkedProgram[] {
  const programs = new Set<LinkedProgram>();
  for (const material of materials) {
    const owned = (renderer.properties.get(material) as { programs?: Map<string, LinkedProgram> }).programs;
    for (const program of owned?.values() ?? []) programs.add(program);
  }
  return [...programs];
}

/** Optional CPU-only inventory for a coordinator's isolated preparation probe. No GL queries, shader text or retained resources. */
export type ProgramPreparationEntry = {
  at: number; pass: string; object: string; material: string; materialId: number; type: string;
  programs: { id: number; cacheKey: string; current: boolean }[];
};
export function traceProgramPreparation(renderer: THREE.WebGLRenderer, object: THREE.Object3D, pass: string): void {
  const receive = (globalThis as typeof globalThis & { __xfsProgramPreparation?: (entry: ProgramPreparationEntry) => void }).__xfsProgramPreparation;
  if (typeof receive !== "function") return;
  try {
    object.traverse(child => {
      const material = (child as THREE.Mesh).material;
      for (const item of material ? Array.isArray(material) ? material : [material] : []) {
        type Program = { id: number; cacheKey: string };
        const state = renderer.properties.get(item) as { programs?: Map<string, Program>; currentProgram?: Program };
        receive({ at: performance.now(), pass, object: child.name, material: item.name, materialId: item.id, type: item.type,
          programs: [...state.programs?.values() ?? []].map(program => ({ id: program.id, cacheKey: program.cacheKey, current: program === state.currentProgram })) });
      }
    });
  } catch { /* A diagnostic consumer cannot change preparation or its failure reporting. */ }
}

/** Programs whose release frees their shaders too (`releaseShadersWithPrograms`). */
const shaderOwners = new WeakSet<object>();
/**
 * Programs compiled ahead may be released without ever being drawn (a preparation superseded, a part let go before it showed). Three
 * deletes a program's shaders at its first use only, so a program released unused would leave both shaders on the driver for good (three
 * r186 `WebGLProgram.destroy`). Their release deletes them too: deleting a shader already deleted at first use does nothing.
 */
export function releaseShadersWithPrograms(renderer: THREE.WebGLRenderer, programs: Iterable<LinkedProgram>): void {
  const gl = renderer.getContext();
  for (const program of programs) {
    const owned = program as LinkedProgram & { destroy?: () => void; vertexShader?: WebGLShader; fragmentShader?: WebGLShader };
    if (shaderOwners.has(owned) || typeof owned.destroy !== "function") continue;
    shaderOwners.add(owned);
    const destroy = owned.destroy.bind(owned);
    owned.destroy = () => {
      if (owned.vertexShader) gl.deleteShader(owned.vertexShader);
      if (owned.fragmentShader) gl.deleteShader(owned.fragmentShader);
      destroy();
    };
  }
}
