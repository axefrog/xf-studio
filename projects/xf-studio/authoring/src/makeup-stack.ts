import * as THREE from "three";
import { extendSkin } from "./skin";
import { canonicalFinish, defaultFlakes, isIrregular } from "./finish";
import {maskAlphaKey,studioIrregularOpticalKey,irregularAlbedoKey} from "./makeup-dependencies";
import type { Layer } from "./recipe";
import {installProceduralGlintStudy} from "./direct-glint";
import {isDirectGlint} from "./direct-glint-settings";
import {flatSurface,FRESNEL_SURFACE} from "./finish-export";
import {installFresnelTint} from "./fresnel-tint";
import {previewFacetChains} from "./route-mip-chains";
/** Base under the earlier Glossy preview's separate clear coat (preview only; the game-matched Glossy uses the export surface). */
const EARLIER_GLOSSY_BASE = { roughness: .16, metalness: 0 } as const;

export type BakedOptics = { size: number; normal: Uint8Array<ArrayBuffer>; surface: Uint8Array<ArrayBuffer> };
export type BakedAlbedo = {key:string; data:Uint8Array<ArrayBuffer>};

/** Owns layer GPU resources; complete worker bundles supply generated optical maps. */
export function createMakeupStack(anchor: THREE.SkinnedMesh, anisotropy: number) {
  const plates: THREE.SkinnedMesh[] = [], materials: THREE.MeshPhysicalMaterial[] = [], textures: THREE.CanvasTexture[] = [];
  const flakes = new Map<THREE.Material, { key: string; normal: THREE.DataTexture; surface: THREE.DataTexture; albedo?: THREE.DataTexture; albedoKey?:string }>();
  const direct=new Map<THREE.Material,ReturnType<typeof installProceduralGlintStudy>>();
  const tints=new Map<THREE.Material,ReturnType<typeof installFresnelTint>>();
  let layerIds: string[] = [];
  anchor.visible = false;
  const anchorMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  anchor.material = anchorMaterial;
  extendSkin(anchor, anchorMaterial);
  let wireframe = false;
  const textured = (layer: Layer) => ["shimmer", "glitter"].includes(canonicalFinish(layer.finish)) &&
    !isDirectGlint(layer.flakes);
  const keyFor = (layer: Layer, size: number) => isIrregular(layer.flakes) && layer.finish === "glitter"
    ? studioIrregularOpticalKey(layer.flakes,size)
    // Game-matched Shimmer bakes the same flakes but uploads route-filtered mip chains.
    : JSON.stringify([canonicalFinish(layer.finish), layer.flakes ?? defaultFlakes(), size, ...(layer.optics ? [layer.optics.model] : [])]);
  const albedoKeyFor = (layer:Layer,size:number) => isIrregular(layer.flakes) && layer.finish === "glitter"
    ? irregularAlbedoKey(studioIrregularOpticalKey(layer.flakes,size),maskAlphaKey(layer,size),layer.color,layer.flakes.color)
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
  function clearTint(material:THREE.MeshPhysicalMaterial){
    tints.get(material)?.dispose();tints.delete(material);
  }
  function disposeSlot(i: number) {
    const material = materials[i];
    clearFlakes(material); clearDirect(material); clearTint(material); material.dispose(); textures[i].dispose(); plates[i].removeFromParent();
  }
  function createSlot(canvas: HTMLCanvasElement, i: number) {
    const mesh = anchor.clone(), texture = maskTexture(canvas);
    const material = new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false,
      roughness: .85, side: THREE.DoubleSide, wireframe });
    mesh.name = `makeup_layer_${i + 1}`; mesh.material = material; mesh.skeleton = anchor.skeleton;
    mesh.morphTargetInfluences = anchor.morphTargetInfluences;
    mesh.renderOrder = 10 + i;
    extendSkin(mesh, material, .00008);
    anchor.parent!.add(mesh);
    mesh.visible = false;
    return { mesh, material, texture };
  }
  function setCanvases(canvases: HTMLCanvasElement[], ids: string[] = []) {
    // A preset/stack replacement owns fresh slot identities, even at equal length.
    // Never let an old slot's optical maps survive into a different authored layer.
    for (let i = 0; i < plates.length; i++) disposeSlot(i);
    plates.length = materials.length = textures.length = 0;
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
    for (let i = 0; i < plates.length; i++) {
      plates[i].name = `makeup_layer_${i + 1}`;
      plates[i].renderOrder = 10 + i;
    }
  }
  function setLayerCanvas(i: number, canvas: HTMLCanvasElement) {
    const old = textures[i], material = materials[i];
    if (!old || !material) return;
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
    if (!layer.enabled) { clearFlakes(material);clearDirect(material);clearTint(material); plates[i].visible = false; return; }
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
      if (optics.size !== size || optics.normal.length !== size * size * 4 || optics.surface.length !== size * size * 4)
        throw new Error("Optical maps must match the completed preview mask size.");
      // Game-matched Shimmer: the export route's mode-1 facet fade and variance-widened roughness mips.
      const chains = layer.optics ? previewFacetChains(optics.normal, optics.surface, size) : undefined;
      const map = (data: Uint8Array<ArrayBuffer>, levels?: Uint8Array[]) => {
        const texture = new THREE.DataTexture(levels ? levels[0] as Uint8Array<ArrayBuffer> : data, size, size);
        texture.flipY = false; texture.generateMipmaps = !levels;
        if (levels) texture.mipmaps = levels.map((level, k) => ({ data: level, width: size >> k || 1, height: size >> k || 1 })) as unknown as typeof texture.mipmaps;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = anisotropy; texture.needsUpdate = true;
        return texture;
      };
      const next: {key:string;normal:THREE.DataTexture;surface:THREE.DataTexture;albedo?:THREE.DataTexture;albedoKey?:string} =
        { key, normal: map(optics.normal, chains?.normal), surface: map(optics.surface, chains?.surface) };
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
    if (shift) {
      let tint = tints.get(material);
      if (!tint) { tint = installFresnelTint(material); tints.set(material, tint); }
      tint.set(shift.color, shift.strength);
    } else clearTint(material);
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
  return { plates, materials, textures, setCanvases, reconcileLayerCanvases,
    setLayerCanvas, needsOptics, needsAlbedo, updateLayer, diagnostics,
    setWire(value: boolean) { wireframe = value; for (const m of materials) m.wireframe = value; } };
}
