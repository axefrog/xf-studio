import * as THREE from "three";
import { passParticipation, type PassRole } from "../api/scene";

/**
 * The input-variant swap (renderer adapter): draw the scene once more with every visible mesh's material replaced by a variant of it
 * for one pass, as the game's G-buffer-like targets would hold it. The skin scatter's input pass uses it (skin-scatter.ts,
 * research/materials/shader-skin.md §11.3); the parity passes (research/authoring/game-parity-measurement.md phase P2: `albedo`, `ids`,
 * `depth`) are other `PassSpec`s over the same swap.
 *
 * A variant is the forward material itself, seen through a prototype: every property (maps, colours, side, polygon offset, uniforms
 * the material's own compile hook shares) is read live from the forward material, and only the pass's own state is the variant's
 * (its defines, blending, depth writes, compile hook and program key). Its program is the forward material's own shader with the
 * pass's define added, compiled once and cached by Three per variant; a change the forward material announces (`needsUpdate`)
 * recompiles the variant too. Variants never own textures; `dispose` releases only their programs.
 *
 * Which variant a mesh gets comes from its material's declaration (`declarePass`, platform/api/scene.ts): `skin` and `decal` materials
 * write the pass's inputs themselves under the pass's define; `skip` materials are left out. Materials that declare nothing follow
 * the host's rules: a blended, non-depth-writing material is forward-only and left out (the eye's wetness shell, glitter, per-layer
 * plates, the hair cap); every other built-in surface occludes (`occluder`: it writes the pass's "nothing here", alpha-tested at half
 * coverage when it draws by alpha-to-coverage or an alpha map); a custom shader or a surface drawn without a depth test is left out.
 */
export type VariantRole = Exclude<PassRole, "skip"> | "occluder";
export type PassSpec = {
  /** Suffix of the variants' program keys, and the variants' names. */
  readonly name: string;
  /** Defines added to a variant of this role (on top of the forward material's own). */
  defines(role: VariantRole, material: THREE.Material): Record<string, string>;
  /** A fragment patch applied after the forward material's own compile hook (an occluder's write, for example). */
  patch?(shader: { vertexShader: string; fragmentShader: string }, role: VariantRole): void;
  /** The variant's own draw state: blending and depth writes, and whether it sorts with the transparent draws. */
  state(role: VariantRole): VariantState;
};
export type VariantState = { transparent: boolean; blending: THREE.Blending; depthWrite: boolean;
  blendSrc?: THREE.BlendingSrcFactor; blendDst?: THREE.BlendingDstFactor; blendSrcAlpha?: THREE.BlendingSrcFactor | null;
  blendDstAlpha?: THREE.BlendingDstFactor | null };

/** Built-in materials whose programs carry the chunks an occluder's patch uses; anything else (custom shaders) is left out. */
const BUILT_IN = new Set(["MeshStandardMaterial", "MeshPhysicalMaterial", "MeshBasicMaterial", "MeshLambertMaterial", "MeshPhongMaterial",
  "MeshToonMaterial", "MeshMatcapMaterial"]);

/** A material's role in a pass, or null when it is left out (declared `skip`, forward-only, or not a surface the pass can draw). */
export function variantRole(material: THREE.Material): VariantRole | null {
  const declared = passParticipation(material)?.role;
  if (declared === "skip") return null;
  if (declared) return declared;
  if (!material.visible || !material.depthTest) return null;
  if (material.transparent && !material.depthWrite) return null;
  return BUILT_IN.has(material.type) ? "occluder" : null;
}

/** The half-coverage cutoff an occluder variant tests: alpha-to-coverage and alpha-mapped surfaces draw where they are half covered. */
export const occluderCutoff = (material: THREE.Material) =>
  material.alphaToCoverage || (material as THREE.MeshStandardMaterial).alphaMap ? 0.5 : material.alphaTest;

