import * as THREE from "three";

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
