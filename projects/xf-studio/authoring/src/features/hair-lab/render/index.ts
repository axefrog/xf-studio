import { encodeScalarBytes, scalarBytes } from "../../../platform/api/scalar-image";
import * as THREE from "three";
import { Aborter } from "../../../platform/api/graph";
import type { AbortSignalLike } from "../../../platform/api/graph";
import { featureId } from "../../../platform/api/feature";
import type { FeatureRendererFactory, SceneHostPort } from "../../../platform/api/scene";
import type { createHairLab } from "../service";
import type { HeadSurface, Paths } from "../types";
import { atlasRegions, cardAtlasUV } from "../cards";
import { scalpSeedSurface } from "../groom";

/** Generated vertices are in the head mesh's bind space, with exactly one Head influence. */
export function headSkin(geometry: THREE.BufferGeometry, host: SceneHostPort, material: THREE.Material) {
  const head = host.anchors().head, index = head.skeleton.bones.findIndex(bone => bone.name.toLowerCase() === "head");
  if (index < 0) throw Error("The head attachment joint is missing.");
  const n = geometry.getAttribute("position").count, indices = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { indices[i * 4] = index; weights[i * 4] = 1; }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = "xfs_hair_lab"; mesh.frustumCulled = false;
  mesh.position.copy(head.position); mesh.quaternion.copy(head.quaternion); mesh.scale.copy(head.scale); mesh.bind(head.skeleton, head.bindMatrix);
  return mesh;
}
function strandGeometry(paths: Paths) {
  const positions: number[] = [], indices: number[] = [];
  const tangent = new THREE.Vector3(), width = new THREE.Vector3(), normal = new THREE.Vector3();
  for (const path of paths.paths) {
    for (let i = 0; i < path.points.length; i++) {
      const p = path.points[i], a = path.points[Math.max(0, i - 1)], b = path.points[Math.min(path.points.length - 1, i + 1)];
      tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      width.crossVectors(tangent, Math.abs(tangent.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)).normalize();
      normal.crossVectors(width, tangent).normalize();
      const at = positions.length / 3, radius = .0006 * (1 - .65 * i / (path.points.length - 1));
      for (let side = 0; side < 4; side++) {
        const angle = side * Math.PI / 2, x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        positions.push(p[0] + width.x * x + normal.x * y, p[1] + width.y * x + normal.y * y, p[2] + width.z * x + normal.z * y);
        if (i) { const next = (side + 1) % 4; indices.push(at - 4 + side, at - 4 + next, at + side, at - 4 + next, at + next, at + side); }
      }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

export function hairRenderer(lab: ReturnType<typeof createHairLab>, lifetime: AbortSignalLike): FeatureRendererFactory {
  return { feature: featureId("hair-lab"), create(host) {
    const life = new Aborter(lifetime), scene = `head:${host.anchors().head.uuid}`;
    let boundRevision = "", identity: string | null = null, drawn: { group: THREE.Group; detach(): void; geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[]; character: string | null; coverage: string | undefined; topology: string; buffers: { paths: THREE.BufferGeometry; volumes?: THREE.BufferGeometry; cards?: THREE.BufferGeometry } } | null = null;
    let resultKey = "", evidence: unknown = null, upload = 0;
    let capShader: unknown = null;
    let coverageSource: import("../types").HeadSurface["coverageSurface"];
    let reference: import("../../../platform/api/scene").ReferenceTextures | null = null, readingReference = false;
    let atlas: ReturnType<typeof atlasRegions> = [], rootAtV1 = false;
    const withCoverage = (surface: HeadSurface): HeadSurface => coverageSource ? scalpSeedSurface({ ...surface, coverageRequired: true }, coverageSource) : { ...surface, coverageRequired: true };
    const assetLife = new AbortController(); life.signal.addEventListener("abort", () => assetLife.abort());
    function requestReference() {
      if (readingReference || reference || !host.referenceTextures) return;
      readingReference = true;
      lab.coverageState(scene, "preparing", "Preparing scalp coverage…");
      void host.referenceTextures("hair", assetLife.signal).then(found => {
        if (life.signal.aborted) return; reference = found; readingReference = false;
        const alpha = found.pixels?.Strand_Alpha, gradient = found.pixels?.Strand_Gradient;
        if (alpha) atlas = atlasRegions(scalarBytes(alpha.values), alpha.width, alpha.height, gradient ? { ...gradient, values: scalarBytes(gradient.values) } : undefined);
        if (gradient) { const pixels = scalarBytes(gradient.values), width = gradient.width, height = gradient.height; let first = 0, last = 0; for (let x = 0; x < width; x++) { first += pixels[Math.floor(height * .1) * width + x]; last += pixels[Math.floor(height * .9) * width + x]; } rootAtV1 = last < first; }
        const cap = found.surfaces?.find(s => /mesh_decal_gradientmap_recolor\.mt$/i.test(s.template));
        if (!cap) throw Error("No baseline cap surface.");
        const session = lab.session(scene); if (!session) return;
        coverageSource = { ...cap, mask: found.pixels?.MaskTexture ? { ...found.pixels.MaskTexture, values: encodeScalarBytes(scalarBytes(found.pixels.MaskTexture.values)) } : undefined };
        lab.bind(scene, withCoverage(session.surface), life.signal);
      }).catch(() => { readingReference = false; if (!life.signal.aborted) lab.coverageState(scene, "failed", "Couldn't prepare scalp coverage. Try again to read it from your game files."); });
    }
    function coverageMaterial(mask: THREE.Texture) {
      const source = host.resolvedSurfaces?.("hair").find(item => /mesh_decal_gradientmap_recolor\.mt$/i.test(item.template));
      const original = source?.forkMaterial?.();
      if (original instanceof THREE.MeshStandardMaterial) {
        const tint = original, prior = original.onBeforeCompile;
        tint.alphaMap = mask; tint.vertexColors = false; tint.transparent = true; tint.depthWrite = false;
        tint.onBeforeCompile = (shader, renderer) => { prior.call(original, shader, renderer); if (shader.uniforms.xfsCapMask) shader.uniforms.xfsCapMask.value = mask; capShader = { uniforms: Object.keys(shader.uniforms).filter(k => k.startsWith("xfs")), sourceType: original.type, mask: !!shader.uniforms.xfsCapMask }; };
        const priorKey = original.customProgramCacheKey.bind(original);
        tint.customProgramCacheKey = () => `${priorKey()}-xfs-density-tint`;
        return tint;
      }
      return new THREE.MeshStandardMaterial({ color: 0x30201b, roughness: .95, side: THREE.DoubleSide, alphaMap: mask, transparent: true, opacity: .9, vertexColors: true, depthWrite: false });
    }
    function referenceGroup(capOnly: boolean) {
      const group = new THREE.Group(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
      for (const surface of reference?.surfaces ?? []) {
        const isCap = /mesh_decal_gradientmap_recolor\.mt$/i.test(surface.template);
        if (capOnly !== isCap) continue;
        const source = host.resolvedSurfaces?.("hair").find(item => isCap ? /mesh_decal_gradientmap_recolor\.mt$/i.test(item.template) : /(?:^|\\)hair\.mt$/i.test(item.template));
        const material = source?.forkMaterial?.();
        if (!(material instanceof THREE.MeshStandardMaterial)) { material?.dispose(); continue; }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(surface.positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(surface.uv, 2)); geometry.setIndex(surface.indices);
        if (surface.colours) geometry.setAttribute("color", new THREE.Float32BufferAttribute(surface.colours, surface.colours.length / (surface.positions.length / 3)));
        geometry.computeVertexNormals(); source?.prepareGeometry?.(geometry);
        const prior = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
        material.vertexColors = false;
        material.alphaMap = reference!.textures[isCap ? "MaskTexture" : "Strand_Alpha"] ?? material.alphaMap;
        material.onBeforeCompile = (shader, renderer) => {
          prior.call(material, shader, renderer);
          for (const [uniform, input] of Object.entries(isCap ? { xfsCapMask: "MaskTexture" } : { xfsStrandId: "Strand_ID", xfsStrandGradient: "Strand_Gradient" })) {
            if (shader.uniforms[uniform] && reference!.textures[input]) shader.uniforms[uniform].value = reference!.textures[input];
          }
        };
        material.customProgramCacheKey = () => `${key()}-baseline-reference`;
        geometries.push(geometry); materials.push(material); group.add(headSkin(geometry, host, material));
      }
      return { group, geometries, materials };
    }
    function displayGroup(group: THREE.Group) {
      const display = lab.session(scene)?.display;
      const referenceView = display === "reference" || display === "reference-scalp";
      group.children[0].visible = display === "strands" || display === "combined";
      group.children[1].visible = !referenceView && display !== "strands";
      group.children[2].visible = display === "reference";
      group.children[3].visible = referenceView;
      group.children[4].visible = display === "volumes";
      group.children[5].visible = display === "cards";
    }
    function clear() {
      upload++; host.supersede([]);
      if (drawn) { drawn.detach(); for (const g of drawn.geometries) g.dispose(); for (const m of drawn.materials) m.dispose(); for (const t of drawn.textures) t.dispose(); drawn = null; }
      resultKey = ""; host.requestFrame();
    }
    const syncGeometry = () => {
      if (life.signal.aborted || !host.geometry) return;
      const character = host.character().identity;
      if (boundRevision && character === identity) return;
      identity = character;
      const surface = host.geometry();
      if (surface.revision === boundRevision) { resultKey = ""; update(); return; }
      boundRevision = surface.revision; clear(); lab.bind(scene, withCoverage(surface), life.signal);
    };
    function update() {
      if (life.signal.aborted) return;
      const session = lab.session(scene);
      if (!session?.active || session.phase === "failed") { clear(); return; }
      if (coverageSource && !session.surface.coverageSurface) { lab.bind(scene, withCoverage(session.surface), life.signal); return; }
      if (!reference || !session.surface.coverageSurface) { requestReference(); return; }
      if (!session.result) return;
      const result = session.result, key = `${session.revision}:${result.stage}:${identity}`;
      if (drawn) { displayGroup(drawn.group); host.requestFrame(); }
      if (key === resultKey) return;
      const topology = JSON.stringify([result.paths.paths.map(p => p.points.length), result.cards?.cards.map(c => [c.id, c.count]), result.volumes?.volumes.map(v => [v.id, v.frames.length])]);
      if (drawn?.character === identity && drawn.coverage === result.coverage?.values && drawn.topology === topology && drawn.buffers.cards && result.cards && drawn.buffers.volumes && result.volumeGeometry) {
        const updateBuffer = (g: THREE.BufferGeometry, positions: number[], uv?: number[]) => { const p = g.getAttribute("position") as THREE.BufferAttribute; p.array.set(positions); p.needsUpdate = true; if (uv) { const a = g.getAttribute("uv") as THREE.BufferAttribute; a.array.set(uv); a.needsUpdate = true; } g.computeVertexNormals(); };
        const strands = strandGeometry(result.paths); updateBuffer(drawn.buffers.paths, Array.from(strands.getAttribute("position").array)); strands.dispose();
        updateBuffer(drawn.buffers.volumes, result.volumeGeometry.positions); const volumeColour = drawn.buffers.volumes.getAttribute("color") as THREE.BufferAttribute; volumeColour.array.set(result.volumeGeometry.colours); volumeColour.needsUpdate = true;
        updateBuffer(drawn.buffers.cards, result.cards.positions, cardAtlasUV(result.cards, atlas, rootAtV1));
        const red = drawn.buffers.cards.getAttribute("xfsVertexRed") as THREE.BufferAttribute; red.array.set(result.cards.occlusion); red.needsUpdate = true;
        upload++; resultKey = key;
        evidence = { ...(evidence as Record<string, unknown>), stage: result.stage, continuation: result.continuation ?? false, residuals: result.residuals, cardContact: result.cardContact, occlusion: result.occlusion, milliseconds: result.milliseconds, reusedBuffers: true };
        host.requestFrame(); return;
      }
      const geometry = strandGeometry(result.paths), material = new THREE.MeshStandardMaterial({ color: 0x8b583f, roughness: .6, side: THREE.DoubleSide });
      const maskData = result.coverage ? { ...result.coverage, values: scalarBytes(result.coverage.values) } : undefined;
      const rgba = new Uint8Array((maskData?.values.length ?? 1) * 4);
      for (let i = 0; i < rgba.length / 4; i++) { const alpha = maskData?.values[i] ?? 0; rgba.set([alpha, alpha, alpha, 255], i * 4); }
      const mask = new THREE.DataTexture(rgba, maskData?.width ?? 1, maskData?.height ?? 1); mask.flipY = false; mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
      const capData = result.coverageGeometry;
      if (!capData) { geometry.dispose(); material.dispose(); mask.dispose(); return; }
      const cap = new THREE.BufferGeometry(); cap.setAttribute("position", new THREE.Float32BufferAttribute(capData.positions, 3));
      cap.setAttribute("uv", new THREE.Float32BufferAttribute(capData.uv, 2)); cap.setAttribute("color", new THREE.Float32BufferAttribute(Array(capData.positions.length).fill(1), 3));
      cap.setIndex(capData.indices); cap.computeVertexNormals(); const tint = coverageMaterial(mask);
      const group = new THREE.Group(); group.add(headSkin(geometry, host, material), headSkin(cap, host, tint));
      const baselineHair = referenceGroup(false), baselineCap = referenceGroup(true);
      group.add(baselineHair.group, baselineCap.group);
      const geometries = [geometry, cap, ...baselineHair.geometries, ...baselineCap.geometries], materials = [material, tint, ...baselineHair.materials, ...baselineCap.materials];
      const volumeGroup = new THREE.Group(), cardGroup = new THREE.Group(), buffers: { paths: THREE.BufferGeometry; volumes?: THREE.BufferGeometry; cards?: THREE.BufferGeometry } = { paths: geometry };
      if (result.volumeGeometry) {
        const data = result.volumeGeometry, g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(data.colours, 3)); g.setIndex(data.indices); g.computeVertexNormals();
        const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
        volumeGroup.add(headSkin(g, host, m)); geometries.push(g); materials.push(m); buffers.volumes = g;
      }
      let hairShader: unknown = null;
      if (result.cards && atlas.length) {
        const source = host.resolvedSurfaces?.("hair").find(item => /(?:^|\\)hair\.mt$/i.test(item.template)), m = source?.forkMaterial?.();
        if (!(m instanceof THREE.MeshStandardMaterial)) { m?.dispose(); throw Error("The current hair material isn't available."); }
        const data = result.cards, g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(cardAtlasUV(data, atlas, rootAtV1), 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(data.occlusion.flatMap(red => [red, 1, 1]), 3)); g.setIndex(data.indices); g.computeVertexNormals(); source?.prepareGeometry?.(g);
        const prior = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m); m.vertexColors = false; m.alphaMap = reference.textures.Strand_Alpha; m.side = THREE.DoubleSide;
        m.onBeforeCompile = (shader, renderer) => { prior.call(m, shader, renderer); for (const [uniform, input] of Object.entries({ xfsStrandId: "Strand_ID", xfsStrandGradient: "Strand_Gradient" })) if (shader.uniforms[uniform] && reference!.textures[input]) shader.uniforms[uniform].value = reference!.textures[input]; if (shader.uniforms.xfsShadow) shader.uniforms.xfsShadow.value.z = result.occlusion?.shadowStrength ?? 0; hairShader = { uniforms: Object.keys(shader.uniforms).filter(k => k.startsWith("xfs")), profile: !!shader.uniforms.xfsProfile, shadow: shader.uniforms.xfsShadow?.value.toArray() }; };
        m.customProgramCacheKey = () => `${key()}-xfs-volume-cards`; cardGroup.add(headSkin(g, host, m)); geometries.push(g); materials.push(m); buffers.cards = g;
      }
      group.add(volumeGroup, cardGroup);
      for (const g of Object.values(buffers)) for (const attribute of ["position", "normal", "uv", "color", "xfsVertexRed"]) if (g.hasAttribute(attribute)) (g.getAttribute(attribute) as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      displayGroup(group);
      const ticket = ++upload; resultKey = key;
      void host.compile(group).then(() => {
        if (life.signal.aborted || ticket !== upload || !lab.session(scene)?.active) { for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); mask.dispose(); return; }
        clear(); const detach = host.attach(group); drawn = { group, detach, geometries, materials, textures: [mask], character: identity, coverage: result.coverage?.values, topology, buffers };
        resultKey = key; evidence = { stage: result.stage, continuation: result.continuation ?? false, paths: result.paths.paths.length, scalp: result.groom.scalp.densitySeed,
          volumes: result.volumes?.volumes.map(v => ({ id: v.id, section: v.section, next: v.next, sampledMembers: v.members.length })), population: result.volumes && { logical: result.volumes.logicalPopulation, sampled: result.volumes.sampledPopulation }, cards: result.cards?.cards.length, cardVertices: result.cards?.positions.length! / 3, cardContact: result.cardContact, occlusion: result.occlusion, atlas: { resources: reference?.resources, regions: atlas.length, rootAtV1 }, hairShader,
          capSource: session.surface.coverageSurface!.resource, capShader, capMaterial: { type: tint.type, visible: tint.visible, opacity: tint.opacity, colorWrite: tint.colorWrite, depthTest: tint.depthTest }, tintCoverage: result.tintCheck, residuals: result.residuals, milliseconds: result.milliseconds };
        displayGroup(group);
        host.supersede([{ slot: "hair" }]); host.requestFrame();
      }).catch(() => { for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); mask.dispose(); lab.coverageState(scene, "failed", "Couldn't show this groom. Try again."); });
    }
    lab.observe(life.signal, update);
    const off = host.subscribeCharacter(syncGeometry);
    life.signal.addEventListener("abort", () => { off(); clear(); });
    syncGeometry();
    return { evidence: () => evidence, dispose: () => life.abort() };
  } };
}
