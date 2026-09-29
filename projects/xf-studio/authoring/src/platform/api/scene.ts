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
 * Draw order on the head (Three's `renderOrder`). The skin, hair and eyeballs draw at 0; the V's face decals between 2 and 10
 * (`EMP_Normal` before `EMP_Front`, each chunk in the creator's option order); feature plates from 10 up to the eye's wetness shell
 * at 99, brows at 100, lashes at 101; editor guides from 1000. A feature's surfaces draw in the band the host gives it (`RenderBand`).
 */
export const RENDER_ORDER = Object.freeze({ skin: 0, faceDecals: 2, featurePlates: 10, eyeShell: 99, brows: 100, lashes: 101, guides: 1000 });

/**
 * A feature's own draw-order slots on the head (PREV-91). The host gives each composed renderer that asks for slots
 * (`FeatureRendererFactory.renderSlots`) the next free run of the feature-plate range, in composition order, so two layered
 * features never interleave: eye makeup's 32 layers take 10 to 41, and the next feature starts at 42.
 */
export type RenderBand = {
  /** The first slot's draw order. */
  readonly first: number;
  /** How many slots the band holds. */
  readonly slots: number;
  /** The draw order of slot `index` (0-based). Throws outside the band. */
  order(index: number): number;
};

/** A drawn character slot (render-detail.ts `DetailSlot`); the host checks the two lists agree. */
export type CharacterSlot = "skin" | "face" | "brows" | "lashes" | "hair" | "eyes" | "teeth" | "piercings" | "body" | "clothing";

/**
 * A resolved part a feature replaces while it says so (PREV-89): a whole slot, or only the slot's components that came from the
 * named character-creator options (`RenderComponent.option`, the game's own option names), such as a lips feature replacing the lips
 * decal and leaving the V's other face decals. A superseded part draws as if the V had none there: its meshes are hidden and not
 * baked, a superseded skin leaves the core head with its default skin, and superseded eyes bring back the core eye.
 */
export type SupersededPart = { readonly slot: CharacterSlot; readonly options?: readonly string[] };

/** The drawn skin's own light (skin-material.ts `SkinParameters`): its dual specular lobe and per-channel diffuse wrap. */
export type SkinLight = { readonly lobes: { readonly roughness0: number; readonly roughness1: number; readonly weight: number };
  readonly wrap: readonly [number, number, number] };

/**
 * How a material takes part in the host's G-buffer-like passes (platform/scene/pass-variants.ts): today the skin scatter's input pass
 * (research/materials/shader-skin.md §11), later the parity passes. The host draws every visible mesh once more with an input variant of
 * its own material; a material states its role, and one that states none is drawn by the host's rules (opaque surfaces occlude, blended
 * forward-only ones are left out).
 * - `skin`: a Subsurface (class 1) surface: writes its diffuse irradiance, √albedo, metalness, class and profile slot, opaque;
 * - `decal`: drawn over the skin after it (a post-G-buffer decal, the authored plate): blends √colour, irradiance and metalness each at its
 *   own alpha and never changes the pixel's class or slot;
 * - `skip`: forward-only (drawn after the game's scatter): not drawn in the pass.
 */
export type PassRole = "skin" | "decal" | "skip";
/** A skin profile's fields the scatter reads (`CSkinProfile`: colours as stored 8-bit sRGB). */
export type PassSkinProfile = { readonly blurSize: number; readonly diffuse: readonly number[]; readonly falloff: readonly number[] };
/**
 * A material's declaration. `wrapGate` scales the skin light's wrap (1: the wrap stand-in; 0 while the scatter runs, which replaces it);
 * a `skin` material also carries its profile and the uniform its profile slot is written to.
 */
export type PassParticipation = { readonly role: PassRole; readonly profile?: PassSkinProfile;
  readonly slot?: { value: number }; readonly wrapGate?: { value: number } };
const PASS_KEY = "xfsPass";
/** Declare (or with null, withdraw) how `material` takes part in the host's passes. */
export function declarePass(material: THREE.Material, participation: PassParticipation | null): void {
  if (participation) material.userData[PASS_KEY] = participation; else delete material.userData[PASS_KEY];
}
/** A material's declaration, if it made one. */
export const passParticipation = (material: THREE.Material): PassParticipation | undefined =>
  material.userData?.[PASS_KEY] as PassParticipation | undefined;

/**
 * The scatter-input pass's shader contract (platform/scene/skin-scatter.ts). A variant's program has `SCATTER_INPUT_DEFINE` defined and
 * writes three targets: location 0 (Three's `gl_FragColor`) = S0, the direct diffuse irradiance at albedo 1 (RGB) and, for a Subsurface
 * pixel, its view depth (A, 0 elsewhere: the class-1 flag); `xfsScatterOut1` = S1, √albedo (RGB) and the profile slot as (slot + 1) / 8
 * (A); `xfsScatterOut2` = S2, the metalness (R). A decal's alpha in each output is its blend weight for that target; the blend keeps the
 * alphas underneath. `SCATTER_INPUT_OUTPUTS` declares the two extra outputs at global scope (once per program).
 */
export const SCATTER_INPUT_DEFINE = "XFS_SCATTER_INPUT";
export const SCATTER_INPUT_OUTPUTS = /* glsl */`
#ifdef XFS_SCATTER_INPUT
layout( location = 1 ) out highp vec4 xfsScatterOut1;
layout( location = 2 ) out highp vec4 xfsScatterOut2;
#endif`;

/** The skin under each vertex of a surface: linear colour (3), roughness (1) and metalness (1), with how it was read. */
export type SurfaceUnderlay = { colour: THREE.BufferAttribute; roughness: THREE.BufferAttribute; metalness: THREE.BufferAttribute;
  evidence?: Readonly<Record<string, unknown>> };

/** The skin drawn on the head now: the V's resolved skin, or the core head's default one until it arrives. */
export interface SkinUnderlayPort {
  /** The drawn skin's light, or null while the default skin (lit with Three's standard light) shows. */
  light(): SkinLight | null;
  /** The skin under `surface`'s vertices, read on the head drawn now. Throws when `surface` is not over that head. */
  underlay(surface: THREE.Mesh): SurfaceUnderlay;
  /** Called once whenever the drawn skin changes (a V switch, a superseded skin); returns the unsubscribe. Read `light` and `underlay` again then. */
  subscribe(listener: () => void): () => void;
}

/**
 * A read-only view of the V drawn now: its record identity and which slots show a resolved part now (a skin drawn on the core head
 * included; slots the viewer hides or a feature supersedes left out).
 */
export type CharacterView = { readonly identity: string | null; readonly drawn: readonly CharacterSlot[] };

export interface SceneHostPort {
  /** The feature this port was made for. */
  readonly feature: FeatureId;
  /**
   * The WebGL renderer, for the feature's offscreen passes (composites, bakes) and its capabilities. The host alone draws the
   * scene; a feature never renders to the canvas or changes the renderer's state for good.
   */
  readonly renderer: THREE.WebGLRenderer;
  /**
   * The head and the core record's surfaces (by record node key: `plate` is the expanded eye plate), all rigged to the head. They are
   * the platform's and read-only to a feature (PREV-97): the surfaces are anchors the platform never draws (hidden, skinned with all
   * their influences), which a feature copies for its own meshes (sharing the skeleton, geometry attributes and facial influences). A
   * feature never changes their material, visibility, geometry or transform.
   */
  anchors(): { head: THREE.SkinnedMesh; surface(id: string): THREE.SkinnedMesh | undefined };
  /**
   * Put `object` on the head rig, beside `beside` (default: the head), so it shares the head's skeleton space. With `morphs`, every
   * mesh under it that carries facial targets follows the V's facial shapes by name, as the head's own surfaces do, meshes added under
   * it later included (PREV-93; a mesh that shares an anchor's `morphTargetInfluences` follows without it). With `rig`, the bones under
   * it join the rig motion by name, as the V's details do, so the game idle and the blink pose them (PREV-90). Returns the detach, which
   * the host also runs on disposal.
   */
  attach(object: THREE.Object3D, options?: { beside?: THREE.Object3D; morphs?: boolean; rig?: boolean }): () => void;
  /** This feature's draw-order slots (`FeatureRendererFactory.renderSlots`; no slots when it asked for none). */
  readonly renderBand: RenderBand;
  /**
   * The resolved parts this feature replaces from now on (PREV-89), replacing what it said before; `[]` gives them back. Call it
   * whenever what the feature draws changes (a brow feature supersedes the V's brows only while it has brows of its own). The host
   * shows and hides the V's parts at once, and forgets the list when the renderer is disposed.
   */
  supersede(parts: readonly SupersededPart[]): void;
  /** The skin drawn under the feature's surfaces. Its subscriptions also end with the renderer's disposal. */
  readonly skin: SkinUnderlayPort;
  /** The V drawn now, and a change subscription (returns the unsubscribe; it also ends with disposal). */
  character(): CharacterView;
  subscribeCharacter(listener: () => void): () => void;
  /** Something the feature draws changed: draw a frame (render on demand; coalesced). */
  requestFrame(): void;
  /** Run before each drawn frame, after the rig moved (returns the unsubscribe). Registering or removing requests a frame. */
  onFrame(listener: (dt: number) => void): () => void;
  /** The WebGL context came back after a loss: render targets are empty (returns the unsubscribe). A frame follows. */
  onContextRestored(listener: () => void): () => void;
  /**
   * Compile `object`'s programs (never drawn yet: a stand-in or a part about to show) for every pass the scene draws, linked off the
   * page's thread, and take their first use between frames (PREV-188): resolves when a frame that draws it would wait on nothing. A
   * later material of the same configuration shares the programs.
   */
  compile(object: THREE.Object3D): Promise<void>;
}

/**
 * A feature's renderer: its parts on the head, created once the host is ready and disposed with it (or when it fails part-way).
 * Every method but `dispose` is optional: a feature implements what it draws. A method that throws is reported and skipped for that
 * call, and the host and the other features draw on (PREV-94).
 */
export interface FeatureRenderer {
  /** Bring the feature's own GPU state up to date right before the host draws a frame (only on frames that are drawn). */
  beforeDraw?(): void;
  /** The viewer's display toggles, applied to the feature's own materials. */
  setNormals?(enabled: boolean): void;
  setWireframe?(enabled: boolean): void;
  /**
   * Whether the person's research tools show (the research-only options, such as the research finishes, can be chosen only then): work
   * done ahead only for those options runs only while they do (PREV-194). Off until the host says otherwise.
   */
  setResearchTools?(enabled: boolean): void;
  /** Read-only developer evidence (verification pages); plain data. */
  evidence?(): unknown;
  /** Release everything the renderer made: meshes it attached, materials, textures and render targets. */
  dispose(): void;
}

/** A feature's renderer entry in the composition (`compose/renderers.ts`). */
export interface FeatureRendererFactory<R extends FeatureRenderer = FeatureRenderer> {
  readonly feature: FeatureId;
  /** How many draw-order slots its surfaces take (`SceneHostPort.renderBand`); none when omitted. */
  readonly renderSlots?: number;
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

/** A band of `slots` draw-order slots from `first` (the scene host allocates them; tests make their own). */
export function renderBand(first: number, slots: number): RenderBand {
  return Object.freeze({ first, slots, order(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= slots) throw RangeError(`Draw-order slot ${index} is outside this feature's ${slots} slots.`);
    return first + index;
  } });
}
