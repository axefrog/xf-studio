import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { parseEyeManifest, roughnessRedToGreen, verifyEyeBytes } from "./eye-study-fixture";
import { loadSavedBrowMaterial } from "./brow-study-fixture";
import { extendSkin, restoreFirstWeights } from "./skin";
import { skinPackedRgToRgb, skinRoughnessToGreen } from "./skin-study-maps";
import { browScreenMetrics } from "./brow-study-metrics";

type View = "lip" | "eye" | "brow";
type Pose = "neutral" | "saved";
type LipDisplay = "material" | "components" | "ownership" | "islands" | "guard";
type LipCamera = "front" | "quarter" | "mouth";
type LightComponent = "full" | "diffuse" | "reflection" | "albedo" | "ownership" | "islands" | "guard";
type Variant = { value: string; label: string };
const lipVariants: Variant[] = [
  { value: "baseline", label: "Unchanged baseline" },
  { value: "no-environment", label: "No room environment (all IBL)" },
  { value: "flat-normal", label: "Flat head normals" },
  { value: "uniform-roughness", label: "Uniform skin roughness 0.85" },
  { value: "high-roughness", label: "Uniform skin roughness 1.0" },
  { value: "wireframe", label: "Lip/head triangle wireframe" },
];
const sourceVariants: Variant[] = [
  { value: "base-r-packed", label: "Base D05: roughness R, packed RG normal" },
  { value: "base-rb-packed", label: "Base D05: R+B 0.93 bias bracket, packed normal" },
  { value: "base-r-flat", label: "Base D05: roughness R, flat normal" },
  { value: "arkhe-r-packed", label: "Arkhe candidate: roughness R, packed RG normal" },
  { value: "arkhe-rb-packed", label: "Arkhe candidate: R+B 0.93 bias bracket, packed normal" },
  { value: "arkhe-r-flat", label: "Arkhe candidate: roughness R, flat normal" },
];
const eyeVariants: Variant[] = [
  { value: "baseline", label: "Unchanged baseline: roughness 0.18" },
  { value: "roughness-red", label: "Kala roughness R × 0.493" },
  { value: "roughness-green", label: "Kala roughness G × 0.493" },
  { value: "no-environment", label: "No room environment (all IBL)" },
];
const browVariants: Variant[] = [
  { value: "baseline", label: "Current browser skin and brow" },
  { value: "brow-normal", label: "Current skin + brow packed normal study" },
  { value: "base-brow-flat", label: "Base D05 skin + current brow" },
  { value: "base-brow-normal", label: "Base D05 skin + brow normal study" },
  { value: "arkhe-brow-flat", label: "Arkhe skin candidate + current brow" },
  { value: "arkhe-brow-normal", label: "Arkhe skin candidate + brow normal study" },
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const controls = $<HTMLFieldSetElement>("controls"), status = $<HTMLParagraphElement>("status");
const variant = $<HTMLSelectElement>("variant"), pose = $<HTMLSelectElement>("pose");
const lipDisplay = $<HTMLSelectElement>("lip-display"), lipDisplayLabel = $<HTMLElement>("lip-display-label");
const lipCamera = $<HTMLSelectElement>("lip-camera"), lipCameraLabel = $<HTMLElement>("lip-camera-label");
const light = $<HTMLInputElement>("light");
const exposure = $<HTMLInputElement>("exposure"), height = $<HTMLInputElement>("height");
const distance = $<HTMLInputElement>("distance"), rightLabel = $<HTMLElement>("right-label");
const leftLabel = $<HTMLElement>("left-label");
const metrics = $<HTMLParagraphElement>("metrics");

type PrivateMap = { url: string; sha256: string };
type PrivateSkinManifest = {
  schema: "xfs/private-skin-study-1"; headGlbSha256: string;
  roughness: PrivateMap;
  base: { albedo: PrivateMap; normal: PrivateMap };
  arkheCandidate: { albedo: PrivateMap; normal: PrivateMap };
};
type SourceSet = { color: THREE.Texture; normal: THREE.Texture; roughnessR: THREE.Texture; roughnessRB: THREE.Texture };
type SourceMaps = { base: SourceSet; arkhe: SourceSet; headHash: string };
const BROW_GLB_HASH = "da1e38700d2549335d6c6b9bf8ad12899fc8dbb2d9b25c8ce70de77db80edcae";
const BROW_NORMAL_HASH = "2426e263edecb13d79ba8b902780c82a5f15ca13f4bbb3fcf5e8474b0bc84584";
const SAVED_FACE = ["h091_eyes", "h012_nose", "h053_mouth", "h054_jaw", "h145_ear"] as const;
const EXPECTED_SKIN_HASHES = {
  head: "72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8",
  roughness: "5a258560cb9b7056159d28d0f17dd9f90aad5caf833760c3562779a57dd102d4",
  baseColor: "2e066e187efcde185c254ec722308e84e360cd7f30625319167af755e785af4b",
  baseNormal: "015f9b8f730cb01ffc6f1bef543e83ce48b2c999850a485394dce586bbfc648e",
  arkheColor: "a89753c3e5b4126fd12d6caed1c75c48f160726040907640f41a4a66e634522c",
  arkheNormal: "0b1b0d68691abba974dbc3b1ff3c9b67f6193582445eeed227aab057025b59e5",
} as const;

function checkedMap(value: PrivateMap, name: string, hash: string) {
  if (value?.url !== `/assets/skin-study/${name}.png` || value.sha256 !== hash)
    throw Error(`Private skin manifest changed: ${name}`);
}

async function privateSkinManifest(): Promise<PrivateSkinManifest | null> {
  const response = await fetch("/assets/skin-study/manifest.json", { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Private skin manifest failed (${response.status})`);
  const result = await response.json() as PrivateSkinManifest;
  if (result.schema !== "xfs/private-skin-study-1" || result.headGlbSha256 !== EXPECTED_SKIN_HASHES.head)
    throw Error("Private skin manifest or head version changed");
  checkedMap(result.roughness, "base-roughness", EXPECTED_SKIN_HASHES.roughness);
  checkedMap(result.base.albedo, "base-albedo", EXPECTED_SKIN_HASHES.baseColor);
  checkedMap(result.base.normal, "base-normal", EXPECTED_SKIN_HASHES.baseNormal);
  checkedMap(result.arkheCandidate.albedo, "arkhe-albedo", EXPECTED_SKIN_HASHES.arkheColor);
  checkedMap(result.arkheCandidate.normal, "arkhe-normal", EXPECTED_SKIN_HASHES.arkheNormal);
  return result;
}

async function loadBytes(url: string, expected?: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Missing local study asset: ${url} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expected) await verifyEyeBytes(bytes, expected);
  return bytes;
}

async function imageTexture(url: string, color: boolean, expected?: string) {
  const bytes = await loadBytes(url, expected);
  const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
  try {
    const texture = await new THREE.TextureLoader().loadAsync(objectUrl);
    texture.flipY = false;
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
    return texture;
  } finally { URL.revokeObjectURL(objectUrl); }
}

function eyeRoughness(texture: THREE.Texture, channel: "red" | "green") {
  const image = texture.image as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Cannot decode local roughness image");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = channel === "red" ? roughnessRedToGreen(rgba) : new Uint8Array(rgba);
  const map = new THREE.DataTexture(data, canvas.width, canvas.height, THREE.RGBAFormat);
  map.flipY = false; map.colorSpace = THREE.NoColorSpace;
  map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 8; map.needsUpdate = true;
  return map;
}

function sourcePixels(texture: THREE.Texture): { data: Uint8ClampedArray; width: number; height: number } {
  const image = texture.image as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Cannot decode private skin map");
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width, height: canvas.height };
}

function dataMap(bytes: Uint8Array, width: number, height: number) {
  const map = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  map.flipY = false; map.colorSpace = THREE.NoColorSpace;
  map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter; map.anisotropy = 8; map.needsUpdate = true;
  return map;
}

async function loadSourceMaps(manifest: PrivateSkinManifest): Promise<SourceMaps> {
  const [roughness, baseColor, basePacked, arkheColor, arkhePacked] = await Promise.all([
    imageTexture(manifest.roughness.url, false, manifest.roughness.sha256),
    imageTexture(manifest.base.albedo.url, true, manifest.base.albedo.sha256),
    imageTexture(manifest.base.normal.url, false, manifest.base.normal.sha256),
    imageTexture(manifest.arkheCandidate.albedo.url, true, manifest.arkheCandidate.albedo.sha256),
    imageTexture(manifest.arkheCandidate.normal.url, false, manifest.arkheCandidate.normal.sha256),
  ]);
  const rough = sourcePixels(roughness);
  const roughnessR = dataMap(skinRoughnessToGreen(rough.data, "base-r"), rough.width, rough.height);
  const roughnessRB = dataMap(skinRoughnessToGreen(rough.data, "r-b-lower-bound"), rough.width, rough.height);
  const unpack = (source: THREE.Texture) => {
    const pixels = sourcePixels(source);
    return dataMap(skinPackedRgToRgb(pixels.data), pixels.width, pixels.height);
  };
  const baseNormal = unpack(basePacked), arkheNormal = unpack(arkhePacked);
  roughness.dispose(); basePacked.dispose(); arkhePacked.dispose();
  return {
    base: { color: baseColor, normal: baseNormal, roughnessR, roughnessRB },
    arkhe: { color: arkheColor, normal: arkheNormal, roughnessR, roughnessRB },
    headHash: manifest.headGlbSha256,
  };
}

async function loadBrowNormal() {
  const response = await fetch("/assets/brow-study/manifest.json", { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Private brow study manifest failed (${response.status})`);
  const manifest = await response.json() as { schema?: string; glbSha256?: string; normal?: PrivateMap };
  if (manifest.schema !== "xfs/private-brow-study-1" || manifest.glbSha256 !== BROW_GLB_HASH ||
      manifest.normal?.url !== "/assets/brow-study/normal.png" || manifest.normal.sha256 !== BROW_NORMAL_HASH)
    throw Error("Private brow normal manifest changed");
  const packed = await imageTexture(manifest.normal.url, false, manifest.normal.sha256);
  const pixels = sourcePixels(packed);
  const normal = dataMap(skinPackedRgToRgb(pixels.data), pixels.width, pixels.height);
  packed.dispose();
  return normal;
}

type Pane = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  environmentTarget: THREE.WebGLRenderTarget;
  key: THREE.DirectionalLight; head: THREE.MeshStandardMaterial; eye: THREE.MeshStandardMaterial;
  setHeadComponent: (component: LightComponent) => void;
  setEyeComponent: (component: LightComponent) => void;
  setBrowComponent?: (component: LightComponent) => void;
  brow?: THREE.MeshStandardMaterial; browError?: string;
  headMesh: THREE.SkinnedMesh; brows: THREE.SkinnedMesh[];
};

function labelHeadUvIslands(geometry: THREE.BufferGeometry) {
  const indices = geometry.index, position = geometry.getAttribute("position");
  if (!indices || position.count !== 7189 || indices.count !== 13186 * 3)
    throw Error("Pinned head UV-island topology changed");
  const parent = Uint32Array.from({ length: position.count }, (_, i) => i);
  const find = (start: number) => {
    let i = start;
    while (parent[i] !== i) { parent[i] = parent[parent[i]]!; i = parent[i]!; }
    return i;
  };
  const join = (a: number, b: number) => { parent[find(b)] = find(a); };
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
    join(a, b); join(b, c);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < position.count; i++) {
    const root = find(i), group = groups.get(root) ?? [];
    group.push(i); groups.set(root, group);
  }
  const counts = [...groups.values()].map(group => group.length).sort((a, b) => b - a);
  if (counts.length !== 16 || counts[0] !== 4830 || counts[2] !== 449 ||
      counts.filter(n => n === 131).length !== 2)
    throw Error("Pinned head UV-island sizes changed");
  const classes = new Float32Array(position.count);
  for (const group of groups.values()) {
    // Numeric island classes are topology facts, not semantic lip labels.
    const code = group.length === 4830 ? 0 : group.length === 449 ? 1
      : group.length === 131 ? group.reduce((sum, i) => sum + position.getY(i), 0) / group.length > 1.625 ? 2 : 3
      : 4;
    for (const i of group) classes[i] = code;
  }
  geometry.setAttribute("studyIsland", new THREE.BufferAttribute(classes, 1));
}

