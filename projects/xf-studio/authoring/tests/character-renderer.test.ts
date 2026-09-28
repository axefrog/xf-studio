import { expect, test } from "bun:test";
import * as THREE from "three";
import { createCharacterRenderer } from "../src/platform/scene/character-renderer";
import type { HeadRig } from "../src/platform/scene/head-rig";
import type { LoadedCharacterComponent, LoadedCharacterDetails } from "../src/character-detail-loader";
import type { CharacterSlot, SupersededPart } from "../src/platform/api/scene";
import { setBodyCastersOnly } from "../src/platform/scene/shadow-casters";

// The platform's character renderer, driven as the scene host drives it (PREV-98): which of the V's parts show, how the skin goes on
// the head in both placements, what the scene port's character view and skin notices say, and what a feature superseding a whole slot
// or one creator option's components does (PREV-89, PREV-95, PREV-96). No GPU: the meshes are real, the renderer is a stub.

/** A small quad surface; the same quad makes a skin the core head can wear (core-head placement). */
function quad(offset = 0): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, offset, 1, 0, offset, 0, 1, offset, 1, 1, offset], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(16), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  return geometry;
}
const skinned = (geometry: THREE.BufferGeometry, name: string) => {
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  mesh.bind(new THREE.Skeleton([new THREE.Bone()]));
  return mesh;
};

function headRig() {
  const head = skinned(quad(), "head"), eyes = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial());
  const skin = new THREE.MeshStandardMaterial({ name: "default skin" });
  head.material = skin;
  const handle = { setSourceRoughness() {}, gradient: null, sourceRoughness: false, parameters: { roughnessScale: 1 } };
  const rig = { head, eyes, skin, coreEye: { handle }, motion: { rig: { attach() {}, detach() {} } },
    albedo: new THREE.Texture(), roughness: new THREE.Texture() };
  return rig as unknown as HeadRig;
}

const LIGHT = { lobes: { roughness0: 0.97, roughness1: 1.6, weight: 1 }, wrap: [0.3, 0.2, 0.2] as [number, number, number] };

function component(slot: CharacterSlot, option: string, meshes: THREE.SkinnedMesh[], extra: Partial<LoadedCharacterComponent> = {}): LoadedCharacterComponent {
  const root = new THREE.Group();
  root.add(...meshes);
  return { component: { id: `${slot}:${option}`, slot, option, definition: option, component: option, materials: [] } as never, root, meshes, bones: [], ...extra };
}
const skinComponent = (chunks: THREE.SkinnedMesh[]) => component("skin", "skin", chunks,
  { skin: { handle: { parameters: LIGHT, setNormals() {} }, base: () => null, roughness: () => null } as never });

/** A V: its identity and components, with the loader's adopt/dispose bookkeeping. */
function v(identity: string, components: LoadedCharacterComponent[]): LoadedCharacterDetails {
  return { record: { identity }, components, adopt() {}, dispose() {}, problems: [], limits: [] } as unknown as LoadedCharacterDetails;
}

function setup() {
  const rig = headRig(), scene = new THREE.Scene();
  let superseded: SupersededPart[] = [];
  const renderer = { capabilities: { getMaxAnisotropy: () => 8 } } as unknown as THREE.WebGLRenderer;
  const character = createCharacterRenderer({ scene, renderer, rig, superseded: () => superseded });
  const heard = { skin: [] as (string | null)[], character: [] as string[] };
  character.skin.subscribe(() => heard.skin.push(character.view().identity));
  character.subscribe(() => heard.character.push(JSON.stringify(character.view())));
  return { rig, scene, character, heard, supersede(parts: SupersededPart[]) { superseded = parts; character.refreshVisibility(); } };
}

