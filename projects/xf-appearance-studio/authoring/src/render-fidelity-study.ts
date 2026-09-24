import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { parseEyeManifest, verifyEyeBytes } from "./eye-appearance";
import { roughnessRedToGreen } from "./eye-optics";
import { extendSkin, restoreFirstWeights } from "./skin";

type View = "lip" | "eye";
type Variant = { value: string; label: string };
const lipVariants: Variant[] = [
  { value: "baseline", label: "Unchanged baseline" },
  { value: "no-environment", label: "No room environment (all IBL)" },
  { value: "flat-normal", label: "Flat head normals" },
  { value: "uniform-roughness", label: "Uniform skin roughness 0.85" },
  { value: "high-roughness", label: "Uniform skin roughness 1.0" },
  { value: "wireframe", label: "Lip/head triangle wireframe" },
];
const eyeVariants: Variant[] = [
  { value: "baseline", label: "Unchanged baseline: roughness 0.18" },
  { value: "roughness-red", label: "Kala roughness R × 0.493" },
  { value: "roughness-green", label: "Kala roughness G × 0.493" },
  { value: "no-environment", label: "No room environment (all IBL)" },
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const controls = $<HTMLFieldSetElement>("controls"), status = $<HTMLParagraphElement>("status");
const variant = $<HTMLSelectElement>("variant"), light = $<HTMLInputElement>("light");
const exposure = $<HTMLInputElement>("exposure"), height = $<HTMLInputElement>("height");
const distance = $<HTMLInputElement>("distance"), rightLabel = $<HTMLElement>("right-label");

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

type Pane = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  key: THREE.DirectionalLight; head: THREE.MeshStandardMaterial; eye: THREE.MeshStandardMaterial;
};

async function createPane(host: HTMLElement, maps: {
  skinColor: THREE.Texture; skinNormal: THREE.Texture; skinRoughness: THREE.Texture;
  eyeColor: THREE.Texture;
}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x20282d);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose(); room.dispose();
  const key = new THREE.DirectionalLight(0xfff2e9, 2.5);
  key.target.position.set(0, 1.67, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc6dafa, 1);
  fill.position.set(0.4, 1.65, -0.2);
  fill.target.position.set(0, 1.67, 0);
  scene.add(fill, fill.target);
  const bytes = await loadBytes("/assets/head.glb");
  const weightSets = restoreFirstWeights(bytes.buffer as ArrayBuffer);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, "/assets/");
  scene.add(gltf.scene);
  const head = new THREE.MeshStandardMaterial({
    map: maps.skinColor, roughness: 0.85, roughnessMap: maps.skinRoughness,
    normalMap: maps.skinNormal, normalScale: new THREE.Vector2(0.35, -0.35),
  });
  const eye = new THREE.MeshStandardMaterial({ map: maps.eyeColor, roughness: 0.18 });
  let foundHead = false, foundEyes = false;
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
      object.material = head; extendSkin(object, head); foundHead = true;
    } else if (object.name === "eyes") {
      object.material = eye;
      if (object instanceof THREE.SkinnedMesh) extendSkin(object, eye);
      foundEyes = true;
    } else object.visible = false;
  });
  if (!foundHead || !foundEyes) throw Error("Head preview is missing its head or eye mesh");
  return { renderer, scene, camera, key, head, eye } satisfies Pane;
}

function setOptions(view: View) {
  variant.replaceChildren(...(view === "lip" ? lipVariants : eyeVariants).map(option => {
    const node = document.createElement("option");
    node.value = option.value; node.textContent = option.label;
    return node;
  }));
  variant.value = view === "lip" ? "uniform-roughness" : "roughness-red";
}