// Keep Three's standard BRDF, maps, morphs and extended eight-weight skinning.
// Only the final linear-light term changes for these opt-in diagnostic displays.
function addLightComponent(material: THREE.MeshStandardMaterial, owner: "head" | "eye" | "brow") {
  let component: LightComponent = "full";
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    if (component === "full") return;
    const marker = "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;";
    if ((component === "guard" || component === "islands") && owner === "head") {
      // Both diagnostics ride the original vertices through skinning/morphs.
      // The guard uses neutral coordinates; island colours use UV-split IDs.
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${component === "guard" ? "varying vec3 vStudyBasePosition;" : "attribute float studyIsland; varying float vStudyIsland;"}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${component === "guard" ? "vStudyBasePosition = position;" : "vStudyIsland = studyIsland;"}`);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>", `#include <common>\n${component === "guard" ? "varying vec3 vStudyBasePosition;" : "varying float vStudyIsland;"}`);
    }
    const replacement = component === "diffuse" ? "vec3 outgoingLight = totalDiffuse;"
      : component === "reflection" ? "vec3 outgoingLight = totalSpecular;"
      : component === "albedo" ? "vec3 outgoingLight = diffuseColor.rgb;"
      : component === "guard" && owner === "head"
        ? "float mouthBand = step(1.595, vStudyBasePosition.y) * (1.0 - step(1.675, vStudyBasePosition.y)); vec3 outgoingLight = mix(vec3(0.10, 0.55, 0.28), vec3(0.78, 0.18, 0.45), mouthBand);"
      : component === "islands" && owner === "head"
        ? "vec3 outgoingLight = vStudyIsland < 0.5 ? vec3(0.10, 0.55, 0.28) : vStudyIsland < 1.5 ? vec3(0.90, 0.35, 0.07) : vStudyIsland < 2.5 ? vec3(0.92, 0.78, 0.08) : vStudyIsland < 3.5 ? vec3(0.28, 0.22, 0.85) : vec3(0.45, 0.45, 0.45);"
      : `vec3 outgoingLight = ${owner === "head" ? "vec3(0.72, 0.24, 0.52)" : owner === "eye" ? "vec3(0.08, 0.72, 0.80)" : "vec3(0.90, 0.70, 0.10)"};`;
    if (!shader.fragmentShader.includes(marker)) throw Error("Three standard lighting output changed; diagnostic unavailable");
    shader.fragmentShader = shader.fragmentShader.replace(marker, replacement);
  };
  material.customProgramCacheKey = () => `study-${component}|${previousKey()}`;
  return (next: LightComponent) => {
    if (component === next) return;
    component = next;
    material.toneMapped = next !== "albedo" && next !== "ownership" && next !== "islands" && next !== "guard";
    material.needsUpdate = true;
  };
}

