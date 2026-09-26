import * as THREE from "three";
import { extendSkin } from "../../skin";
import { EYE_FLAT_ROUGHNESS, IRIS_MASK_ENCODING } from "../../eye-material";
import type { ProfileEncoding } from "../../hair-colour-model";
import type { AdapterContext, ResolvedSkinSurface } from "../../character-material-adapters";
import { loadCharacterDetails, type CharacterDetailFetch, type LoadedCharacterComponent, type LoadedCharacterDetails } from "../../character-detail-loader";
import type { CharacterDetail, DetailSlot } from "../../render-detail";
import { coreAlbedoReader, coreRoughnessReader, createHeadSkinPlacement, type BrowUnderlayEvidence, type HeadSkinPlacement } from "../../head-skin-placement";
import { priorityRank } from "../../render-templates";
import type { DetailLimit } from "../../detail-limits";
import { layeredContextRestored } from "../../layered-material";
import { characterDetailsEvidence } from "../../scene-evidence";
import { RENDER_ORDER, type CharacterSlot, type CharacterView, type SkinUnderlayPort, type SupersededPart } from "../api/scene";
import type { HeadRig } from "./head-rig";

/**
 * The platform's character renderer (feature-module platform §5): it draws the V the character context resolved (skin, face
 * details, eyes, brows, lashes, hair, piercings) from the host's character record, each chunk through the material adapter for its
 * game template (character-material-adapters.ts), loaded by the host's detail loader. Which V and which creator choices is the
 * character context's (CharacterContextService, character-context.ts); how it is drawn is this module's. Nothing here names a
 * mod, a choice or a feature.
 *
 * What a feature would own later: a feature that authors a part of the character (a brow feature's own brows, a lip feature's
 * lips) renders it through its own `FeatureRenderer` and tells the port which resolved parts it replaces (`supersede`: a whole slot,
 * or only the components of named creator options), and changes that list as its own parts come and go. This renderer then draws
 * those parts as if the V had none there (PREV-89). Until such a feature exists, every part is drawn here.
 */

/**
 * Draw order of the face's decals, below the editable makeup plates (10 to 41), the eye's wetness shell (99), brows (100) and
 * lashes (101), and above the opaque skin: the game draws every post-G-buffer decal after the skin, `EMP_Front` templates
 * after `EMP_Normal` ones, and the order between decals of one priority is unknown (knowledge/head-cc-rendering.md section 3).
 * The documented fallback is the creator resource's option order; the Studio's own plate, being authored, draws over the V's
 * own decals. Each chunk gets a slot of its own, so up to 400 decal chunks per priority keep their order.
 */
export const FACE_DECAL_RENDER_ORDER = RENDER_ORDER.faceDecals;
export const faceDecalRenderOrder = (priority: string | null | undefined, index: number) =>
  FACE_DECAL_RENDER_ORDER + 4 * priorityRank(priority) + Math.min(index, 399) / 100;

// The port's slot list is the record's (render-detail.ts `DetailSlot`).
type SameSlots = [DetailSlot] extends [CharacterSlot] ? [CharacterSlot] extends [DetailSlot] ? true : false : false;
const sameSlots: SameSlots = true;
void sameSlots;

/** The host's detail loader (§5): a V's resolved components, each chunk through the adapter for its template, drawn by this renderer. */
export interface DetailLoader {
  load(record: CharacterDetail, options: { fetcher?: CharacterDetailFetch; signal?: AbortSignal; reuse?: LoadedCharacterDetails | null }): Promise<LoadedCharacterDetails>;
}

export type CharacterRenderer = ReturnType<typeof createCharacterRenderer>;

