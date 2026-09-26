/**
 * The scene port (feature-module platform §5): everything a feature's renderer (`features/<id>/render/`) may use of the
 * platform's scene host, and the renderer it registers. The host owns the WebGL renderer, camera, controls, lights, display,
 * frame scheduling, the head and the character context (skeleton, facial shapes, skin, the V's resolved details) and the rig
 * motion (idle and blink); a feature renderer draws only its own parts and reaches the rest through this port.
 *
 * Types and small pure helpers only. It is not re-exported from `platform/api/index.ts`, so a feature's pure core never sees
 * Three; only a feature's `render/` imports it.
 */
import type * as THREE from "three";
import type { FeatureId } from "./feature";

/**
 * Draw order bands on the head (Three's `renderOrder`). The skin, hair and eyeballs draw at 0; the V's face decals between 2 and
 * 10 (`EMP_Normal` before `EMP_Front`, each chunk in the creator's option order); feature plates from 10 (eye makeup's layers take
 * 10 to 41, one slot per layer); the eye's wetness shell at 99, brows at 100, lashes at 101; editor guides from 1000.
 * A new feature surface picks a free range from `featurePlates` up and names it in its renderer.
 */
export const RENDER_ORDER = Object.freeze({ skin: 0, faceDecals: 2, featurePlates: 10, eyeShell: 99, brows: 100, lashes: 101, guides: 1000 });

/** A drawn character slot (render-detail.ts `DetailSlot`); the host checks the two lists agree. */
export type CharacterSlot = "skin" | "face" | "brows" | "lashes" | "hair" | "eyes" | "piercings";

/** The drawn skin's own light (skin-material.ts `SkinParameters`): its dual specular lobe and per-channel diffuse wrap. */
export type SkinLight = { readonly lobes: { readonly roughness0: number; readonly roughness1: number; readonly weight: number };
  readonly wrap: readonly [number, number, number] };

/** The skin under each vertex of a surface: linear colour (3), roughness (1) and metalness (1), with how it was read. */
export type SurfaceUnderlay = { colour: THREE.BufferAttribute; roughness: THREE.BufferAttribute; metalness: THREE.BufferAttribute;
  evidence?: Readonly<Record<string, unknown>> };

/** The skin drawn on the head now: the V's resolved skin, or the core head's default one until it arrives. */
export interface SkinUnderlayPort {
  /** The drawn skin's light, or null while the default skin (lit with Three's standard light) shows. */
  light(): SkinLight | null;
  /** The skin under `surface`'s vertices, read on the head drawn now. Throws when `surface` is not over that head. */
  underlay(surface: THREE.Mesh): SurfaceUnderlay;
  /** Called whenever the drawn skin changes (a V switch); returns the unsubscribe. Read `light` and `underlay` again then. */
  subscribe(listener: () => void): () => void;
}

/** A read-only view of the V drawn now: its record identity and which slots show a resolved part. */
export type CharacterView = { readonly identity: string | null; readonly drawn: readonly CharacterSlot[] };

/** Which lighting setup draws the viewport now. */
export type LightingView = { readonly preset: "studio" | "creator" };

export interface SceneHostPort {
  /** The feature this port was made for. */
  readonly feature: FeatureId;
  /**
   * The WebGL renderer, for the feature's offscreen passes (composites, bakes) and its capabilities. The host alone draws the
   * scene; a feature never renders to the canvas or changes the renderer's state for good.
   */
  readonly renderer: THREE.WebGLRenderer;
  /** The head and the core record's surfaces (by record node key: `plate` is the expanded eye plate), all rigged to the head. */
  anchors(): { head: THREE.SkinnedMesh; surface(id: string): THREE.SkinnedMesh | undefined };
  /**
   * Put `object` on the head rig, beside `beside` (default: the head), so it shares the head's skeleton space. With `morphs`, every
   * mesh under it that carries facial targets follows the V's facial shapes by name, as the head's own surfaces do (a mesh that
   * shares an anchor's `morphTargetInfluences` follows without it). Returns the detach, which the host also runs on disposal.
   */
  attach(object: THREE.Object3D, options?: { beside?: THREE.Object3D; morphs?: boolean }): () => void;
  /** The skin drawn under the feature's surfaces. */
  readonly skin: SkinUnderlayPort;
  /** The V drawn now, and a change subscription (returns the unsubscribe). */
  character(): CharacterView;
  subscribeCharacter(listener: () => void): () => void;
  /** The lighting setup, and a change subscription (returns the unsubscribe). */
  lighting(): LightingView;
  subscribeLighting(listener: () => void): () => void;
  /** Something the feature draws changed: draw a frame (render on demand; coalesced). */
  requestFrame(): void;
  /** Run before each drawn frame, after the rig moved (returns the unsubscribe). Registering or removing requests a frame. */
  onFrame(listener: (dt: number) => void): () => void;
  /** The WebGL context came back after a loss: render targets are empty (returns the unsubscribe). A frame follows. */
  onContextRestored(listener: () => void): () => void;
}

/**
 * A feature's renderer: its parts on the head, created once the host is ready and disposed with it (or when it fails part-way).
 * Every method but `dispose` is optional: a feature implements what it draws.
 */
export interface FeatureRenderer {
  /** Bring the feature's own GPU state up to date right before the host draws a frame (only on frames that are drawn). */
  beforeDraw?(): void;
  /** The viewer's display toggles, applied to the feature's own materials. */
  setNormals?(enabled: boolean): void;
  setWireframe?(enabled: boolean): void;
  /** The feature's hit under a picking ray (a feature-owned hit; the platform binds it, §4). */
  pick?(ray: THREE.Raycaster): unknown | undefined;
  /** Resolved character slots this feature replaces while its renderer is active: the host hides them (none today). */
  readonly supersedes?: readonly CharacterSlot[];
  /** Read-only developer evidence (verification pages); plain data. */
  evidence?(): unknown;
  /** Release everything the renderer made: meshes it attached, materials, textures and render targets. */
  dispose(): void;
}

/** A feature's renderer entry in the composition (`compose/renderers.ts`). */
export interface FeatureRendererFactory<R extends FeatureRenderer = FeatureRenderer> {
  readonly feature: FeatureId;
  create(host: SceneHostPort): R;
}

/** Wrap each named method so a call also requests a frame (after it ran, whatever it returned). */
export function invalidating<T extends object, K extends keyof T>(target: T, keys: readonly K[], invalidate: () => void): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    const method = target[key];
    if (typeof method !== "function") throw Error(`${String(key)} is not a method.`);
    out[key] = ((...args: unknown[]) => {
      try { return (method as (...a: unknown[]) => unknown).apply(target, args); }
      finally { invalidate(); }
    }) as T[K];
  }
  return out;
}