async function createPane(host: HTMLElement, maps: {
  skinColor: THREE.Texture; skinNormal: THREE.Texture; skinRoughness: THREE.Texture;
  eyeColor: THREE.Texture;
}, headHash?: string) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x20282d);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(room, 0.04);
  scene.environment = environmentTarget.texture;
  pmrem.dispose(); room.dispose();
  const key = new THREE.DirectionalLight(0xfff2e9, 2.5);
  key.target.position.set(0, 1.67, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc6dafa, 1);
  fill.position.set(0.4, 1.65, -0.2);
  fill.target.position.set(0, 1.67, 0);
  scene.add(fill, fill.target);
  const bytes = await loadBytes("/research-assets/head.glb", headHash ?? EXPECTED_SKIN_HASHES.head);
  const weightSets = restoreFirstWeights(bytes.buffer as ArrayBuffer);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, "/research-assets/");
  scene.add(gltf.scene);
  const head = new THREE.MeshStandardMaterial({
    map: maps.skinColor, roughness: 0.85, roughnessMap: maps.skinRoughness,
    normalMap: maps.skinNormal, normalScale: new THREE.Vector2(0.35, -0.35),
  });
  const eye = new THREE.MeshStandardMaterial({ map: maps.eyeColor, roughness: 0.18 });
  const setHeadComponent = addLightComponent(head, "head");
  const setEyeComponent = addLightComponent(eye, "eye");
  let headMesh: THREE.SkinnedMesh | undefined;
  let foundEyes = false;
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.frustumCulled = false;
    if (object instanceof THREE.SkinnedMesh) {
      const association = gltf.parser.associations.get(object);
      const name = gltf.parser.json.meshes[association?.meshes ?? -1]?.name;
      const weights = weightSets.get(name);
      if (!weights) throw Error(`Cannot restore full skin weights: ${name}`);
      object.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
    }
    if (object.name === "head") {
      if (!(object instanceof THREE.SkinnedMesh)) throw Error("Head is not skinned");
      labelHeadUvIslands(object.geometry);
      object.material = head; extendSkin(object, head); headMesh = object;
    } else if (object.name === "eyes") {
      object.material = eye;
      if (object instanceof THREE.SkinnedMesh) extendSkin(object, eye);
      foundEyes = true;
    } else object.visible = false;
  });
  if (!headMesh || !foundEyes) throw Error("Head preview is missing its head or eye mesh");
  let brow: THREE.MeshStandardMaterial | undefined, browError: string | undefined;
  let setBrowComponent: ((component: LightComponent) => void) | undefined;
  const brows: THREE.SkinnedMesh[] = [];
  try {
    brow = await loadSavedBrowMaterial(new THREE.TextureLoader(), 8);
    if (brow) {
      setBrowComponent = addLightComponent(brow, "brow");
      const browBytes = await loadBytes("/assets/brows.glb", BROW_GLB_HASH);
      const browWeights = restoreFirstWeights(browBytes.buffer as ArrayBuffer);
      const browGltf = await new GLTFLoader().parseAsync(browBytes.buffer as ArrayBuffer, "/assets/");
      browGltf.scene.traverse(object => {
        if (!(object instanceof THREE.SkinnedMesh)) return;
        const association = browGltf.parser.associations.get(object);
        const name = browGltf.parser.json.meshes[association?.meshes ?? -1]?.name;
        const weights = browWeights.get(name);
        if (!weights) throw Error(`Cannot restore brow skin weights: ${name}`);
        object.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
        object.frustumCulled = false;
        object.material = brow!;
        extendSkin(object, brow!);
        object.visible = false;
        brows.push(object);
      });
      if (!brows.length) throw Error("Saved brow GLB has no skinned geometry");
      scene.add(browGltf.scene);
    }
  } catch (error) { browError = (error as Error).message; }
  return { renderer, scene, camera, environmentTarget, key, head, eye,
    setHeadComponent, setEyeComponent, setBrowComponent,
    brow, browError, headMesh, brows } satisfies Pane;
}

