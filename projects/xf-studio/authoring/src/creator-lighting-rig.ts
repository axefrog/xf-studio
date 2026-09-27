import * as THREE from "three";
import { CREATOR_HEAD_SLOT, CREATOR_SHADOW, creatorRigSpecs, creatorShadowRadius, type BodySex, type CreatorLightingOptions,
  type SpotLightSpec, type Vec3 } from "./creator-lighting";

/**
 * Aim a spot light's shadow at the V's head rather than along the light's axis: a square frustum from the light that just covers
 * `radius` around the head slot, so a wide rim cone still spends its whole map on the head and shoulders
 * (knowledge/creator-lighting.md §12). The light itself (cone, target, falloff) is unchanged. Three doesn't export its spot shadow
 * class, so the instance's own `updateMatrices` is replaced.
 */
export function aimShadowAtHead(shadow: THREE.SpotLight["shadow"], focus: THREE.Vector3, radius: number) {
  const position = new THREE.Vector3();
  shadow.updateMatrices = function updateMatrices(light: THREE.Light) {
    const camera = this.camera;
    position.setFromMatrixPosition(light.matrixWorld);
    const distance = Math.max(position.distanceTo(focus), radius * 1.5);
    const fov = 2 * Math.atan(radius / distance) * 180 / Math.PI;
    const near = Math.max(0.05, distance - 2 * radius), far = distance + 2 * radius;
    if (camera.fov !== fov || camera.aspect !== 1 || camera.near !== near || camera.far !== far) {
      camera.fov = fov; camera.aspect = 1; camera.near = near; camera.far = far;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(position);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    const internal = this as unknown as { _updateMatrix(camera: THREE.Camera, matrix: THREE.Matrix4, frustum: THREE.Frustum): void; _frustum: THREE.Frustum };
    internal._updateMatrix(camera, this.matrix, internal._frustum);
  };
}

/**
 * Three adapter for the creator light rig (creator-lighting.ts): one `SpotLight` per rig row, rebuilt when the body sex or a
 * calibration switch changes. Hidden (and so absent from the light count) until the creator preset shows it. The lights the data
 * flag for shadows (`creatorShadowCasters`) cast a head-scoped shadow map whose size follows the preview quality.
 */
export function createCreatorLightRig() {
  const group = new THREE.Group();
  group.name = "xfs-creator-light-rig";
  group.visible = false;
  let specs: SpotLightSpec[] = [];
  let mapSize = 1024;
  const clear = () => {
    for (const child of [...group.children]) { group.remove(child); if (child instanceof THREE.SpotLight) child.dispose(); }
  };
  const configureShadow = (light: THREE.SpotLight) => {
    const shadow = light.shadow;
    shadow.map?.dispose();
    shadow.map = null;
    shadow.mapSize.set(mapSize, mapSize);
    shadow.bias = CREATOR_SHADOW.bias;
    shadow.normalBias = CREATOR_SHADOW.normalBias;
    shadow.radius = creatorShadowRadius(mapSize);
  };
  return {
    group,
    /** Rebuild the rig for a body sex under the calibration switches. */
    apply(sex: BodySex, options: Pick<CreatorLightingOptions, "intensity" | "cone" | "shadows"> & { yawOffset?: number }) {
      clear();
      specs = creatorRigSpecs(sex, options);
      const head: Vec3 = CREATOR_HEAD_SLOT[sex];
      for (const spec of specs) {
        const light = new THREE.SpotLight(new THREE.Color().setRGB(...spec.colour, THREE.LinearSRGBColorSpace),
          spec.intensity, spec.distance, spec.angle, spec.penumbra, spec.decay);
        light.name = `xfs-creator-${spec.name}`;
        light.position.set(...spec.position);
        light.target.position.set(...spec.target);
        light.castShadow = spec.castShadow;
        if (spec.castShadow) {
          aimShadowAtHead(light.shadow, new THREE.Vector3(...head), CREATOR_SHADOW.focusRadius);
          configureShadow(light);
        }
        group.add(light, light.target);
      }
    },
    /** The shadow maps' size (the preview quality's; creatorShadowMapSize). */
    setShadowMapSize(size: number) {
      if (size === mapSize) return;
      mapSize = size;
      for (const child of group.children) if (child instanceof THREE.SpotLight && child.castShadow) configureShadow(child);
    },
    get shadowMapSize() { return mapSize; },
    get specs(): readonly SpotLightSpec[] { return specs; },
    dispose() { clear(); group.removeFromParent(); },
  };
}
export type CreatorLightRig = ReturnType<typeof createCreatorLightRig>;