export function createCharacterRenderer(input: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  rig: HeadRig;
  /** The resolved parts the active feature renderers replace (their `supersede` lists). */
  superseded(): readonly SupersededPart[];
}) {
  const { scene, renderer, rig } = input;
  const { head, eyes, skin, coreEye } = rig;
  const rigMotion = rig.motion.rig;
  let eyeOpticsEnabled = false;
  /** The resolved eyeballs drawn now (empty while the core eye shows). */
  const resolvedEyeballs = () => drawnDetails().filter(componentShown).flatMap(item => item.eyes?.eyeballs ?? []);
  /** A layered eye design's baked eyeball chunks (the multilayered eye has no refraction or eye light; it replaces the core eye too). */
  const layeredEyes = () => drawnDetails().filter(item => item.component.slot === "eyes" && componentShown(item)).flatMap(item => item.layered ?? [])
    .filter(entry => entry.handle.state === "baked");
  /** The V's own eyeball (a baked layered design's included) replaces the core eye; without one shown, the core eye shows. */
  function applyEyes() { eyes.visible = !resolvedEyeballs().length && !layeredEyes().length; }
  function applyEyeOptics() {
    for (const { handle } of [{ handle: coreEye.handle }, ...resolvedEyeballs()]) handle.setSourceRoughness(eyeOpticsEnabled);
  }
  function setEyeOptics(enabled: boolean) { eyeOpticsEnabled = enabled; applyEyeOptics(); }
  /** Which eye is drawn and how (developer evidence and the status line's optics state). */
  function eyeAppearance() {
    const eyeballs = resolvedEyeballs();
    const item = drawnDetails().find(entry => entry.component.slot === "eyes");
    const shown = eyeballs[0]?.handle ?? coreEye.handle;
    const templates = item ? [...new Set(item.component.materials.map(material => material.template))] : [];
    const layered = layeredEyes();
    return {
      source: eyeballs.length ? "resolved" as const : layered.length ? "layered" as const : "core" as const,
      reason: eyeballs.length ? "resolved" : layered.length ? "layered-design" : item ? "eye-design-not-drawn" : "no-resolved-eye",
      definition: item?.component.definition ?? null, templates, gradient: shown.gradient, irisMaskEncoding: IRIS_MASK_ENCODING,
      coreEyeVisible: eyes.visible, shells: item?.eyes?.shells.length ?? 0,
      optics: { requested: eyeOpticsEnabled, active: shown.sourceRoughness, error: undefined as string | undefined,
        reason: !eyeOpticsEnabled ? "off" : shown.sourceRoughness ? "source-roughness-r" : "no-source-roughness",
        roughnessScale: shown.sourceRoughness ? shown.parameters.roughnessScale : EYE_FLAT_ROUGHNESS },
    };
  }
  // Profile stops are decoded from sRGB before the shader's overlay (see
  // knowledge/hair-shading.md). One explicit choice for hair and lashes.
  const profileEncoding: ProfileEncoding = "srgb-decoded";
  // Where the resolved skin is drawn, and the skin colour under decals read on that same head (head-skin-placement.ts).
  const skinPlacement = createHeadSkinPlacement(head, { coreAlbedo: coreAlbedoReader(rig.albedo), coreRoughness: coreRoughnessReader(rig.roughness) });
  let browUnderlay: BrowUnderlayEvidence | undefined;
  // Resolved character details (skin, face details, brows, lashes, hair, eyes, piercings): loaded later from the host's character record
  // (character-detail-loader.ts) and swapped in whole; each V replaces the previous one completely.
  const detailVisible: Record<DetailSlot, boolean> = { skin: true, face: true, brows: true, lashes: true, hair: true, eyes: true, piercings: true };
  // Keep context details above the entire editable makeup stack (orders 10–41); skin, hair and the eyeballs keep their own order.
  // Face decals sit below the stack (faceDecalRenderOrder).
  const DETAIL_RENDER_ORDER: Record<DetailSlot, number> = { skin: RENDER_ORDER.skin, face: FACE_DECAL_RENDER_ORDER, brows: RENDER_ORDER.brows,
    lashes: RENDER_ORDER.lashes, hair: 0, eyes: 0, piercings: 0 };
  // The eye's wetness shell multiplies what is behind it: after the opaque eye, skin and the makeup plates, before brows and lashes.
  const EYE_SHELL_RENDER_ORDER = RENDER_ORDER.eyeShell;
  let characterDetails: LoadedCharacterDetails | null = null;
  /**
   * How the resolved skin is shown (head-skin-placement.ts): on the core head when the launch route's head is
   * the same one-chunk surface (the usual case; the eye plate and idle stay bound to it), otherwise as the
   * resolved head itself with the core head hidden. Null while the fixed default skin shows.
   */
  let resolvedSkin: { item: LoadedCharacterComponent; placement: HeadSkinPlacement } | null = null;
  /** The last skin placed, so a skin component kept across a swap is not compared with the core head again. */
  let placedSkin: { item: LoadedCharacterComponent; placement: HeadSkinPlacement } | null = null;
  let normalsEnabled = true;
  const skinLimits = (): { slot: DetailSlot; limit: DetailLimit }[] => resolvedSkin?.placement.limit ? [{ slot: "skin", limit: resolvedSkin.placement.limit }] : [];
  function detailContext(slot: DetailSlot): Omit<AdapterContext, "slot"> {
    return { overMakeup: slot === "lashes", profileEncoding,
      ...(slot === "face" ? { surface: (mesh: THREE.Mesh, skin?: ResolvedSkinSurface | null) => skinPlacement.surfaceUnderlay(mesh, skin ?? null) } : {}),
      ...(slot === "brows" ? { underlay: (mesh: THREE.Mesh, skin?: ResolvedSkinSurface | null) => {
        const result = skinPlacement.underlay(mesh, skin ?? null);
        browUnderlay = result.evidence;
        return result.attribute;
      } } : {}) };
  }
  /** The host's detail loader: this renderer's anisotropy and skin placement, the record's chunks through their template's adapter. */
  const details: DetailLoader = {
    load: (record, options) => loadCharacterDetails(record, { ...options, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
      context: detailContext }),
  };
  // The skin drawn under a feature's surfaces (the scene port's `skin`): the shown resolved skin's light, and the skin under a surface
  // read on the drawn head, like the face decals' underlay. Features read both again whenever the drawn skin changes, told once.
  const skinListeners = new Set<() => void>();
  const skinPort: SkinUnderlayPort = {
    light: () => shownSkin()?.item.skin?.handle.parameters ?? null,
    underlay(surface) {
      const item = shownSkin()?.item, skinSurface: ResolvedSkinSurface | null = item?.skin
        ? { base: item.skin.base, roughness: item.skin.roughness, chunks: item.meshes } : null;
      return skinPlacement.surfaceUnderlay(surface, skinSurface);
    },
    subscribe(listener) { skinListeners.add(listener); return () => { skinListeners.delete(listener); }; },
  };
  /** The resolved skin drawn now: none while the default skin shows, or while a feature supersedes it or the viewer hides it. */
  const shownSkin = () => resolvedSkin && componentShown(resolvedSkin.item) ? resolvedSkin : null;
  /** The skin the head shows, as last applied (listeners hear of a change once, with the new V in place: PREV-95). */
  let appliedSkin: { item: LoadedCharacterComponent; placement: HeadSkinPlacement } | null = null;
  /**
   * Show the drawn skin on the head: the resolved skin on the core head (core-head placement), or the resolved head itself with the core
   * head hidden, or the core head's default skin when none is shown. Tells the skin listeners when that changed.
   */
  function applySkin() {
    const shown = shownSkin();
    if (shown?.placement.mode === "core-head") {
      head.material = shown.item.meshes[0]!.material;
      // A skin kept from the previous details already drew on the core head with this material's extension.
      const material = head.material as THREE.MeshStandardMaterial;
      if (!material.userData.xfsHeadExtended) { extendSkin(head, material); material.userData.xfsHeadExtended = true; }
      head.visible = true;
    } else {
      head.material = skin;
      head.visible = !shown;
    }
    if (shown?.item === appliedSkin?.item && shown?.placement === appliedSkin?.placement) return;
    appliedSkin = shown;
    for (const listener of [...skinListeners]) listener();
  }
  /** The V drawn now, for feature renderers (the scene port's `character`), and its change notices (once per change). */
  const characterListeners = new Set<() => void>();
  const view = (): CharacterView => ({ identity: characterDetails?.record.identity ?? null,
    drawn: [...new Set((characterDetails?.components ?? []).filter(componentShown).map(item => item.component.slot))] });
  let publishedView = JSON.stringify({ identity: null, drawn: [] } satisfies CharacterView);
  function publishView() {
    const text = JSON.stringify(view());
    if (text === publishedView) return;
    publishedView = text;
    for (const listener of [...characterListeners]) listener();
  }
  // Resolved details join and leave with each character record (a skin drawn on the core head adds no mesh).
  const drawnDetails = () => characterDetails?.components.filter(item => !(resolvedSkin?.placement.mode === "core-head" && resolvedSkin.item === item)) ?? [];
  /** Whether a feature renderer replaces this component now (a `supersede` entry for its slot, for all its options or this one's). */
  const supersededNow = (item: LoadedCharacterComponent) => input.superseded().some(part => part.slot === item.component.slot &&
    (!part.options || part.options.includes(item.component.option)));
  /** Whether a component shows: its slot's viewer preference, unless an active feature renderer replaces it (PREV-89). */
  const componentShown = (item: LoadedCharacterComponent) => detailVisible[item.component.slot] && !supersededNow(item);
  function refreshDetailVisibility() {
    for (const item of drawnDetails()) item.root.visible = componentShown(item);
    // A layered part of a slot that was hidden is baked when the slot is first shown (PREV-63); its outcome reaches the panel (PREV-74).
    if (characterDetails) publishBakeLimits([...skinLimits(), ...bakeLayered()]);
    applySkin();
    applyEyes();
    publishView();
  }
  /**
   * The placed V's limits (its skin placement's and its bakes') when they change after `setCharacterDetails` returned them: a slot
   * shown later, a re-bake after a context restore (PREV-74).
   */
  const bakeLimitListeners = new Set<(limits: { slot: DetailSlot; limit: DetailLimit }[]) => void>();
  let publishedBakeLimits = "[]";
  function publishBakeLimits(limits: { slot: DetailSlot; limit: DetailLimit }[]) {
    const text = JSON.stringify(limits);
    if (text === publishedBakeLimits) return;
    publishedBakeLimits = text;
    for (const listener of bakeLimitListeners) listener(limits.map(entry => ({ ...entry })));
  }
  /** Show or hide a slot's resolved part (a visibility preference: the V's own part, or a tried one, arrives with the record and follows it). */
  function setSlotVisible(slot: DetailSlot, visible: boolean) { detailVisible[slot] = visible; refreshDetailVisibility(); }
  /**
   * Swap in a character's resolved details, replacing the previous ones completely (null removes them). Components the new details
   * took over unchanged from the previous ones (a tried piercing style keeps the rest of the V; PREV-68) stay as they are: their
   * objects, materials and bakes are kept, only released parts are disposed. The new meshes follow the head's current facial shapes
   * and join the idle rig.
   */
  function setCharacterDetails(next: LoadedCharacterDetails | null): { limits: { slot: DetailSlot; limit: DetailLimit }[] } {
    if (characterDetails === next) return { limits: [...skinLimits(), ...bakeLayered()] };
    const previous = characterDetails;
    const drawnBefore = drawnDetails();
    characterDetails = null;
    next?.adopt();
    const kept = new Set(next?.components ?? []);
    if (previous) {
      rigMotion.detach(drawnBefore.flatMap(item => item.bones));
      // Nothing of the previous V's skin or eyes may linger: the core head and eye return to their fixed defaults before its parts are
      // released (the skin listeners hear once, below, when the new V is in place).
      head.material = skin;
      head.visible = true;
      eyes.visible = true;
    }
    resolvedSkin = null;
    // The previous V is released after the new one has baked, so a tried style can share a bake it keeps (PREV-78).
    const releasePrevious = () => previous?.dispose(kept);
    if (!next) { releasePrevious(); publishedBakeLimits = "[]"; applySkin(); applyEyes(); publishView(); return { limits: [] }; }
    // The same placement the brow decals were projected with (decided once per loaded skin).
    const skinItem = next.components.find(item => item.component.slot === "skin" && item.skin);
    if (skinItem) {
      // A skin kept from the previous details keeps its placement (comparing it with the core head again would decide the same).
      const placement = placedSkin?.item === skinItem ? placedSkin.placement : skinPlacement.place(skinItem.meshes);
      placedSkin = { item: skinItem, placement };
      resolvedSkin = { item: skinItem, placement };
      skinItem.skin!.handle.setNormals(normalsEnabled);
    }
    for (const item of next.components) for (const decal of item.decals ?? []) decal.handle.setNormals(normalsEnabled);
    characterDetails = next;
    // Face decals draw by template priority, then in the record's order (the creator option order), each chunk after the last.
    const faceOrder = new Map<THREE.Mesh, number>();
    for (const [index, { mesh, chunk }] of next.components.flatMap(item => item.decals ?? []).entries())
      faceOrder.set(mesh, faceDecalRenderOrder(chunk.materialPriority, index));
    for (const item of drawnDetails()) {
      const shells = new Set<THREE.Mesh>(item.eyes?.shells.map(entry => entry.mesh) ?? []);
      for (const mesh of item.meshes) {
        mesh.renderOrder = shells.has(mesh) ? EYE_SHELL_RENDER_ORDER : faceOrder.get(mesh) ?? DETAIL_RENDER_ORDER[item.component.slot];
        // A component kept from the previous details already carries the skinning extension (it wraps the material's compile once).
        if (!mesh.userData.xfsSkinExtended) { extendSkin(mesh, mesh.material as THREE.MeshStandardMaterial); mesh.userData.xfsSkinExtended = true; }
        // Facial shapes: the same (target, region) names as the head's.
        for (const [key, index] of Object.entries(mesh.morphTargetDictionary ?? {}))
          mesh.morphTargetInfluences![index] = head.morphTargetInfluences?.[head.morphTargetDictionary?.[key] ?? -1] ?? 0;
      }
      scene.add(item.root);
    }
    // Layered chunks (piercings, eye designs): each stack is baked once into surface maps with this renderer, then lit per frame.
    const bakeLimits = bakeLayered();
    releasePrevious();
    publishedBakeLimits = JSON.stringify([...skinLimits(), ...bakeLimits]);
    // The drawn skin goes on the head (its listeners hear once, with the new V in place), and the V's own eyeball replaces the core eye.
    applySkin();
    applyEyes();
    applyEyeOptics();
    scene.updateMatrixWorld(true);
    // The blink binds first: it must capture the details' neutral pose before a playing idle poses them.
    rigMotion.attach(drawnDetails().flatMap(item => item.bones));
    refreshDetailVisibility();
    return { limits: [...skinLimits(), ...bakeLimits] };
  }
  /**
   * Bake every layered stack of the shown V that is not baked yet (layered-material.ts). A failed bake leaves that chunk hidden and is
   * reported with the slot's code: the eye design (the core eye then shows) or a layered part. A slot the viewer hides (piercings,
   * hair) is baked when it is first shown, so a hidden part costs no GPU memory (PREV-63).
   */
  function bakeLayered(): { slot: DetailSlot; limit: DetailLimit }[] {
    const limits: { slot: DetailSlot; limit: DetailLimit }[] = [];
    for (const item of characterDetails?.components ?? []) for (const { mesh, handle } of item.layered ?? []) {
      if (handle.state === "pending" && componentShown(item)) handle.bake(renderer);
      if (handle.state !== "failed") continue;
      mesh.visible = false;
      const limit: DetailLimit = item.component.slot === "eyes" ? "eye-design" : "layered-material";
      if (!limits.some(entry => entry.slot === item.component.slot && entry.limit === limit)) limits.push({ slot: item.component.slot, limit });
    }
    return limits;
  }
  /**
   * After a lost WebGL context comes back: the shown V's layered parts are baked again from their stacks (PREV-62), since their kept
   * maps died with the context; the re-bake's outcome reaches the panel, and the core eye shows only while no layered eye design is
   * baked (PREV-74).
   */
  function contextRestored() {
    layeredContextRestored(renderer);
    for (const item of characterDetails?.components ?? []) for (const { handle } of item.layered ?? []) handle.contextRestored();
    publishBakeLimits([...skinLimits(), ...bakeLayered()]);
    if (characterDetails) applyEyes();
  }
  return {
    skin: skinPort,
    details,
    view,
    subscribe(listener: () => void) { characterListeners.add(listener); return () => { characterListeners.delete(listener); }; },
    /** The resolved parts the feature renderers supersede changed: show and hide again (PREV-89). */
    /** Meshes of the drawn V that follow the facial shapes with the head. */
    drawnMeshes: () => drawnDetails().flatMap(item => item.meshes),
    setCharacterDetails,
    setSlotVisible,
    refreshVisibility: refreshDetailVisibility,
    setEyeOptics,
    eyeAppearance,
    contextRestored,
    /** Listen for the placed V's limits changing after it was placed (PREV-74); returns the unsubscribe. */
    onBakeLimits(listener: (limits: { slot: DetailSlot; limit: DetailLimit }[]) => void) {
      bakeLimitListeners.add(listener);
      return () => { bakeLimitListeners.delete(listener); };
    },
    /** The resolved skin's and the decals' normal maps follow the viewer's normals toggle. */
    setNormals(enabled: boolean) {
      normalsEnabled = enabled;
      resolvedSkin?.item.skin?.handle.setNormals(enabled);
      for (const item of characterDetails?.components ?? []) for (const decal of item.decals ?? []) decal.handle.setNormals(enabled);
    },
    profileEncoding,
    /** How the V's details landed (developer evidence). */
    evidence: () => characterDetailsEvidence({ details: characterDetails, skin: shownSkin(), head, browUnderlay,
      eyes: { core: eyes, appearance: eyeAppearance() } }),
    /** Developer evidence: each baked layered part's packed maps read back at their centre texel (colour + roughness, normal + metalness). */
    layeredSamples: () => (characterDetails?.components ?? []).flatMap(item => (item.layered ?? []).map(({ mesh, handle }) => {
      const target = handle.target;
      if (!target) return { mesh: mesh.name, state: handle.state };
      const read = (index: number) => { const pixel = new Uint8Array(4);
        renderer.readRenderTargetPixels(target, target.width >> 1, target.height >> 1, 1, 1, pixel, undefined, index); return [...pixel]; };
      return { mesh: mesh.name, state: handle.state, colour: read(0), normal: read(1) };
    })),
  };
}
