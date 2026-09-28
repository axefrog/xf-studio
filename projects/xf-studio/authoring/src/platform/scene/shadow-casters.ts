import * as THREE from "three";

/**
 * Which casters a light's shadow map holds (renderer adapter).
 *
 * The creator rig flags each light for shadow maps (`enableLocalShadows`) and for character contact shadows (`contactShadows`
 * `CSR_CharacterOnly`, a short screen-space march) [resource]. The preview gives both kinds a head-scoped shadow map (creator-lighting.ts
 * `CREATOR_SHADOW`): for a contact-only light that map is a stand-in for shadows the preview's own contact march resolves poorly (the
 * key's nose shadow). Hair strands in the stand-in did what no contact march can: the low rear rims (`Rim_Right`, `Rim_Left_Head`, both
 * contact-only) graze the side of the face, and the hair hanging behind the ear printed its strands across the cheek, jaw, ear and neck,
 * centimetres from the hair, which read as hair seen through the face (PREV-167, knowledge/hair-shading.md §8).
 *
 * So a contact-only light's map holds the body's own shapes alone (skin, body, clothing), and a light the game shadow-maps holds every
 * caster, hair strands included. Hair lying on the skin still shadows it through the contact-shadow pass
 * (platform/scene/contact-shadow.ts), whose march is 12 mm long.
 *
 * How: Three draws every caster into every map and tests layers against the view camera, not the light's, so the choice is made per
 * draw. The light's shadow camera carries the flag (`setBodyCastersOnly`); a strand kept out of such maps (`keepOutOfBodyOnlyShadows`)
 * draws there without writing depth or colour, and writes both as before into every other map.
 */
const BODY_ONLY = "xfsBodyCastersOnly";

/** Whether a light is shadowed in game only by the character contact march (a shadow map here is the preview's stand-in). */
export function contactOnly(game: { readonly localShadows: boolean; readonly contactShadows: string } | undefined): boolean {
  return !!game && !game.localShadows && game.contactShadows !== "none";
}

/** Mark a light's shadow map as holding the body's own shapes only (or every caster again). */
export function setBodyCastersOnly(shadow: THREE.LightShadow, bodyOnly: boolean) { shadow.camera.userData[BODY_ONLY] = bodyOnly; }
export const bodyCastersOnly = (shadow: THREE.LightShadow) => shadow.camera.userData[BODY_ONLY] === true;

/** Keep a caster (a hair strand mesh) out of the body-only maps: there its depth draw writes nothing. Idempotent. */
export function keepOutOfBodyOnlyShadows(mesh: THREE.Object3D) {
  if (mesh.userData.xfsKeptOutOfBodyShadows) return;
  mesh.userData.xfsKeptOutOfBodyShadows = true;
  let restore: { material: THREE.Material; depthWrite: boolean; colorWrite: boolean } | null = null;
  mesh.onBeforeShadow = (_renderer, _object, _camera, shadowCamera, _geometry, depthMaterial) => {
    if (shadowCamera.userData[BODY_ONLY] !== true) return;
    restore = { material: depthMaterial, depthWrite: depthMaterial.depthWrite, colorWrite: depthMaterial.colorWrite };
    depthMaterial.depthWrite = false;
    depthMaterial.colorWrite = false;
  };
  mesh.onAfterShadow = () => {
    if (restore) { restore.material.depthWrite = restore.depthWrite; restore.material.colorWrite = restore.colorWrite; }
    restore = null;
  };
}