test("the character view lists the slots shown now, the core-head skin included; skin listeners hear once per V switch (PREV-95, PREV-96)", () => {
  const { rig, character, heard } = setup();
  const wearable = skinned(quad(), "skin chunk");
  const brows = skinned(quad(0.01), "brows"), lips = skinned(quad(0.02), "lips"), liner = skinned(quad(0.03), "liner");
  const a = v("a", [skinComponent([wearable]), component("brows", "eyebrows", [brows]), component("face", "lips", [lips]), component("face", "eyeliner", [liner])]);
  character.setCharacterDetails(a);
  // The skin is drawn on the core head (no mesh of its own), and it counts as drawn.
  expect(rig.head.material).toBe(wearable.material);
  expect(character.view()).toEqual({ identity: "a", drawn: ["skin", "brows", "face"] });
  // One skin notice, with the new V already in place; one character notice.
  expect(heard.skin).toEqual(["a"]);
  expect(heard.character).toHaveLength(1);
  expect(character.skin.light()).toEqual(LIGHT);
  // A slot the viewer hides is not drawn, and the view says so.
  character.setSlotVisible("brows", false);
  expect(brows.parent!.visible).toBe(false);
  expect(character.view().drawn).toEqual(["skin", "face"]);
  expect(heard.character).toHaveLength(2);
  character.setSlotVisible("brows", true);
  // A V with a different skin: one notice again; the same V again: none.
  const b = v("b", [skinComponent([skinned(quad(), "other skin")])]);
  character.setCharacterDetails(b);
  character.setCharacterDetails(b);
  expect(heard.skin).toEqual(["a", "b"]);
  expect(character.view()).toEqual({ identity: "b", drawn: ["skin"] });
  // No V: the default skin, and one notice.
  character.setCharacterDetails(null);
  expect(rig.head.material).toBe(rig.skin);
  expect(heard.skin).toEqual(["a", "b", null]);
  expect(character.view()).toEqual({ identity: null, drawn: [] });
});

test("a feature supersedes one creator option's components, or a whole slot, and can change its mind (PREV-89)", () => {
  const { character, heard, supersede } = setup();
  const lips = skinned(quad(0.02), "lips"), liner = skinned(quad(0.03), "liner"), brows = skinned(quad(0.01), "brows");
  character.setCharacterDetails(v("a", [component("face", "lips", [lips]), component("face", "eyeliner", [liner]), component("brows", "eyebrows", [brows])]));
  // A lips feature replaces the lips decal only: the V's other face decals stay.
  supersede([{ slot: "face", options: ["lips"] }]);
  expect([lips.parent!.visible, liner.parent!.visible, brows.parent!.visible]).toEqual([false, true, true]);
  expect(character.view().drawn).toEqual(["face", "brows"]);
  // A brow feature supersedes brows only while it has its own.
  supersede([{ slot: "face", options: ["lips"] }, { slot: "brows" }]);
  expect(brows.parent!.visible).toBe(false);
  expect(character.view().drawn).toEqual(["face"]);
  supersede([{ slot: "face", options: ["lips"] }]);
  expect(brows.parent!.visible).toBe(true);
  // The whole slot.
  supersede([{ slot: "face" }]);
  expect([lips.parent!.visible, liner.parent!.visible]).toEqual([false, false]);
  expect(character.view().drawn).toEqual(["brows"]);
  supersede([]);
  expect([lips.parent!.visible, liner.parent!.visible, brows.parent!.visible]).toEqual([true, true, true]);
  // Every change the view shows was told once.
  expect(heard.character.map(text => JSON.parse(text).drawn)).toEqual([["face", "brows"], ["face"], ["face", "brows"], ["brows"], ["face", "brows"]]);
});

test("the viewer hides the parts of named head options at once (the V's own makeup), a later V follows, and the body never does", () => {
  const { character } = setup();
  const lips = skinned(quad(0.02), "lips"), liner = skinned(quad(0.03), "liner"), body = skinned(quad(0.04), "body");
  character.setCharacterDetails(v("a", [component("face", "lips", [lips]), component("face", "eyeliner", [liner]), component("body", "lips", [body])]));
  character.setHiddenOptions(["lips"]);
  expect([lips.parent!.visible, liner.parent!.visible, body.parent!.visible]).toEqual([false, true, true]);
  // A V that arrives while it is hidden follows the setting.
  const next = skinned(quad(0.02), "lips b");
  character.setCharacterDetails(v("b", [component("face", "lips", [next])]));
  expect(next.parent!.visible).toBe(false);
  character.setHiddenOptions([]);
  expect(next.parent!.visible).toBe(true);
});

