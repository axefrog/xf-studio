import * as THREE from "three";
import type { LoadedCharacterComponent, LoadedCharacterDetails } from "./character-detail-loader";
import type { BrowUnderlayEvidence, HeadSkinPlacement } from "./head-skin-placement";
import type { IdleAnimation } from "./idle-animation";
import type { PiercingManifest } from "./piercing-preview";
import { skinSets } from "./skin";

/**
 * Developer evidence about what the head scene loaded and drew: read-only projections of its Three objects
 * into plain data (verification pages and tests read it; nothing in the app depends on it).
 */
export function coreSceneEvidence(input: {
  coreDetail: { identity: string; origin: string; label: string };
  meshes: readonly THREE.Mesh[];
  blinkBones: number;
  eyeShape: { choices: number; eyesFollow: boolean; eyeMorphTargets: number };
  profileEncoding: string;
  piercingError: string; prcError: string;
  piercingManifest?: PiercingManifest; prcManifest?: PiercingManifest;
  piercingMeshes: ReadonlyMap<string, readonly THREE.Mesh[]>;
  idle?: IdleAnimation; idleError: string;
}) {
  const { idle } = input;
  const vertices = (mesh: THREE.Mesh) => mesh.geometry.getAttribute("position").count;
  return {
    /** Which render record supplied the core head (derived from game files, or developer-prepared). */
    coreDetail: input.coreDetail,
    meshes: input.meshes.map(m => ({ name: m.name, vertices: vertices(m), morphs: m.morphTargetInfluences?.length ?? 0,
      skinSets: m instanceof THREE.SkinnedMesh ? skinSets(m.geometry).length : 0 })),
    blinkBones: input.blinkBones,
    eyeShape: input.eyeShape,
    profileEncoding: input.profileEncoding,
    piercingError: input.piercingError,
    prcError: input.prcError,
    piercing: { source: input.piercingManifest?.source, styles: input.piercingManifest?.styles.length ?? 0,
      meshes: [...input.piercingMeshes].map(([id, parts]) => ({ id, chunks: parts.length, vertices: parts.reduce((n, m) => n + vertices(m), 0) })) },
    prc: { source: input.prcManifest?.source, styles: input.prcManifest?.styles.length ?? 0 },
    idle: { available: !!idle, error: input.idleError, clip: idle?.clip.name, duration: idle?.clip.duration,
      mappedBones: idle?.bindings.length ?? 0, unmappedBones: idle?.unmapped ?? [], facialControlsApplied: !!idle?.facial,
      faceDuration: idle?.facial?.clip.duration, faceMappedBones: idle?.bindings.filter(b => b.faceDriver).length ?? 0 },
  };
}

/** The raw UV0 range of a mesh (the eye's is not folded into one tile). */
function uvRange(mesh: THREE.Mesh) {
  const uv = mesh.geometry.getAttribute("uv");
  if (!uv) return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, positiveU = 0;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    if (u > 0) positiveU++;
  }
  return { u: [minU, maxU], v: [minV, maxV], positiveU, vertices: uv.count };
}

