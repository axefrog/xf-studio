import * as THREE from "three";
import { extendSkin } from "./skin";
import { bakeFlakes, canonicalFinish, defaultFlakes } from "./finish";
import type { Layer } from "./recipe";

/** Owns layer GPU resources; the hidden source plate remains the stable picking/morph anchor. */
export function createMakeupStack(anchor: THREE.SkinnedMesh, anisotropy: number) {
  const plates: THREE.SkinnedMesh[] = [], materials: THREE.MeshPhysicalMaterial[] = [], textures: THREE.CanvasTexture[] = [];
  const flakes = new Map<THREE.Material, { key: string; normal: THREE.DataTexture; surface: THREE.DataTexture }>();
  anchor.visible = false;
  const anchorMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  anchor.material = anchorMaterial;
  extendSkin(anchor, anchorMaterial);
  let wireframe = false;
  function clearFlakes(material: THREE.Material) {
    const maps = flakes.get(material);
    if (maps) { maps.normal.dispose(); maps.surface.dispose(); flakes.delete(material); }
  }
  function setCanvases(canvases: HTMLCanvasElement[]) {
    while (plates.length > canvases.length) {
      const material = materials.pop()!;
      clearFlakes(material); material.dispose(); textures.pop()!.dispose(); plates.pop()!.removeFromParent();
    }
    for (let i = 0; i < canvases.length; i++) {
      if (i >= plates.length) {
        const mesh = anchor.clone(), texture = new THREE.CanvasTexture(canvases[i]);
        texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = anisotropy;
        const material = new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false,
          roughness: .85, side: THREE.DoubleSide, wireframe });
        mesh.name = `makeup_layer_${i + 1}`; mesh.material = material; mesh.skeleton = anchor.skeleton;
        mesh.morphTargetInfluences = anchor.morphTargetInfluences;
        mesh.renderOrder = 10 + i;
        // One small preview clearance, independent of count. Explicit draw order
        // handles transparent layers; adding layers must not inflate the face.
        extendSkin(mesh, material, .00008);
        anchor.parent!.add(mesh);
        plates.push(mesh); materials.push(material); textures.push(texture);
      }
      textures[i].image = canvases[i]; textures[i].needsUpdate = true;
      // Avoid displaying previous slot content until the owner supplies its recipe.
      plates[i].visible = false;
    }
  }
  function updateLayer(i: number, layer: Layer) {
    const material = materials[i];
    if (!material) return;
    material.color.set(layer.color);
    const finish = canonicalFinish(layer.finish), params = layer.flakes ?? defaultFlakes();
    const textured = finish === "shimmer" || finish === "glitter", key = JSON.stringify([finish, params]);
    const old = flakes.get(material);
    if (old && (!textured || old.key !== key)) clearFlakes(material);
    if (textured && !flakes.has(material)) {
      const baked = bakeFlakes(1024, finish, params);
      const map = (data: Uint8Array) => {
        const texture = new THREE.DataTexture(data, baked.size, baked.size);
        texture.flipY = false; texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = anisotropy; texture.needsUpdate = true;
        return texture;
      };
      flakes.set(material, { key, normal: map(baked.normal), surface: map(baked.surface) });
    }
    const maps = flakes.get(material), changed = Boolean(material.normalMap) !== Boolean(maps);
    material.normalMap = maps?.normal ?? null;
    material.roughnessMap = material.metalnessMap = maps?.surface ?? null;
    material.roughness = textured ? 1 : finish === "matte" ? .88 : finish === "metallic" || finish === "iridescent" ? .27 : finish === "glossy" ? .16 : .38;
    material.metalness = textured ? 1 : finish === "metallic" || finish === "iridescent" ? .65 : 0;
    material.clearcoat = finish === "glossy" ? 1 : 0; material.clearcoatRoughness = .08;
    material.iridescence = finish === "iridescent" ? 1 : 0; material.iridescenceIOR = 1.3;
    material.iridescenceThicknessRange = [400, 400];
    if (changed) material.needsUpdate = true;
    plates[i].visible = layer.enabled; textures[i].needsUpdate = true;
  }
  return { plates, materials, textures, setCanvases, updateLayer,
    setWire(value: boolean) { wireframe = value; for (const m of materials) m.wireframe = value; } };
}