let variantIds = 0;
/** A material seen through a prototype, with its own draw state and program (see the header). */
function createVariant(forward: THREE.Material, role: VariantRole, spec: PassSpec): THREE.Material {
  const variant = Object.create(forward) as THREE.Material;
  // Its own identity, event listeners (Three frees a variant's program on its own dispose) and program version.
  Object.defineProperty(variant, "id", { value: 1e9 + variantIds++ });
  Object.assign(variant, { uuid: THREE.MathUtils.generateUUID(), _listeners: undefined, version: 0 });
  variant.name = `${forward.name}|${spec.name}`;
  variant.defines = { ...((forward as THREE.MeshStandardMaterial).defines ?? {}), ...spec.defines(role, forward) };
  Object.assign(variant, { blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: null, blendDstAlpha: null,
    alphaToCoverage: false, premultipliedAlpha: false }, spec.state(role));
  variant.onBeforeCompile = (shader, renderer) => {
    forward.onBeforeCompile.call(forward, shader, renderer);
    spec.patch?.(shader, role);
  };
  variant.customProgramCacheKey = () => `${forward.customProgramCacheKey.call(forward)}|${spec.name}|${role}`;
  return variant;
}

type Entry = { variant: THREE.Material; role: VariantRole; version: number };

/** The swap for one pass: variants cached per forward material, and one draw of a scene through them. */
export function createPassVariants(spec: PassSpec) {
  const variants = new Map<THREE.Material, Entry>();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  // A forward material's disposal frees its variant with it (a V switch releases the previous V's materials).
  const forget = (event: { target: THREE.Material }) => {
    const entry = variants.get(event.target);
    event.target.removeEventListener("dispose", forget);
    if (!entry) return;
    variants.delete(event.target);
    entry.variant.dispose();
  };
  /** The variant of `material` for `role`, rebuilt when the forward material changed (a new role or a `needsUpdate`). */
  function variantFor(material: THREE.Material, role: VariantRole): THREE.Material {
    let entry = variants.get(material);
    if (entry && entry.role !== role) { entry.variant.dispose(); entry = undefined; }
    if (!entry) {
      entry = { variant: createVariant(material, role, spec), role, version: material.version };
      if (!variants.has(material)) material.addEventListener("dispose", forget);
      variants.set(material, entry);
    } else if (entry.version !== material.version) {
      entry.version = material.version;
      entry.variant.defines = { ...((material as THREE.MeshStandardMaterial).defines ?? {}), ...spec.defines(role, material) };
      entry.variant.needsUpdate = true;
    }
    return entry.variant;
  }
  const swap = (material: THREE.Material) => {
    const role = variantRole(material);
    return role ? variantFor(material, role) : hidden;
  };
  return {
    variantFor,
    /** What `mesh` draws in this pass: per material, its variant or a hidden material. */
    swap,
    /**
     * Draw `scene` into the renderer's current target with every visible mesh through its variant, then put every material back (also
     * when the draw throws). Lines, points and sprites are hidden for the draw.
     */
    draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
      const swapped: { object: THREE.Object3D & { material: THREE.Material | THREE.Material[] }; material: THREE.Material | THREE.Material[] }[] = [];
      const hiddenObjects: THREE.Object3D[] = [];
      try {
        scene.traverseVisible(object => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) {
            const material = mesh.material;
            swapped.push({ object: mesh, material });
            mesh.material = Array.isArray(material) ? material.map(swap) : swap(material);
          } else if ((object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) {
            hiddenObjects.push(object);
          }
        });
        for (const object of hiddenObjects) object.visible = false;
        renderer.render(scene, camera);
      } finally {
        for (const { object, material } of swapped) object.material = material;
        for (const object of hiddenObjects) object.visible = true;
      }
    },
    /** Developer evidence: how many variants exist, by role. */
    counts: () => [...variants.values()].reduce<Record<string, number>>((out, entry) => { out[entry.role] = (out[entry.role] ?? 0) + 1; return out; }, {}),
    /** Release every variant (their programs are freed); the next draw builds them again. */
    clear() {
      for (const [material, entry] of variants) { material.removeEventListener("dispose", forget); entry.variant.dispose(); }
      variants.clear();
    },
    dispose() { this.clear(); hidden.dispose(); },
  };
}
export type PassVariants = ReturnType<typeof createPassVariants>;