function setOptions(view: View, sourceReady: boolean, browNormalReady: boolean) {
  const choices = view === "lip" ? [...lipVariants, ...(sourceReady ? sourceVariants : [])] :
    view === "brow" ? browVariants.filter(option =>
      (sourceReady || !/^(base|arkhe)-/.test(option.value)) &&
      (browNormalReady || !option.value.endsWith("normal"))) : eyeVariants;
  variant.replaceChildren(...choices.map(option => {
    const node = document.createElement("option");
    node.value = option.value; node.textContent = option.label;
    return node;
  }));
  variant.value = view === "lip" ? "uniform-roughness" : view === "eye" ? "roughness-red" : "baseline";
}

function lipMetric(canvas: HTMLCanvasElement) {
  const image = document.createElement("canvas");
  image.width = canvas.width; image.height = canvas.height;
  const context = image.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Cannot measure lip crop");
  context.drawImage(canvas, 0, 0);
  const left = Math.round(canvas.width * 260 / 782), top = Math.round(canvas.height * 145 / 1230);
  const right = Math.round(canvas.width * 525 / 782), bottom = Math.round(canvas.height * 212 / 1230);
  const pixels = context.getImageData(left, top, right - left, bottom - top).data;
  let bright = 0, linearSum = 0;
  const linear = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) bright++;
    linearSum += 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]);
  }
  return { bright, pixels: pixels.length / 4, meanLinear: linearSum / (pixels.length / 4) };
}

