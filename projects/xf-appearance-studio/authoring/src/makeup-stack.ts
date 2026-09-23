import * as THREE from "three";
import { extendSkin } from "./skin";
import { canonicalFinish, defaultFlakes } from "./finish";
import type { Layer } from "./recipe";

export type BakedOptics = { size: number; normal: Uint8Array<ArrayBuffer>; surface: Uint8Array<ArrayBuffer> };

/** Owns layer GPU resources; complete worker bundles supply generated optical maps. */
export function createMakeupStack(anchor: THREE.SkinnedMesh, anisotropy: number) {
  const plates: THREE.SkinnedMesh[] = [], materials: THREE.MeshPhysicalMaterial[] = [], textures: THREE.CanvasTexture[] = [];
  const flakes = new Map<THREE.Material, { key: string; normal: THREE.DataTexture; surface: THREE.DataTexture }>();
  anchor.visible = false;
  const anchorMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  anchor.material = anchorMaterial;
  extendSkin(anchor, anchorMaterial);
  let wireframe = false;
  const textured = (layer: Layer) => ["shimmer", "glitter"].includes(canonicalFinish(layer.finish));
  const keyFor = (layer: Layer, size: number) => JSON.stringify([canonicalFinish(layer.finish), layer.flakes ?? defaultFlakes(), size]);
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
      maps.normal.dispose(); maps.surface.dispose(); flakes.delete(material);
    }
  }
  function setCanvases(canvases: HTMLCanvasElement[]) {
    // A preset/stack replacement owns fresh slot identities, even at equal length.
    // Never let an old slot's optical maps survive into a different authored layer.
    while (plates.length) {
      const material = materials.pop()!;
      clearFlakes(material); material.dispose(); textures.pop()!.dispose(); plates.pop()!.removeFromParent();
    }
    for (let i = 0; i < canvases.length; i++) {
      const mesh = anchor.clone(), texture = maskTexture(canvases[i]);
      const material = new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false,
        roughness: .85, side: THREE.DoubleSide, wireframe });
      mesh.name = `makeup_layer_${i + 1}`; mesh.material = material; mesh.skeleton = anchor.skeleton;
      mesh.morphTargetInfluences = anchor.morphTargetInfluences;
      mesh.renderOrder = 10 + i;
      // One preview clearance regardless of count; all native skin influences remain.
      extendSkin(mesh, material, .00008);
      anchor.parent!.add(mesh);
      plates.push(mesh); materials.push(material); textures.push(texture);
      mesh.visible = false;
    }
  }
  function setLayerCanvas(i: number, canvas: HTMLCanvasElement) {
    const old = textures[i], material = materials[i];
    if (!old || !material) return;
    const before = old.image as HTMLCanvasElement;
    if (before.width !== canvas.width || before.height !== canvas.height) {
      const next = maskTexture(canvas);
      textures[i] = next; material.map = next; old.dispose();
    } else {
      old.image = canvas; old.needsUpdate = true; material.map = old;
    }
  }
  function needsOptics(i: number, layer: Layer, size: number) {
    return layer.enabled && textured(layer) && flakes.get(materials[i])?.key !== keyFor(layer, size);
  }
  function updateLayer(i: number, layer: Layer, optics?: BakedOptics) {
    const material = materials[i];
    if (!material) return;
    if (!layer.enabled) { clearFlakes(material); plates[i].visible = false; return; }
    const size = (textures[i].image as HTMLCanvasElement).width;
    const useMaps = textured(layer), key = keyFor(layer, size);
    if (useMaps && flakes.get(material)?.key !== key) {
      // A new layer stays hidden; an existing one retains its last complete look.
      // Main publishes a new mask and its matching optics together in one turn.
      if (!optics) return;
      if (optics.size !== size || optics.normal.length !== size * size * 4 || optics.surface.length !== size * size * 4)
        throw new Error("Optical maps must match the completed preview mask size.");
      const map = (data: Uint8Array<ArrayBuffer>) => {
        const texture = new THREE.DataTexture(data, size, size);
        texture.flipY = false; texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = anisotropy; texture.needsUpdate = true;
        return texture;
      };
      const next = { key, normal: map(optics.normal), surface: map(optics.surface) };
      clearFlakes(material); flakes.set(material, next);
    } else if (!useMaps) clearFlakes(material);
    const maps = flakes.get(material), changed = Boolean(material.normalMap) !== Boolean(maps);
    material.map = textures[i]; material.color.set(layer.color);
    material.normalMap = maps?.normal ?? null;
    material.roughnessMap = material.metalnessMap = maps?.surface ?? null;
    const finish = canonicalFinish(layer.finish);
    material.roughness = useMaps ? 1 : finish === "matte" ? .88 : finish === "metallic" || finish === "iridescent" ? .27 : finish === "glossy" ? .16 : .38;
    material.metalness = useMaps ? 1 : finish === "metallic" || finish === "iridescent" ? .65 : 0;
    material.clearcoat = finish === "glossy" ? 1 : 0; material.clearcoatRoughness = .08;
    material.iridescence = finish === "iridescent" ? 1 : 0; material.iridescenceIOR = 1.3;
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
      const mask = dimensions(textures[i]), normal = dimensions(material.normalMap), surface = dimensions(material.roughnessMap);
      const allocated = [mask, normal, surface].filter((value): value is { width: number; height: number } => value !== null);
      const baseBytes = allocated.reduce((sum, image) => sum + image.width * image.height * 4, 0);
      return { i, visible: plates[i].visible, mask, normal, surface, mapCount: allocated.length, baseBytes,
        estimatedGPUBytesWithMips: allocated.reduce((sum, image) => {
          let width = image.width, height = image.height, bytes = 0;
          do { bytes += width * height * 4; if (width === 1 && height === 1) break;
            width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); } while (true);
          return sum + bytes;
        }, 0) };
    });
  }
  return { plates, materials, textures, setCanvases, setLayerCanvas, needsOptics, updateLayer, diagnostics,
    setWire(value: boolean) { wireframe = value; for (const m of materials) m.wireframe = value; } };
}