/** How the resolved details landed in the scene: record identity, slots, problems, skin placement, eyes and components. */
export function characterDetailsEvidence(input: {
  details: LoadedCharacterDetails | null;
  skin: { item: LoadedCharacterComponent; placement: HeadSkinPlacement } | null;
  /** The core head, whose material shows the resolved skin in core-head mode (and the default skin otherwise). */
  head: THREE.Mesh;
  browUnderlay?: BrowUnderlayEvidence;
  /** The core (fallback) eye and which eye the scene draws. */
  eyes?: { core: THREE.Mesh; appearance: object };
}) {
  const { details: loaded, skin, head } = input;
  const skinEvidence = skin ? {
    mode: skin.placement.mode, reason: skin.placement.reason, limit: skin.placement.limit ?? null,
    parameters: structuredClone(skin.item.skin!.handle.parameters),
    material: (skin.placement.mode === "core-head" ? head.material as THREE.Material : skin.item.meshes[0]!.material as THREE.Material).name,
    textures: Object.fromEntries(Object.entries(skin.item.component.materials[0]?.textures ?? {}).map(([name, texture]) =>
      [name, { depotPath: texture.depotPath, archive: texture.sources[0]?.archive ?? null, width: texture.width, height: texture.height, isGamma: texture.isGamma }])),
    geometry: { depotPath: skin.item.component.geometry.depotPath, archive: skin.item.component.geometry.sources[0]?.archive ?? null },
  } : { mode: "default", material: (head.material as THREE.Material).name || "default" };
  const eyeItem = loaded?.components.find(item => item.component.slot === "eyes");
  const eyeEvidence = input.eyes ? { ...input.eyes.appearance, coreVisible: input.eyes.core.visible,
    morphTexture: eyeItem?.component.morphTexture ?? null,
    chunks: eyeItem?.component.materials.map(material => ({ chunk: material.chunk, template: material.template,
      textures: Object.fromEntries(Object.entries(material.textures).map(([name, texture]) => [name, { depotPath: texture.depotPath,
        archive: texture.sources[0]?.archive ?? null, isGamma: texture.isGamma, width: texture.width, height: texture.height }])),
      gradients: Object.fromEntries(Object.entries(material.gradients).map(([name, gradient]) => [name, { depotPath: gradient.depotPath, stops: gradient.stops }])) })) ?? [],
    eyeballs: eyeItem?.eyes?.eyeballs.map(({ mesh, handle }) => ({ mesh: mesh.name, visible: mesh.visible, renderOrder: mesh.renderOrder,
      material: (mesh.material as THREE.Material).name, gradient: handle.gradient, uv: uvRange(mesh) })) ?? [],
    shells: eyeItem?.eyes?.shells.map(({ mesh, handle }) => ({ mesh: mesh.name, visible: mesh.visible, renderOrder: mesh.renderOrder,
      material: (mesh.material as THREE.Material).name, parameters: { ...handle.parameters }, uv: uvRange(mesh) })) ?? [] } : undefined;
  // Face details in draw order: each decal chunk's template, priority, render order and the parameters the family read.
  const faceEvidence = loaded?.components.filter(item => item.component.slot === "face").flatMap(item => item.meshes.map(mesh => {
    const decal = item.decals?.find(entry => entry.mesh === mesh);
    return { option: item.component.option, definition: item.component.definition, mesh: mesh.name, visible: mesh.visible && item.root.visible,
      renderOrder: mesh.renderOrder, template: decal?.chunk.template ?? null, templateName: decal?.chunk.templateName ?? null,
      priority: decal?.chunk.materialPriority ?? null, drawn: !!decal, underlay: decal?.handle.underlay ?? false, skinLight: decal?.handle.skinLight ?? false,
      parameters: decal ? structuredClone(decal.handle.parameters) : null, surface: decal?.surface ? structuredClone(decal.surface) : null,
      textures: decal ? Object.fromEntries(Object.entries(decal.chunk.textures).map(([name, texture]) => [name, { depotPath: texture.depotPath,
        archive: texture.sources[0]?.archive ?? null, isGamma: texture.isGamma, width: texture.width, height: texture.height }])) : {} };
  })) ?? [];
  return { identity: loaded?.record.identity ?? null, source: loaded?.record.character.source ?? null, face: faceEvidence,
    slots: loaded?.record.slots.map(slot => ({ ...slot })) ?? [], problems: loaded?.problems.map(problem => ({ ...problem })) ?? [],
    limits: loaded?.limits.map(limit => ({ ...limit })) ?? [],
    notes: [...(loaded?.notes ?? [])], browUnderlay: input.browUnderlay, skin: skinEvidence, eyes: eyeEvidence,
    components: loaded?.components.map(item => ({ slot: item.component.slot, option: item.component.option, definition: item.component.definition,
      component: item.component.component, geometry: item.component.geometry.depotPath, visible: item.root.visible,
      chunks: item.meshes.map(mesh => mesh.name), templates: [...new Set(item.component.materials.map(material => material.template))],
      vertices: item.meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute("position").count, 0) })) ?? [] };
}
