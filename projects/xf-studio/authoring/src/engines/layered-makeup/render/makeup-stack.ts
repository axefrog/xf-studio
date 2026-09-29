import * as THREE from "three";
import { extendSkin } from "../../../skin";
import { canonicalFinish, defaultFlakes, isIrregular } from "../finish";
import {maskAlphaKey,studioIrregularOpticalKey,irregularAlbedoKey,previewOpticalKey} from "../makeup-dependencies";
import type { Layer } from "../recipe";
import type { FineGlitterScope } from "../region";
import {installProceduralGlintStudy} from "./direct-glint";
import {isDirectGlint} from "../direct-glint-settings";
import {flatSurface,FRESNEL_SURFACE,layerExport,planPresetExport} from "../finish-export";
import {installFresnelTint} from "./fresnel-tint";
import { isGrainOptics, SHIMMER_GRAIN, type GrainOptics } from "../shimmer-grain";
import { mipDimensions } from "../flat-mip-chain";
import type { UvWindow } from "../plate-uv-window";
import {createPlateLightMaterial,plateBlendWindow} from "./plate-blend";
import {createPlateComposite} from "./plate-composite";
import { renderBand, RENDER_ORDER, type FeatureRenderer, type SkinLight } from "../../../platform/api/scene";
import { MAX_LAYERS } from "../recipe";
/** Base under the earlier Glossy preview's separate clear coat (preview only; the game-matched Glossy uses the export surface). */
const EARLIER_GLOSSY_BASE = { roughness: .16, metalness: 0 } as const;

/** A layer's generated optical maps: at the mask's size (classic flakes), or game-matched Shimmer's grain chains over its window. */
export type BakedOptics = { size: number; normal: Uint8Array<ArrayBuffer>; surface: Uint8Array<ArrayBuffer> } | GrainOptics;
export type BakedAlbedo = {key:string; data:Uint8Array<ArrayBuffer>};
/** The skin under each plate vertex (head-skin-placement.ts `surfaceUnderlay`): linear colour, roughness and metalness. */
export type PlateUnderlay = { colour: THREE.BufferAttribute; roughness: THREE.BufferAttribute; metalness: THREE.BufferAttribute };
export type MakeupStack = ReturnType<typeof createMakeupStack>;
/** What the preview device drives: the layer slots, their mask canvases and generated maps (browser-preview-device.ts). */
export type MakeupLayers = Pick<MakeupStack, "setCanvases" | "reconcileLayerCanvases" | "setLayerCanvas" | "updateLayer" | "needsOptics" | "needsAlbedo">;
/**
 * A layered-makeup surface drawn in the scene: its layers, the surface mesh they are drawn on (for on-surface editing and picking)
 * and the largest texture the renderer takes. Eye makeup's renderer is one (features/eye-makeup/render).
 */
export type LayeredMakeupSurface = { readonly layers: MakeupLayers; readonly surface: THREE.SkinnedMesh; readonly maxTextureSize: number };
/** A feature renderer that draws a layered-makeup surface: the composition lists these for the preview wiring (compose/renderers.ts, UI-76). */
export type LayeredSurfaceRenderer = FeatureRenderer & LayeredMakeupSurface;

/** Where a stack's meshes go: onto the head rig (default: beside the anchor), and in which draw order each layer slot draws. */
export type MakeupStackPlacement = {
  attach?(mesh: THREE.SkinnedMesh): void;
  /** Slot `i`'s draw order (the feature's `RenderBand.order`; default: the feature-plate range from 10, one slot per layer). */
  renderOrder?(slot: number): number;
};

/** `window` widened to the nearest edges of a grid of `n` cells per unit of UV (the whole atlas stays whole). */
export function snapWindow<W extends { u0: number; v0: number; u1: number; v1: number }>(window: W, n: number): W {
  const lo = (x: number) => Math.max(0, Math.floor(x * n) / n), hi = (x: number) => Math.min(1, Math.ceil(x * n) / n);
  return { ...window, u0: lo(window.u0), v0: lo(window.v0), u1: hi(window.u1), v1: hi(window.v1) };
}