async function main() {
  const skinManifest = await privateSkinManifest();
  const sourceMaps = skinManifest ? await loadSourceMaps(skinManifest) : null;
  const browNormal = await loadBrowNormal();
  const manifestResponse = await fetch("/assets/eyes/manifest.json");
  if (!manifestResponse.ok) throw Error("Local saved-eye manifest is unavailable. Stage private eye assets for this study.");
  const savedEye = parseEyeManifest(await manifestResponse.json()).find(entry =>
    entry.resourceHash === "7132639559252259433" && entry.definition === "eye_16_diffuse");
  if (!savedEye?.roughness) throw Error("The exact Kala saved-eye diffuse and roughness are not staged locally.");
  const savedEyeRoughnessScale = savedEye.roughness.scale;
  const [skinColor, skinNormal, skinRoughness, eyeColor, roughness] = await Promise.all([
    imageTexture("/research-assets/head-color.png", true), imageTexture("/research-assets/head-normal.png", false),
    imageTexture("/research-assets/head-roughness.png", false), imageTexture(savedEye.url, true, savedEye.sha256),
    imageTexture(savedEye.roughness.url, false, savedEye.roughness.sha256),
  ]);
  const maps = { skinColor, skinNormal, skinRoughness, eyeColor };
  const panes = await Promise.all([
    createPane($<HTMLElement>("left"), maps, sourceMaps?.headHash),
    createPane($<HTMLElement>("right"), maps, sourceMaps?.headHash),
  ]);
  const browReady = panes.every(pane => !!pane.brow && pane.brows.length > 0);
  document.querySelector<HTMLButtonElement>('[data-view="brow"]')!.disabled = !browReady;
  const roughnessRed = eyeRoughness(roughness, "red");
  const roughnessGreen = eyeRoughness(roughness, "green");
  let view: View = "lip";
  const poseByView: Record<View, Pose> = { lip: "neutral", eye: "neutral", brow: "saved" };
  pose.value = poseByView[view];
  setOptions(view, !!sourceMaps, !!browNormal);
  function markView() {
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.view === view)));
  }
  markView();
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button =>
    button.addEventListener("click", () => {
      view = button.dataset.view as View;
      distance.value = "0"; height.value = "0";
      pose.value = poseByView[view];
      lipDisplayLabel.hidden = view !== "lip";
      lipCameraLabel.hidden = view !== "lip";
      setOptions(view, !!sourceMaps, !!browNormal); markView(); render();
    }));
  pose.addEventListener("change", () => { poseByView[view] = pose.value as Pose; render(); });
  for (const input of [variant, lipDisplay, lipCamera, light, exposure, height, distance]) input.addEventListener("input", render);
  window.addEventListener("resize", render);
  $<HTMLButtonElement>("capture").addEventListener("click", () => {
    render();
    const [a, b] = panes.map(pane => pane.renderer.domElement);
    const canvas = document.createElement("canvas");
    canvas.width = a.width + b.width; canvas.height = Math.max(a.height, b.height);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(a, 0, 0); context.drawImage(b, a.width, 0);
    const link = document.createElement("a");
    link.download = `xfs-render-study-${view}-${pose.value}-${variant.value}-${view === "lip" ? `${lipDisplay.value}-${lipCamera.value}` : "material"}.png`;
    link.href = canvas.toDataURL("image/png"); link.click();
  });
  controls.disabled = false;
  window.addEventListener("pagehide", () => {
    const textures = new Set<THREE.Texture>([skinColor, skinNormal, skinRoughness, eyeColor, roughness,
      roughnessRed, roughnessGreen]);
    if (browNormal) textures.add(browNormal);
    if (sourceMaps) for (const source of [sourceMaps.base, sourceMaps.arkhe])
      for (const map of [source.color, source.normal, source.roughnessR, source.roughnessRB]) textures.add(map);
    for (const pane of panes) {
      pane.scene.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of [pane.head, pane.eye, pane.brow]) {
        if (!material) continue;
        for (const map of [material.map, material.alphaMap, material.normalMap, material.roughnessMap])
          if (map) textures.add(map);
        material.dispose();
      }
      pane.environmentTarget.dispose();
      pane.renderer.dispose();
    }
    for (const texture of textures) texture.dispose();
  }, { once: true });
  function setPose(pane: Pane, saved: boolean) {
    for (const mesh of [pane.headMesh, ...pane.brows]) {
      if (!mesh.morphTargetInfluences) throw Error("A study mesh has no morphs");
      mesh.morphTargetInfluences.fill(0);
      if (saved) for (const name of SAVED_FACE) {
        const index = mesh.morphTargetDictionary?.[name];
        if (index === undefined) throw Error(`Study mesh lacks saved morph ${name}`);
        mesh.morphTargetInfluences[index] = 1;
      }
    }
  }
  function browSilhouette(pane: Pane) {
    const hidden: THREE.Object3D[] = [];
    pane.scene.traverse(object => {
      if (object instanceof THREE.Mesh && !pane.brows.includes(object as THREE.SkinnedMesh) && object.visible) {
        object.visible = false; hidden.push(object);
      }
    });
    pane.renderer.setClearColor(0, 0);
    pane.renderer.render(pane.scene, pane.camera);
    const source = pane.renderer.domElement;
    const canvas = document.createElement("canvas");
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Cannot measure brow silhouette");
    context.drawImage(source, 0, 0);
    const result = browScreenMetrics(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    for (const object of hidden) object.visible = true;
    pane.renderer.setClearColor(0x20282d, 1);
    return result;
  }
  function render() {
    const selected = variant.value;
    const display: LipDisplay = view === "lip" ? lipDisplay.value as LipDisplay : "material";
    const cameraPreset: LipCamera = view === "lip" ? lipCamera.value as LipCamera : "front";
    const angle = Number(light.value) * Math.PI / 180;
    const y = (view === "brow" ? 1.71 : view === "eye" ? 1.67 : cameraPreset === "mouth" ? 1.625 : 1.55) + Number(height.value);
    const x = view === "eye" || view === "brow" ? -0.036 : 0;
    const z = (view === "brow" ? 0.28 : cameraPreset === "mouth" ? 0.25 : 0.44) + Number(distance.value);
    // Both screen masks must use an identical pixel grid, even when the right
    // figure loses a CSS pixel to its dividing border or viewport rounding.
    const widthPx = Math.min(...panes.map(pane => pane.renderer.domElement.parentElement!.clientWidth));
    const heightPx = Math.min(...panes.map(pane => pane.renderer.domElement.parentElement!.clientHeight));
    $<HTMLOutputElement>("light-value").textContent = `${light.value}°`;
    $<HTMLOutputElement>("exposure-value").textContent = Number(exposure.value).toFixed(2);
    $<HTMLOutputElement>("height-value").textContent = Number(height.value).toFixed(3);
    $<HTMLOutputElement>("distance-value").textContent = Number(distance.value).toFixed(3);
    const selectedLabel = variant.selectedOptions[0]?.textContent ?? "Selected inputs";
    leftLabel.textContent = display === "components" ? `Diffuse only · ${selectedLabel}`
      : display === "ownership" || display === "islands" || display === "guard" ? `Unlit albedo · ${selectedLabel}` : "Current browser baseline";
    rightLabel.textContent = display === "components" ? `Reflection only · ${selectedLabel}`
      : display === "ownership" ? "Mesh ownership: head / eyes / brow"
      : display === "islands" ? "Head UV islands (topology classes)"
      : display === "guard" ? "Provisional mouth exclusion band" : selectedLabel;
    for (const [index, pane] of panes.entries()) {
      const active = display === "material" && index === 0 ? "baseline" : selected;
      const component: LightComponent = display === "components" ? index === 0 ? "diffuse" : "reflection"
        : display === "ownership" || display === "islands" || display === "guard" ? index === 0 ? "albedo" : display : "full";
      const match = /^(base|arkhe)-(r|rb)-(packed|flat)$/.exec(active);
      const browSource = view === "brow" ? /^(base|arkhe)-brow-/.exec(active) : null;
      const sourceKey = match?.[1] ?? browSource?.[1];
      const source = sourceKey && sourceMaps ? sourceMaps[sourceKey as "base" | "arkhe"] : null;
      pane.head.map = source?.color ?? skinColor;
      pane.head.normalMap = source
        ? match?.[3] === "flat" ? null : source.normal
        : active === "flat-normal" ? null : skinNormal;
      pane.head.roughnessMap = source
        ? match?.[2] === "rb" ? source.roughnessRB : source.roughnessR
        : active === "uniform-roughness" || active === "high-roughness" ? null : skinRoughness;
      pane.head.roughness = source ? 1 : active === "high-roughness" ? 1 : 0.85;
      pane.head.wireframe = display === "material" && active === "wireframe";
      pane.setHeadComponent(component);
      pane.head.needsUpdate = true;
      pane.eye.roughnessMap = active === "roughness-red" ? roughnessRed :
        active === "roughness-green" ? roughnessGreen : null;
      pane.eye.roughness = pane.eye.roughnessMap ? savedEyeRoughnessScale : 0.18;
      pane.setEyeComponent(component);
      pane.eye.needsUpdate = true;
      setPose(pane, pose.value === "saved");
      for (const browMesh of pane.brows) browMesh.visible = view === "brow";
      if (pane.brow) {
        pane.brow.normalMap = view === "brow" && active.endsWith("normal") ? browNormal : null;
        pane.brow.normalScale.set(0.8, -0.8);
        pane.setBrowComponent?.(component);
        pane.brow.needsUpdate = true;
      }
      pane.scene.environmentIntensity = active === "no-environment" ? 0 : 1;
      pane.key.position.set(0.65 * Math.sin(angle), 1.9, -0.65 * Math.cos(angle));
      pane.renderer.toneMappingExposure = Number(exposure.value);
      pane.renderer.setSize(widthPx, heightPx, false);
      pane.renderer.domElement.style.width = `${widthPx}px`;
      pane.renderer.domElement.style.height = `${heightPx}px`;
      pane.camera.aspect = widthPx / heightPx;
      pane.camera.position.set(x + (cameraPreset === "quarter" ? z * 0.5 : 0), y,
        -z * (cameraPreset === "quarter" ? Math.sqrt(3) / 2 : 1));
      pane.camera.lookAt(x, y, 0);
      pane.camera.updateProjectionMatrix();
      const silhouette = view === "brow" ? browSilhouette(pane) : null;
      pane.renderer.render(pane.scene, pane.camera);
      if (silhouette) (pane as Pane & { silhouette?: typeof silhouette }).silhouette = silhouette;
    }
    if (view === "lip" && display !== "material") {
      metrics.textContent = display === "components"
        ? "Both panes use identical selected maps and roughness. Each includes direct lights and room IBL; the left omits standard specular and the right omits standard diffuse. ACES exposure acts on each separately, so displayed pixels do not add back to the full image."
        : display === "islands"
          ? "Right: largest head UV island green; 449-vertex central island orange; the two 131-vertex islands yellow/blue; other islands grey. Eye mesh cyan. UV seams split geometry for mapping but do not prove different tissues or transport ownership."
        : display === "guard"
          ? "Left: unlit colour. Right: a broad magenta no-transport band bound to neutral head coordinates y=1.595–1.675; green head lies outside it, cyan eyes are separate, and dark gaps have no mesh. This excludes nearby skin too and cannot identify upper versus lower lip. No blur is applied."
          : "Left: unlit sampled colour on the deformed surface. Right: head mesh = magenta, separate eye mesh = cyan, brow mesh = yellow, background/missing mouth parts = dark. Upper and lower lip share the head mesh; this does not mark a safe lip boundary.";
    } else if (view === "lip" && cameraPreset === "front" && pose.value === "neutral" && height.value === "0" && distance.value === "0") {
      const [left, right] = panes.map(pane => lipMetric(pane.renderer.domElement));
      metrics.textContent = `Default-frame broad lip crop (${left.pixels} pixels): near-white RGB>220 ${left.bright} → ${right.bright}; mean linear luminance ${left.meanLinear.toFixed(4)} → ${right.meanLinear.toFixed(4)}.`;
    } else if (view === "brow") {
      const [left, right] = panes.map(pane => (pane as Pane & { silhouette?: ReturnType<typeof browSilhouette> }).silhouette!);
      metrics.textContent = `Brow-only screen alpha, left → right: >10% ${left.visible10} → ${right.visible10} px; >50% ${left.visible50} → ${right.visible50} px. Bounds ${left.bounds} → ${right.bounds}. Mean display RGB within >50% alpha ${left.strongMeanRgb.toFixed(1)} → ${right.strongMeanRgb.toFixed(1)} (lighting diagnostic, not perceived width).`;
    } else metrics.textContent = view === "lip"
      ? pose.value === "saved"
        ? "The fixed lip crop was calibrated only for the neutral face. Saved-pose pixels are shown without that crop metric."
        : "Use Front camera and reset framing height and distance to 0 for comparable fixed-crop metrics."
      : "";
    const diagnosticNote = display === "components"
      ? " Standard diffuse and specular lobes are separated before tone mapping, with no skin transport, transmission or REDengine parity claim."
      : display === "ownership"
        ? " Albedo bypasses lights and tone mapping; ownership is per rendered mesh, not upper/lower-lip anatomy."
        : display === "islands"
          ? " Colours show connected components before welding UV seams. The 449- and 131-vertex groups cluster near the mouth, but material and topology provide no validated upper/lower-lip semantics."
        : display === "guard"
          ? " The mouth band is an intentionally overinclusive geometry-coordinate exclusion preview. It is not semantic lip ownership or a validated transport mask; eyes and teeth still need source/depth checks."
        : "";
    status.textContent = view === "lip"
      ? sourceMaps
        ? `Source-map inputs are private and SHA-256 checked. ${display === "material" ? "Left: old Blender maps. Right: selected test." : "Both panes: identical selected inputs."} Roughness uses source R in Three's G slot; R+B uses a 0.93 constant lower-bound bracket, not the game's spatial bias. Packed RG reconstructs Z; tangent handedness, detail maps, SSS, teeth and runtime winners remain unproved.${diagnosticNote}${!browReady ? ` Brow study unavailable: ${panes[0].browError ?? "private brow assets missing"}.` : ""}`
        : `Private D05 map manifest unavailable; old Blender-map diagnostics remain. Stage verified local source maps to enable source A/B.${diagnosticNote}${!browReady ? ` Brow study unavailable: ${panes[0].browError ?? "private brow assets missing"}.` : ""}`
      : view === "eye" ? `Eye: exact local Kala eye-16 diffuse and roughness hashes verified. Source R/G tests use the same 0.493 scale; the game shader reads R, but its normal, UV transform and refraction are absent here.`
      : `Brow: ${pose.value === "saved" ? "saved five-morph" : "neutral"} static face; verified Arkhe Fuller style-18 mesh and double-diffuse primary/secondary alpha plus Alliekat gradient. ${sourceMaps ? "Base/Arkhe skin candidates verified." : "Private D05 skin maps unavailable."} ${browNormal ? "Normal study uses verified style-18 packed RG decoded for Three at a provisional scale." : "Style-18 packed normal not staged."} Same geometry and coverage in both panes; no matched game capture or runtime winner.`;
  }
  render();
}
main().catch(error => { status.textContent = `Study unavailable: ${(error as Error).message}`; });
