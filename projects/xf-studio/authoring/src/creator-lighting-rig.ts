import * as THREE from "three";
import { creatorRigSpecs, type BodySex, type CreatorLightingOptions, type SpotLightSpec } from "./creator-lighting";

/**
 * Three adapter for the creator light rig (creator-lighting.ts): one `SpotLight` per rig row, rebuilt when
 * the body sex or a diagnostic switch changes. Hidden (and so absent from the light count) until the creator
 * preset shows it. No shadows yet: the Studio has no shadow maps (knowledge/creator-lighting.md §7).
 */
export function createCreatorLightRig() {
  const group = new THREE.Group();
  group.name = "xfs-creator-light-rig";
  group.visible = false;
  let specs: SpotLightSpec[] = [];
  const clear = () => {
    for (const child of [...group.children]) { group.remove(child); if (child instanceof THREE.SpotLight) child.dispose(); }
  };
  return {
    group,
    /** Rebuild the rig for a body sex under the intensity and cone switches. */
    apply(sex: BodySex, options: Pick<CreatorLightingOptions, "intensity" | "cone">) {
      clear();
      specs = creatorRigSpecs(sex, options);
      for (const spec of specs) {
        const light = new THREE.SpotLight(new THREE.Color().setRGB(...spec.colour, THREE.LinearSRGBColorSpace),
          spec.intensity, spec.distance, spec.angle, spec.penumbra, spec.decay);
        light.name = `xfs-creator-${spec.name}`;
        light.position.set(...spec.position);
        light.target.position.set(...spec.target);
        light.castShadow = false;
        group.add(light, light.target);
      }
    },
    get specs(): readonly SpotLightSpec[] { return specs; },
    dispose() { clear(); group.removeFromParent(); },
  };
}
export type CreatorLightRig = ReturnType<typeof createCreatorLightRig>;