/** The attributes the stack adds to its geometry (the skin under the plate); everything else on it is the anchor's (PREV-100). */
export const STACK_ATTRIBUTES = ["xfsUnderlay", "xfsUnderRoughness", "xfsUnderMetalness"] as const;
/**
 * A geometry of the stack's own over `source`'s buffers: the same index, attributes and morph targets (no copies, so no second
 * upload of them), with room for the attributes the stack adds (the skin underlay), which never land on the platform's surface.
 */
function sharedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  for (const [name, targets] of Object.entries(source.morphAttributes)) (geometry.morphAttributes as Record<string, typeof targets>)[name] = [...targets];
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.name = source.name;
  return geometry;
}

/**
 * Owns layer GPU resources; complete worker bundles supply generated optical maps. `anchor` is the surface the layers are drawn on
 * (eye makeup's: the expanded eye plate), which the stack only reads (PREV-97): each layer and the lit plate are copies of it on a
 * geometry of the stack's own over the anchor's buffers, sharing its skeleton and facial influences, put on the head rig by
 * `placement.attach` (by default beside the anchor) and drawn in `placement.renderOrder`'s slots. `fineGlitter` is the feature's
 * fine-Glitter scope (its region's), part of the optical identities the worker publishes.
 */
export function createMakeupStack(anchor: THREE.SkinnedMesh, anisotropy: number, fineGlitter: FineGlitterScope, placement: MakeupStackPlacement = {}) {
  const attach = placement.attach ?? ((mesh: THREE.SkinnedMesh) => { anchor.parent!.add(mesh); });
  const renderOrder = placement.renderOrder ?? renderBand(RENDER_ORDER.featurePlates, MAX_LAYERS).order;
  const plates: THREE.SkinnedMesh[] = [], materials: THREE.MeshPhysicalMaterial[] = [], textures: THREE.CanvasTexture[] = [];
  const flakes = new Map<THREE.Material, { key: string; normal: THREE.DataTexture; surface: THREE.DataTexture; albedo?: THREE.DataTexture; albedoKey?:string;
    /** Game-matched Shimmer's grain: its maps cover this window of head UV, one grain per texel. */
    window?: UvWindow }>();
  const direct=new Map<THREE.Material,ReturnType<typeof installProceduralGlintStudy>>();
  const tints=new Map<THREE.Material,ReturnType<typeof installFresnelTint>>();
  // The exported plate as the game draws it (plate-blend.ts): the layers the export carries merge into one composite, and one
  // plate lights the blended surface once, with the skin's light. Each slot's own material stays the layer's source (and draws the
  // layer itself when the export leaves it out, or when the skin under the plate is unknown).
  const applied=new Map<THREE.Material,Layer>();
  // On the grain grid, so a composite at the grain's density reads each grain texel at its centre (never a blend of four).
  const composite=createPlateComposite(snapWindow(plateBlendWindow(anchor.geometry.getAttribute("uv")?.array), SHIMMER_GRAIN.cellsPerUv));
  let underlay: PlateUnderlay | null = null, underlaySource: (() => PlateUnderlay | null) | null = null, underlayStale = false;
  let blendDirty = true;
  let merged: { slots: number[]; route: string | null } = { slots: [], route: null };
  let layerIds: string[] = [];
  // Every mesh of the stack draws this geometry: the anchor's buffers, and the skin underlay the stack adds (never on the anchor).
  const geometry = sharedGeometry(anchor.geometry);
  /** A hidden copy of the anchor on the stack's geometry, sharing its skeleton and facial influences. */
  const copy = () => {
    const mesh = anchor.clone();
    mesh.geometry = geometry; mesh.skeleton = anchor.skeleton; mesh.morphTargetInfluences = anchor.morphTargetInfluences; mesh.visible = false;
    return mesh;
  };
  const plateLight = createPlateLightMaterial();
  const plate = copy();
  plate.name = "makeup_plate"; plate.material = plateLight.material;
  extendSkin(plate, plateLight.material, .00008);
  attach(plate);
  let wireframe = false;
  const textured = (layer: Layer) => ["shimmer", "glitter"].includes(canonicalFinish(layer.finish)) &&
    !isDirectGlint(layer.flakes);
  // Game-matched Shimmer bakes the export's grain (shimmer-grain.ts) and uploads route-filtered mip chains.
  const keyFor = (layer: Layer, size: number) => previewOpticalKey(layer, size, fineGlitter);
  const albedoKeyFor = (layer:Layer,size:number) => isIrregular(layer.flakes) && layer.finish === "glitter"
    ? irregularAlbedoKey(studioIrregularOpticalKey(layer.flakes,size,fineGlitter),maskAlphaKey(layer,size),layer.color,layer.flakes.color)
    : undefined;
  function maskTexture(canvas: HTMLCanvasElement) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = anisotropy;
    return texture;
  }
  function clearFlakes(material: THREE.MeshPhysicalMaterial) {
    const maps = flakes.get(material);
    if (maps) {
      material.normalMap = material.roughnessMap = material.metalnessMap = null;
      material.needsUpdate = true;
      maps.normal.dispose(); maps.surface.dispose(); maps.albedo?.dispose(); flakes.delete(material);
    }
  }
  function clearDirect(material:THREE.MeshPhysicalMaterial){
    direct.get(material)?.dispose();direct.delete(material);
  }
  /** The layer's Colour-shifting tint off: installed with the slot, so leaving the finish changes a uniform, not the program. */
  function clearTint(material:THREE.MeshPhysicalMaterial){
    tints.get(material)?.clear();
  }
  function disposeSlot(i: number) {
    const material = materials[i];
    clearFlakes(material); clearDirect(material); tints.get(material)?.dispose(); tints.delete(material); applied.delete(material);
    material.dispose(); textures[i].dispose(); plates[i].removeFromParent(); blendDirty = true;
  }
  function createSlot(canvas: HTMLCanvasElement, i: number) {
    const mesh = copy(), texture = maskTexture(canvas);
    const material = new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false,
      roughness: .85, side: THREE.DoubleSide, wireframe });
    mesh.name = `makeup_layer_${i + 1}`; mesh.material = material;
    mesh.renderOrder = renderOrder(i);
    extendSkin(mesh, material, .00008);
    // Every slot's program carries the Colour-shifting tint at zero (PREV-188): choosing the finish sets uniforms only.
    tints.set(material, installFresnelTint(material));
    attach(mesh);
    return { mesh, material, texture };
  }
  function setCanvases(canvases: HTMLCanvasElement[], ids: string[] = []) {
    // A preset/stack replacement owns fresh slot identities, even at equal length.
    // Never let an old slot's optical maps survive into a different authored layer.
    for (let i = 0; i < plates.length; i++) disposeSlot(i);
    plates.length = materials.length = textures.length = 0;
    blendDirty = true;
    layerIds = ids;
    for (let i = 0; i < canvases.length; i++) {
      const { mesh, material, texture } = createSlot(canvases[i], i);
      plates.push(mesh); materials.push(material); textures.push(texture);
    }
  }
  function reconcileLayerCanvases(ids: string[], canvases: HTMLCanvasElement[]) {
    if (ids.length !== canvases.length || layerIds.length !== plates.length) {
      setCanvases(canvases, ids); return;
    }
    const old = new Map(layerIds.map((id, i) => [id, i]));
    const retained = new Set(ids);
    for (let i = 0; i < layerIds.length; i++) if (!retained.has(layerIds[i])) disposeSlot(i);
    const next = ids.map((id, i) => {
      const prior = old.get(id);
      return prior === undefined ? createSlot(canvases[i], i) :
        { mesh: plates[prior], material: materials[prior], texture: textures[prior] };
    });
    plates.splice(0, plates.length, ...next.map(slot => slot.mesh));
    materials.splice(0, materials.length, ...next.map(slot => slot.material));
    textures.splice(0, textures.length, ...next.map(slot => slot.texture));
    layerIds = [...ids];
    blendDirty = true;
    for (let i = 0; i < plates.length; i++) {
      plates[i].name = `makeup_layer_${i + 1}`;
      plates[i].renderOrder = renderOrder(i);
    }
  }
  function setLayerCanvas(i: number, canvas: HTMLCanvasElement) {
    const old = textures[i], material = materials[i];
    if (!old || !material) return;
    blendDirty = true;
    const before = old.image as HTMLCanvasElement;
    if (before.width !== canvas.width || before.height !== canvas.height) {
      const next = maskTexture(canvas);
      textures[i] = next; if (!flakes.get(material)?.albedo) material.map = next; old.dispose();
    } else {
      old.image = canvas; old.needsUpdate = true; if (!flakes.get(material)?.albedo) material.map = old;
    }
  }
  function needsOptics(i: number, layer: Layer, size: number) {
    return layer.enabled && textured(layer) && flakes.get(materials[i])?.key !== keyFor(layer, size);
  }
  function needsAlbedo(i:number,layer:Layer,size:number) {
    const key=albedoKeyFor(layer,size);
    return !!layer.enabled && !!key && flakes.get(materials[i])?.albedoKey!==key;
  }
  function updateLayer(i: number, layer: Layer, optics?: BakedOptics, albedo?: BakedAlbedo, completeMask=false) {
    const material = materials[i];
    if (!material) return;
    blendDirty = true;
    if (!layer.enabled) { clearFlakes(material);clearDirect(material);clearTint(material); plates[i].visible = false; applied.set(material, layer); return; }
    // The shader is cheap to configure, but must never run against a prior
    // layer/shape mask while the cancellable raster worker is still pending.
    if(layer.finish==="glitter" && isDirectGlint(layer.flakes) && !completeMask)return;
    const size = (textures[i].image as HTMLCanvasElement).width;
    if (size<32 && layer.finish==="glitter" && isIrregular(layer.flakes)) return;
    const useMaps = textured(layer), key = keyFor(layer, size);
    const directSettings=layer.finish==="glitter" && isDirectGlint(layer.flakes)?layer.flakes:undefined;
    const candidateKey=albedoKeyFor(layer,size);
    if (candidateKey && (!albedo || albedo.key!==candidateKey || albedo.data.length!==size*size*4)) return;
    if (useMaps && flakes.get(material)?.key !== key) {
      // A new layer stays hidden; an existing one retains its last complete look.
      // Main publishes a new mask and its matching optics together in one turn.
      if (!optics) return;
      const grain = canonicalFinish(layer.finish) === "shimmer" && !!layer.optics;
      if (grain !== isGrainOptics(optics)) throw new Error("Game-matched Shimmer takes its grain maps; other layers their flake maps.");
      let next: {key:string;normal:THREE.DataTexture;surface:THREE.DataTexture;albedo?:THREE.DataTexture;albedoKey?:string;window?:UvWindow};
      if (isGrainOptics(optics)) {
        // The grain's own grid over its window: the export route's mode-1 facet fade and variance-widened roughness mips.
        const levels = mipDimensions(optics.width, optics.height);
        const fits = (chain: Uint8Array[]) => chain.length === levels.length && chain.every((level, k) => level.length === levels[k].width * levels[k].height * 4);
        if (!fits(optics.normal) || !fits(optics.surface)) throw new Error("Grain maps must be complete chains over their window.");
        const map = (chain: Uint8Array<ArrayBuffer>[]) => {
          const texture = new THREE.DataTexture(chain[0], optics.width, optics.height);
          texture.flipY = false; texture.generateMipmaps = false;
          texture.mipmaps = chain.map((data, k) => ({ data, ...levels[k] })) as unknown as typeof texture.mipmaps;
          texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
          // Head UV to the window's texture UV: the layer's own material reads it through Three's map transform, the composite
          // through the same matrix (plate-composite.ts).
          const w = optics.window, su = 1 / (w.u1 - w.u0), sv = 1 / (w.v1 - w.v0);
          texture.repeat.set(su, sv); texture.offset.set(-w.u0 * su, -w.v0 * sv); texture.updateMatrix();
          texture.anisotropy = anisotropy; texture.needsUpdate = true;
          return texture;
        };
        next = { key, normal: map(optics.normal), surface: map(optics.surface), window: { ...optics.window } };
      } else {
        if (optics.size !== size || optics.normal.length !== size * size * 4 || optics.surface.length !== size * size * 4)
          throw new Error("Optical maps must match the completed preview mask size.");
        const map = (data: Uint8Array<ArrayBuffer>) => {
          const texture = new THREE.DataTexture(data, size, size);
          texture.flipY = false; texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
          texture.anisotropy = anisotropy; texture.needsUpdate = true;
          return texture;
        };
        next = { key, normal: map(optics.normal), surface: map(optics.surface) };
      }
      clearFlakes(material); flakes.set(material, next);
    } else if (!useMaps) clearFlakes(material);
    if(directSettings){
      let glint=direct.get(material);
      if(!glint){glint=installProceduralGlintStudy(material);direct.set(material,glint);}
      glint.setShape("polygon");glint.setProductionProfile(true);glint.setEnabled(true);glint.setDensity(directSettings.density);
      glint.setClusteredProfile(directSettings.model==="uv-cell-direct-2");
      glint.setFineSpeckleProfile(directSettings.model==="uv-cell-direct-3");
      glint.setFineShare(directSettings.fineShare);glint.setStrength(directSettings.strength);
      glint.setSeed(directSettings.seed);glint.setColor(directSettings.color);glint.setBodyColor(layer.color);
    }else clearDirect(material);
    // Game-matched Colour-shifting: the gradient-recolour decal's additive Fresnel colour.
    const shift = canonicalFinish(layer.finish) === "iridescent" ? layer.optics?.shift : undefined;
    if (shift) tints.get(material)?.set(shift.color, shift.strength);
    else clearTint(material);
    const maps = flakes.get(material), changed = Boolean(material.normalMap) !== Boolean(maps);
    if (candidateKey && maps && maps.albedoKey!==candidateKey) {
      if (maps.albedo) maps.albedo.dispose();
      maps.albedo= new THREE.DataTexture(albedo!.data,size,size);
      maps.albedo.flipY=false;maps.albedo.generateMipmaps=true;
      maps.albedo.minFilter=THREE.LinearMipmapLinearFilter;maps.albedo.magFilter=THREE.LinearFilter;
      maps.albedo.anisotropy=anisotropy;maps.albedo.colorSpace=THREE.SRGBColorSpace;maps.albedo.needsUpdate=true;
      maps.albedoKey=candidateKey;
    }
    material.map = maps?.albedo ?? textures[i]; material.color.set(candidateKey ? "#ffffff" : layer.color);
    material.normalMap = maps?.normal ?? null;
    material.roughnessMap = material.metalnessMap = maps?.surface ?? null;
    const finish = canonicalFinish(layer.finish), game = !!layer.optics;
    // Game-matched models follow the export surfaces; earlier layers keep their original study values.
    // Earlier Colour-shifting used the Metallic surface and earlier Glossy a softer base under its clear coat.
    const surface = game && finish === "iridescent" ? FRESNEL_SURFACE : !game && finish === "glossy" ? EARLIER_GLOSSY_BASE
      : !game && finish === "iridescent" ? flatSurface("metallic")! : flatSurface(finish) ?? flatSurface("regular")!;
    material.roughness = directSettings ? .55 : useMaps ? 1 : surface.roughness;
    material.metalness = useMaps ? 1 : surface.metalness;
    // The G-buffer holds one lobe: the game-matched Glossy has no clear coat.
    material.clearcoat = directSettings ? .4 : finish === "glossy" && !game ? 1 : 0; material.clearcoatRoughness = directSettings ? .24 : .08;
    material.iridescence = finish === "iridescent" && !game ? 1 : 0; material.iridescenceIOR = 1.3;
    material.iridescenceThicknessRange = [400, 400];
    if (changed) material.needsUpdate = true;
    plates[i].visible = true; textures[i].needsUpdate = true;
    // What the composite reads for this slot: the layer as now fully applied (an incomplete update above keeps the last one).
    applied.set(material, layer);
  }
  /**
   * Stand-ins for the programs a finish choice switches a layer's own plate to (`prewarmFinishes`): kept, never drawn, since a released
   * material releases its program.
   */
  const standIns: { mesh: THREE.SkinnedMesh; material: THREE.MeshPhysicalMaterial; textures: THREE.Texture[]; release: () => void }[] = [];
  /**
   * Compile, in the background, the layer programs a finish choice can switch a layer's own plate to (PREV-188; readiness audit item 1):
   * the Glitter models' glints (the default Glitter model draws on its own plate) and the flake maps (classic Glitter; Shimmer on its own
   * plate). Three shares one program between materials of one configuration, so the layer that then takes the finish links nothing;
   * Colour-shifting needs none (its tint is a uniform in every slot, `installFresnelTint`). `compile` is the scene's (`SceneHostPort.compile`):
   * off the page's thread. Call it again after the lights change; programs already made are found at once.
   */
  function prewarmFinishes(compile: (object: THREE.Object3D) => Promise<void>): Promise<void> {
    if (!standIns.length) {
      const pixel = (bytes: number[], srgb = false) => {
        const texture = new THREE.DataTexture(new Uint8Array(bytes), 1, 1);
        if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false; texture.needsUpdate = true;
        return texture;
      };
      const standIn = (configure: (material: THREE.MeshPhysicalMaterial, textures: THREE.Texture[]) => () => void) => {
        const mesh = copy(), map = pixel([255, 255, 255, 255], true);
        // As `createSlot` makes a layer's material, then as `updateLayer` sets it up for the finish.
        const material = new THREE.MeshPhysicalMaterial({ map, transparent: true, depthWrite: false, roughness: .85, side: THREE.DoubleSide, wireframe });
        mesh.name = "makeup_layer_standin"; mesh.material = material;
        extendSkin(mesh, material, .00008);
        const tint = installFresnelTint(material);
        const textures = [map];
        const release = configure(material, textures);
        standIns.push({ mesh, material, textures, release: () => { release(); tint.dispose(); } });
      };
      // The Glitter models' glints (direct glint: its shader and the clear coat).
      standIn(material => {
        const glint = installProceduralGlintStudy(material);
        material.roughness = .55; material.metalness = 0; material.clearcoat = .4; material.clearcoatRoughness = .24;
        return () => glint.dispose();
      });
      // Flake maps: normal, and the packed surface as roughness and metalness.
      standIn((material, textures) => {
        const normal = pixel([128, 128, 255, 255]), surface = pixel([255, 255, 255, 255]);
        textures.push(normal, surface);
        material.normalMap = normal; material.roughnessMap = material.metalnessMap = surface; material.roughness = 1; material.metalness = 1;
        return () => {};
      });
    }
    for (const entry of standIns) entry.material.wireframe = wireframe;
    return Promise.all(standIns.map(entry => compile(entry.mesh))).then(() => undefined);
  }
  /** Where the skin under the plate comes from; read lazily (once per head or skin change) the first time a layer needs it. */
  function setUnderlaySource(source: (() => PlateUnderlay | null) | null) {
    underlaySource = source; underlayStale = true; blendDirty = true;
  }
  /**
   * Put the skin under the plate on the stack's geometry. A later skin of the same vertex count is copied into the attributes already
   * there (one buffer update each, PREV-60); only a different shape replaces them (the surface's vertex count never changes, so the
   * old attributes' buffers wait for the renderer's own teardown: freeing the geometry would free the anchor's shared buffers too).
   * Without a skin the attributes stay: nothing draws with them then.
   */
  function applyUnderlay(next: PlateUnderlay | null) {
    underlay = next;
    if (!next) return;
    const incoming: [string, THREE.BufferAttribute][] = [[STACK_ATTRIBUTES[0], next.colour], [STACK_ATTRIBUTES[1], next.roughness], [STACK_ATTRIBUTES[2], next.metalness]];
    const current = incoming.map(([name]) => geometry.getAttribute(name) as THREE.BufferAttribute | undefined);
    const fits = incoming.every(([, attribute], i) => current[i] && current[i]!.itemSize === attribute.itemSize && current[i]!.array.length === attribute.array.length);
    if (fits) {
      incoming.forEach(([, attribute], i) => { current[i]!.copyArray(attribute.array); current[i]!.needsUpdate = true; });
      return;
    }
    for (const [name, attribute] of incoming) geometry.setAttribute(name, attribute);
  }
  /** After a lost WebGL context comes back: the composite's targets came back empty, so the next frame redraws them (PREV-58). */
  function contextRestored() { blendDirty = true; }
  /**
   * Before a frame: bring the plate up to date after a change (the export plan over the drawn layers, the skin underlay, then the
   * composite). Nothing runs when nothing changed, so an idle viewport costs nothing here.
   */
  function prepareBlend(renderer: THREE.WebGLRenderer) {
    if (!blendDirty) return;
    blendDirty = false;
    // The export's own plan over the layers as drawn: which it carries in its one decal, and by which route.
    const shown = materials.map((material, i) => plates[i].visible ? applied.get(material) : undefined);
    const plan = planPresetExport({ layers: shown.filter((layer): layer is Layer => !!layer) });
    const carried = new Set(plan.included);
    let slots = shown.flatMap((layer, i) => layer && carried.has(layer) ? [i] : []);
    if (slots.length && underlayStale) {
      underlayStale = false;
      let next: PlateUnderlay | null = null;
      try { next = underlaySource?.() ?? null; } catch { next = null; }
      applyUnderlay(next);
    }
    // Without the skin under the plate every layer keeps its own plate and linear blend.
    if (!underlay) slots = [];
    const drawn = new Set(slots);
    materials.forEach((material, i) => { material.visible = !drawn.has(i); });
    merged = { slots, route: slots.length ? plan.route : null };
    if (!slots.length) { plate.visible = false; plateLight.handle.setComposite(null, composite.window); composite.release(); return; }
    const maskSize = Math.max(1, ...slots.map(i => (materials[i]!.map?.image as { width?: number } | undefined)?.width ?? 1));
    // With Shimmer's grain merged, the composite holds one texel per grain (the export's own pitch), whatever the masks' size, within
    // the grain's texel budget (the eye plate's rectangle takes about 1.2 M of its 2 M texels; a far larger surface gets a coarser composite).
    const grain = slots.some(i => !!flakes.get(materials[i]!)?.window), w = composite.window;
    const fit = Math.floor(Math.sqrt(SHIMMER_GRAIN.previewMaxTexels / ((w.u1 - w.u0) * (w.v1 - w.v0))));
    const density = Math.max(maskSize, grain ? Math.min(SHIMMER_GRAIN.cellsPerUv, fit) : 0);
    plateLight.handle.setComposite(composite.update(renderer, slots.map(i => materials[i]!), density, anisotropy), composite.window);
    plateLight.handle.setFresnel(plan.route === "fresnel" ? plan.included[0]?.optics?.shift ?? null : null);
    plate.renderOrder = renderOrder(slots[0]!);
    plate.visible = true;
  }
  /** Light the plate with the drawn skin's own light (its profile), or with Three's standard light when no resolved skin is drawn. */
  function setSkinLight(parameters: SkinLight | null) { plateLight.handle.setSkinLight(parameters); }
  function blendDiagnostics() {
    const size = composite.size;
    return { window: composite.window, underlay: !!underlay, underlayStale, dirty: blendDirty, compositeBytes: composite.bytes(), halfFloat: composite.halfFloat,
      plate: { drawn: plate.visible, route: merged.route, slots: [...merged.slots], renderOrder: plate.renderOrder,
        skinLight: plateLight.handle.skinLight, fresnel: plateLight.handle.fresnel,
        composite: plate.visible && size ? { width: size.width, height: size.height } : null, compositeDraws: composite.stats },
      layers: materials.map((material, i) => { const layer = applied.get(material);
        return { merged: merged.slots.includes(i), exportable: !!layer && layerExport(layer).exportable, ownPlate: plates[i].visible && material.visible }; }) };
  }
  function diagnostics() {
    return materials.map((material, i) => {
      const dimensions = (texture: THREE.Texture | null | undefined) => {
        const image = texture?.image as { width?: number; height?: number } | undefined;
        return image?.width && image.height ? { width: image.width, height: image.height } : null;
      };
      const mask = dimensions(textures[i]), normal = dimensions(material.normalMap), surface = dimensions(material.roughnessMap), albedo=dimensions(flakes.get(material)?.albedo);
      const allocated = [mask, normal, surface, albedo].filter((value): value is { width: number; height: number } => value !== null);
      const baseBytes = allocated.reduce((sum, image) => sum + image.width * image.height * 4, 0);
      return { i, visible: plates[i].visible, directGlints:direct.has(material), mask, normal, surface, albedo, albedoKey:flakes.get(material)?.albedoKey,
        opticalKey:flakes.get(material)?.key, mapCount: allocated.length, baseBytes,
        estimatedGPUBytesWithMips: allocated.reduce((sum, image) => {
          let width = image.width, height = image.height, bytes = 0;
          do { bytes += width * height * 4; if (width === 1 && height === 1) break;
            width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); } while (true);
          return sum + bytes;
        }, 0) };
    });
  }
  /**
   * Release every layer slot, the lit plate, the composite and the stack's own geometry (PREV-100). The geometry shares the anchor's
   * index, attributes and morph targets, which the platform's surface still draws, so they are taken off it first: the renderer's
   * dispose then frees only what is the stack's (the skin underlay's attributes, the geometry's vertex-array states, its wireframe
   * index and morph texture), and the anchor is as the stack found it.
   */
  function dispose() {
    setCanvases([]);
    for (const entry of standIns.splice(0)) { entry.release(); entry.material.dispose(); for (const texture of entry.textures) texture.dispose(); }
    composite.dispose();
    plate.removeFromParent(); plateLight.material.dispose();
    const own = new Set<string>(STACK_ATTRIBUTES);
    geometry.setIndex(null);
    for (const name of Object.keys(geometry.attributes)) if (!own.has(name)) geometry.deleteAttribute(name);
    geometry.morphAttributes = {};
    geometry.dispose();
  }
  return { plates, materials, textures, plate, geometry, setCanvases, reconcileLayerCanvases, dispose,
    setLayerCanvas, needsOptics, needsAlbedo, updateLayer, diagnostics, setUnderlaySource, setSkinLight, prepareBlend, blendDiagnostics, contextRestored, prewarmFinishes,
    setNormals(value: boolean) { plateLight.handle.setNormals(value); },
    setWire(value: boolean) { wireframe = value; plateLight.material.wireframe = value; for (const m of materials) m.wireframe = value; } };
}
