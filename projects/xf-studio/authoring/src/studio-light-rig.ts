import * as THREE from "three";
import { createStudioEnvironment } from "./studio-environment";
import { DEFAULT_STUDIO_LIGHTS, DEFAULT_KEY_ANGLE, lightDirection, STUDIO_BASE_INTENSITY, STUDIO_FILL_POSITION, STUDIO_LIGHT_COLOURS,
  STUDIO_LIGHT_TARGET, STUDIO_RIM_DIRECTION, type StudioLights } from "./studio-lighting";

/**
 * The studio stage's lights (Three adapter for `studio-lighting.ts`): the room environment (`studio-environment.ts`), a key, a
 * fill and a rim. The rim is always in the scene (at zero strength by default) so the number of directional lights, and with it
 * every lit program, never changes when it is turned up. The key comes first, as the glint shader's body colour expects.
 *
 * Every lit material follows these lights through Three's own light and environment uniforms: the skin light, the face decals
 * and the authored plate's single lit pass (plate-blend.ts) all read `directionalLights` and the environment scaled by
 * `scene.environmentIntensity` (or, without a half-float buffer, the room's light probe scaled by its intensity).
 */
export function createStudioLightRig(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const environment = createStudioEnvironment(renderer, scene);
  const target = new THREE.Vector3(...STUDIO_LIGHT_TARGET);
  const directional = (name: string, colour: number) => {
    const light = new THREE.DirectionalLight(colour, 0);
    light.name = name;
    light.target.position.copy(target);
    scene.add(light, light.target);
    return light;
  };
  const key = directional("xfs-studio-key", STUDIO_LIGHT_COLOURS.key);
  const fill = directional("xfs-studio-fill", STUDIO_LIGHT_COLOURS.fill);
  const rim = directional("xfs-studio-rim", STUDIO_LIGHT_COLOURS.rim);
  fill.position.set(...STUDIO_FILL_POSITION);
  // The original key's distance from the head; a directional light only uses the direction.
  const KEY_DISTANCE = Math.hypot(Math.hypot(0.3, 0.5), 1.9 - 1.67);
  rim.position.copy(target).addScaledVector(new THREE.Vector3(...lightDirection(STUDIO_RIM_DIRECTION.azimuth, STUDIO_RIM_DIRECTION.elevation)), KEY_DISTANCE);
  const tinted = { key: new THREE.Color(STUDIO_LIGHT_COLOURS.key), fill: new THREE.Color(STUDIO_LIGHT_COLOURS.fill), rim: new THREE.Color(STUDIO_LIGHT_COLOURS.rim) };
  // The same luminance without the tint (Rec. 709 weights in the linear working space).
  const neutral = Object.fromEntries(Object.entries(tinted).map(([name, colour]) =>
    [name, new THREE.Color().setScalar(0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b)])) as typeof tinted;
  let lights: StudioLights = { ...DEFAULT_STUDIO_LIGHTS }, angle = DEFAULT_KEY_ANGLE;
  const placeKey = () => key.position.copy(target).addScaledVector(new THREE.Vector3(...lightDirection(angle, lights.elevation)), KEY_DISTANCE);
  function apply() {
    const colours = lights.neutral ? neutral : tinted;
    key.color.copy(colours.key); fill.color.copy(colours.fill); rim.color.copy(colours.rim);
    key.intensity = STUDIO_BASE_INTENSITY.key * lights.key;
    fill.intensity = STUDIO_BASE_INTENSITY.fill * lights.fill;
    rim.intensity = STUDIO_BASE_INTENSITY.rim * lights.rim;
    scene.environmentIntensity = lights.environment;
    for (const light of environment.lights) (light as THREE.LightProbe).intensity = lights.environment;
    placeKey();
  }
  apply();
  return {
    environment,
    key, fill, rim,
    /** Hidden while the creator preset shows (lighting-preset-stage.ts), with the environment's stand-in probe. */
    lights: [key, fill, rim, ...environment.lights] as THREE.Object3D[],
    setLights(next: Readonly<StudioLights>) { lights = { ...next }; apply(); },
    setKeyAngle(degrees: number) { angle = degrees; placeKey(); },
    /** Evidence: what the lights are set to now. */
    state: () => ({ lights: { ...lights }, angle, environmentMode: environment.mode }),
    restore: () => environment.restore(),
    dispose() {
      for (const light of [key, fill, rim]) { light.removeFromParent(); light.target.removeFromParent(); light.dispose(); }
      environment.dispose();
    },
  };
}
export type StudioLightRig = ReturnType<typeof createStudioLightRig>;
