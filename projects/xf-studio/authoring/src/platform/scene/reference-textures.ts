import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
/** Generic resolver source for baseline template textures. It never changes the character the scene shows. */
import * as THREE from "three";
import { CHARACTER_DETAIL_ASSETS, chunkOfMesh, parseCharacterDetail } from "../../render-detail";
import type { CharacterSlot, ReferenceTextures } from "../api/scene";

export async function referenceTextures(slot: CharacterSlot, signal: AbortSignal, characterRequest: unknown, route = { endpoint: "/api/preview-character", assets: CHARACTER_DETAIL_ASSETS }): Promise<ReferenceTextures> {
  const post = await fetch(route.endpoint, { method: "POST", signal, headers: { "Content-Type": "application/json", "X-XFS-Page": `reference-${slot}` },
    body: JSON.stringify(characterRequest) });
  if (!post.ok) throw Error("The baseline material couldn't be prepared.");
  let state = await post.json() as { key: string; phase: string; record: string | null };
  for (let i = 0; state.phase === "preparing" && i < 160; i++) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 250);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    state = await (await fetch(`${route.endpoint}?key=${encodeURIComponent(state.key)}`, { signal })).json();
  }
  if (state.phase !== "ready" || !state.record) throw Error("The baseline material isn't ready.");
  const record = parseCharacterDetail(await (await fetch(`${route.assets}${state.record}`, { signal })).json());
  const chunks = record.components.filter(item => item.slot === slot).flatMap(item => item.materials);
  const inputs = Object.assign({}, ...chunks.map(chunk => chunk.textures)) as Record<string, { file: string; depotPath: string; isGamma: boolean }>;
  const pixels: Record<string, { width: number; height: number; values: Uint8Array }> = {};
  const textures: Record<string, THREE.Texture> = {}, resources: Record<string, string> = {};
  const release = () => { for (const texture of Object.values(textures)) texture.dispose(); };
  signal.addEventListener("abort", release, { once: true });
  try {
    // A reference source reads only named material inputs, no geometry or body textures.
    for (const [name, input] of Object.entries(inputs)) {
      if (signal.aborted) throw signal.reason;
      const blob = await (await fetch(`${route.assets}${input.file}`, { signal })).blob(), url = URL.createObjectURL(blob);
      try {
        const texture = await new THREE.TextureLoader().loadAsync(url);
        if (signal.aborted) { texture.dispose(); throw signal.reason; }
        texture.colorSpace = input.isGamma ? THREE.SRGBColorSpace : THREE.NoColorSpace; texture.flipY = false; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        textures[name] = texture; resources[name] = input.depotPath;
        if (!input.isGamma) {
          const image = texture.image as HTMLImageElement, canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context) { context.drawImage(image, 0, 0); const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data, values = new Uint8Array(canvas.width * canvas.height);
            for (let i = 0; i < values.length; i++) values[i] = rgba[i * 4]; pixels[name] = { width: canvas.width, height: canvas.height, values }; }
        }
      } finally { URL.revokeObjectURL(url); }
    }
    const surfaces: NonNullable<ReferenceTextures["surfaces"]>[number][] = [];
    for (const component of record.components.filter(item => item.slot === slot)) {
      const glb = await (await fetch(`${route.assets}${component.geometry.file}`, { signal })).arrayBuffer(), scene = (await new GLTFLoader().parseAsync(glb, "")).scene;
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = component.materials.find(m => m.chunk === chunkOfMesh(object.name));
        if (material?.template) {
          const p = object.geometry.getAttribute("position"), uv = object.geometry.getAttribute("uv");
          surfaces.push({ resource: component.geometry.depotPath, template: material.template, positions: Array.from(p.array), indices: Array.from(object.geometry.index?.array ?? []), uv: Array.from(uv.array), colours: object.geometry.hasAttribute("color") ? Array.from(object.geometry.getAttribute("color").array) : undefined });
        }
        object.geometry.dispose(); for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.dispose();
      });
    }
    return { textures, resources, surfaces, pixels };
  } catch (error) { release(); throw error; }
}