test("a superseded skin leaves the core head with its default skin, in both placements; superseded eyes bring back the core eye (PREV-89)", () => {
  // Core-head placement: the resolved skin is drawn as the core head's material.
  const core = setup();
  const wearable = skinned(quad(), "skin chunk");
  core.character.setCharacterDetails(v("a", [skinComponent([wearable])]));
  expect(core.rig.head.material).toBe(wearable.material);
  core.supersede([{ slot: "skin" }]);
  expect(core.rig.head.material).toBe(core.rig.skin);
  expect(core.rig.head.visible).toBe(true);
  expect(core.character.skin.light()).toBeNull();
  expect(core.character.view().drawn).toEqual([]);
  expect(core.heard.skin).toEqual(["a", "a"]);
  core.supersede([]);
  expect(core.rig.head.material).toBe(wearable.material);
  expect(core.heard.skin).toEqual(["a", "a", "a"]);

  // Resolved-head placement (two chunks can't share the core head's one material): the resolved head draws and the core head hides.
  const resolved = setup();
  const left = skinned(quad(), "left"), right = skinned(quad(), "right");
  resolved.character.setCharacterDetails(v("b", [skinComponent([left, right])]));
  expect(resolved.rig.head.visible).toBe(false);
  expect(left.parent!.visible).toBe(true);
  resolved.supersede([{ slot: "skin" }]);
  // Never a headless V: the core head comes back with its default skin while the resolved head hides.
  expect(resolved.rig.head.visible).toBe(true);
  expect(resolved.rig.head.material).toBe(resolved.rig.skin);
  expect(left.parent!.visible).toBe(false);
  resolved.supersede([]);
  expect(resolved.rig.head.visible).toBe(false);

  // Eyes: the V's eyeball replaces the core eye; superseded, the core eye shows again.
  const eyes = setup();
  const eyeball = skinned(quad(0.05), "eyeball");
  const handle = { setSourceRoughness() {}, gradient: null, sourceRoughness: false, parameters: { roughnessScale: 1 } };
  eyes.character.setCharacterDetails(v("c", [component("eyes", "eyes", [eyeball], { eyes: { eyeballs: [{ mesh: eyeball, handle }], shells: [] } as never })]));
  expect(eyes.rig.eyes.visible).toBe(false);
  eyes.supersede([{ slot: "eyes" }]);
  expect(eyes.rig.eyes.visible).toBe(true);
  expect(eyeball.parent!.visible).toBe(false);
});

test("a V's own eyeball replaces the core eye while it is drawn, and the core eye returns with the next V or none", () => {
  const { rig, character } = setup();
  const eyeball = skinned(quad(0.05), "eyeball");
  const handle = { setSourceRoughness() {}, gradient: null, sourceRoughness: false, parameters: { roughnessScale: 1 } };
  character.setCharacterDetails(v("a", [component("eyes", "eyes", [eyeball], { eyes: { eyeballs: [{ mesh: eyeball, handle }], shells: [] } as never })]));
  expect(rig.eyes.visible).toBe(false);
  expect(character.eyeAppearance().source).toBe("resolved");
  character.setCharacterDetails(v("b", [component("brows", "eyebrows", [skinned(quad(0.01), "brows")])]));
  expect(rig.eyes.visible).toBe(true);
  character.setCharacterDetails(v("a", [component("eyes", "eyes", [eyeball], { eyes: { eyeballs: [{ mesh: eyeball, handle }], shells: [] } as never })]));
  character.setCharacterDetails(null);
  expect(rig.eyes.visible).toBe(true);
  expect(character.eyeAppearance().source).toBe("core");
});

test("hair strands draw nothing into a body-only shadow map and cast as before into every other (hair through the face, PREV-171)", () => {
  const { character } = setup();
  const strand = skinned(quad(0.07), "strands"), body = skinned(quad(0.05), "body");
  Object.assign(strand.material as THREE.MeshStandardMaterial, { alphaToCoverage: true, alphaMap: new THREE.Texture() });
  character.setCharacterDetails(v("a", [component("hair", "hair", [strand]), component("body", "body", [body])]));
  expect([strand.castShadow, body.castShadow]).toEqual([true, true]);
  const depth = strand.customDepthMaterial!, renderer = {} as THREE.WebGLRenderer, geometry = strand.geometry;
  const draw = (mesh: THREE.Mesh, material: THREE.Material, bodyOnly: boolean) => {
    const shadowCamera = new THREE.PerspectiveCamera();
    if (bodyOnly) setBodyCastersOnly({ camera: shadowCamera } as unknown as THREE.LightShadow, true);
    mesh.onBeforeShadow(renderer, mesh as unknown as THREE.Scene, new THREE.PerspectiveCamera(), shadowCamera, geometry, material, null as never);
    const during = [material.depthWrite, material.colorWrite];
    mesh.onAfterShadow(renderer, mesh as unknown as THREE.Scene, new THREE.PerspectiveCamera(), shadowCamera, geometry, material, null as never);
    return { during, after: [material.depthWrite, material.colorWrite] };
  };
  expect(draw(strand, depth, true)).toEqual({ during: [false, false], after: [true, true] });
  expect(draw(strand, depth, false)).toEqual({ during: [true, true], after: [true, true] });
  // The body's own shapes draw into both kinds of map.
  expect(draw(body, body.customDepthMaterial!, true)).toEqual({ during: [true, true], after: [true, true] });
});