async function main() {
  const manifestResponse = await fetch("/assets/eyes/manifest.json");
  if (!manifestResponse.ok) throw Error("Local saved-eye manifest is unavailable. Stage private eye assets for this study.");
  const savedEye = parseEyeManifest(await manifestResponse.json()).find(entry =>
    entry.resourceHash === "7132639559252259433" && entry.definition === "eye_16_diffuse");
  if (!savedEye?.roughness) throw Error("The exact Kala saved-eye diffuse and roughness are not staged locally.");
  const savedEyeRoughnessScale = savedEye.roughness.scale;
  const [skinColor, skinNormal, skinRoughness, eyeColor, roughness] = await Promise.all([
    imageTexture("/assets/head-color.png", true), imageTexture("/assets/head-normal.png", false),
    imageTexture("/assets/head-roughness.png", false), imageTexture(savedEye.url, true, savedEye.sha256),
    imageTexture(savedEye.roughness.url, false, savedEye.roughness.sha256),
  ]);
  const maps = { skinColor, skinNormal, skinRoughness, eyeColor };
  const panes = await Promise.all([
    createPane($<HTMLElement>("left"), maps), createPane($<HTMLElement>("right"), maps),
  ]);
  const roughnessRed = eyeRoughness(roughness, "red");
  const roughnessGreen = eyeRoughness(roughness, "green");
  let view: View = "lip";
  setOptions(view);
  function markView() {
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.view === view)));
  }
  markView();
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button =>
    button.addEventListener("click", () => {
      view = button.dataset.view as View;
      distance.value = "0"; height.value = "0";
      setOptions(view); markView(); render();
    }));
  for (const input of [variant, light, exposure, height, distance]) input.addEventListener("input", render);
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
    link.download = `xfs-render-study-${view}-${variant.value}.png`;
    link.href = canvas.toDataURL("image/png"); link.click();
  });
  controls.disabled = false;
  function render() {
    const selected = variant.value;
    const angle = Number(light.value) * Math.PI / 180;
    const y = (view === "eye" ? 1.67 : 1.55) + Number(height.value);
    const x = view === "eye" ? -0.036 : 0;
    const z = 0.44 + Number(distance.value);
    $<HTMLOutputElement>("light-value").textContent = `${light.value}°`;
    $<HTMLOutputElement>("exposure-value").textContent = Number(exposure.value).toFixed(2);
    $<HTMLOutputElement>("height-value").textContent = Number(height.value).toFixed(3);
    $<HTMLOutputElement>("distance-value").textContent = Number(distance.value).toFixed(3);
    rightLabel.textContent = variant.selectedOptions[0]?.textContent ?? "Test";
    for (const [index, pane] of panes.entries()) {
      const active = index === 1 ? selected : "baseline";
      pane.head.normalMap = active === "flat-normal" ? null : skinNormal;
      pane.head.roughnessMap = active === "uniform-roughness" || active === "high-roughness" ? null : skinRoughness;
      pane.head.roughness = active === "high-roughness" ? 1 : 0.85;
      pane.head.wireframe = active === "wireframe";
      pane.head.needsUpdate = true;
      pane.eye.roughnessMap = active === "roughness-red" ? roughnessRed :
        active === "roughness-green" ? roughnessGreen : null;
      pane.eye.roughness = pane.eye.roughnessMap ? savedEyeRoughnessScale : 0.18;
      pane.eye.needsUpdate = true;
      pane.scene.environmentIntensity = active === "no-environment" ? 0 : 1;
      pane.key.position.set(0.65 * Math.sin(angle), 1.9, -0.65 * Math.cos(angle));
      pane.renderer.toneMappingExposure = Number(exposure.value);
      const width = pane.renderer.domElement.parentElement!.clientWidth;
      const heightPx = pane.renderer.domElement.parentElement!.clientHeight;
      pane.renderer.setSize(width, heightPx, false);
      pane.camera.aspect = width / heightPx;
      pane.camera.position.set(x, y, -z);
      pane.camera.lookAt(x, y, 0);
      pane.camera.updateProjectionMatrix();
      pane.renderer.render(pane.scene, pane.camera);
    }
    status.textContent = view === "lip"
      ? "Lip: current cropped Blender-master skin tile. The no-environment test removes all image-based lighting, including diffuse light. Compare mapped roughness and normals separately; wireframe can expose geometry. Saved skin/mouth assembly is unresolved."
      : `Eye: exact local Kala eye-16 diffuse and roughness hashes verified. Source R/G tests use the same 0.493 scale; the game shader reads R, but its normal, UV transform and refraction are absent here.`;
  }
  render();
}
main().catch(error => { status.textContent = `Study unavailable: ${(error as Error).message}`; });
