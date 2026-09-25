import * as THREE from "three";
import { createDoubleDiffuseDecalMaterial, doubleDiffuseParameters } from "./brow-material";
import { hairMaterialFromScalars, type ProfileEncoding } from "./hair-colour-model";
import { attachHairColor, attachHairVertexRed, hairProfileTexture, HAIR_CAP_DECAL_MATERIAL, STRAND_COVERAGE_MATERIAL,
  STRAND_COVERAGE_OVER_MAKEUP_MATERIAL } from "./hair-shading";
import type { DetailSlot, RenderChunkMaterial } from "./render-detail";
import { renderTemplate, type RenderAdapterId } from "./render-templates";

/**
 * Renderer material adapters: one per game material template the preview draws (render-templates.ts).
 * Each turns a resolved chunk's `{template, scalars, colours, textures, profiles}` into a Three material,
 * and is the only place that interprets texture channels and colour flags. Nothing here knows which mod
 * or character-creator choice a chunk came from.
 */
export type TextureUse = "colour" | "data";
export type TextureWrap = "repeat" | "clamp";
/**
 * The loader's textures for one chunk: a resolved texture parameter as the adapter wants to sample it.
 * `colour` decodes sRGB when the resource says `isGamma`; `data` never decodes (masks, IDs, alpha).
 */
/** Only a colour input honours the resource's own `isGamma` flag; data inputs are never decoded. */
export const textureColourSpace = (use: TextureUse, isGamma: boolean): THREE.ColorSpace =>
  use === "colour" && isGamma ? THREE.SRGBColorSpace : THREE.NoColorSpace;
export type ChunkTextures = (parameter: string, use: TextureUse, wrap: TextureWrap) => THREE.Texture | undefined;
export type AdapterContext = {
  slot: DetailSlot;
  /** Draw after the editable makeup stack (lashes sit over the eye plate). */
  overMakeup: boolean;
  /** Linear skin albedo under each vertex of a decal mesh, for the sqrt-space G-buffer blend; throws when unavailable. */
  underlay?: (mesh: THREE.Mesh) => THREE.BufferAttribute;
  /** How hair profile stops are decoded (knowledge/hair-shading.md §3). */
  profileEncoding: ProfileEncoding;
};
export type AdaptedMaterial = { material: THREE.Material; owned: THREE.Texture[]; notes: string[] };
export interface MaterialAdapter {
  readonly id: RenderAdapterId;
  create(chunk: RenderChunkMaterial, textures: ChunkTextures, mesh: THREE.Mesh, context: AdapterContext): AdaptedMaterial;
}

const need = (texture: THREE.Texture | undefined, parameter: string, chunk: RenderChunkMaterial) => {
  if (!texture) throw Error(`chunk ${chunk.chunk} has no ${parameter}`);
  return texture;
};

/** `hair.mt`: strands and lashes. Profile lookup, overlay, coverage and hair light (hair-shading.ts). */
const hairStrand: MaterialAdapter = {
  id: "hair-strand",
  create(chunk, textures, mesh, context) {
    const alpha = need(textures("Strand_Alpha", "data", "repeat"), "Strand_Alpha", chunk);
    const id = need(textures("Strand_ID", "data", "repeat"), "Strand_ID", chunk);
    const gradient = need(textures("Strand_Gradient", "data", "repeat"), "Strand_Gradient", chunk);
    const profile = chunk.profiles.HairProfile;
    if (!profile) throw Error(`chunk ${chunk.chunk} has no HairProfile`);
    const profileTexture = hairProfileTexture(profile, profile.sampleCount, context.profileEncoding);
    const material = new THREE.MeshPhysicalMaterial({
      // anisotropy > 0 makes Three skin and interpolate the tangent frame (strand direction = bitangent).
      specularIntensity: 0, anisotropy: 1e-4, color: 0xffffff, roughness: 0.65, side: THREE.DoubleSide, alphaMap: alpha,
      // Dithered, TAA-resolved coverage as MSAA alpha-to-coverage; lashes queue after the makeup plates.
      ...(context.overMakeup ? STRAND_COVERAGE_OVER_MAKEUP_MATERIAL : STRAND_COVERAGE_MATERIAL),
    });
    attachHairVertexRed(mesh.geometry);
    attachHairColor(material, { kind: "strand", id, gradient, profile: profileTexture, sampleCount: profile.sampleCount,
      material: hairMaterialFromScalars(chunk.scalars) });
    return { material, owned: [profileTexture], notes: [] };
  },
};

/** `mesh_decal_gradientmap_recolor.mt`: the hair cap, a mask-blended decal recoloured through a gradient. */
const hairCapDecal: MaterialAdapter = {
  id: "hair-cap-decal",
  create(chunk, textures) {
    const mask = need(textures("MaskTexture", "data", "repeat"), "MaskTexture", chunk);
    const gradient = need(textures("GradientMap", "colour", "clamp"), "GradientMap", chunk);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide, alphaMap: mask,
      ...HAIR_CAP_DECAL_MATERIAL });
    attachHairColor(material, { kind: "cap", mask, gradient });
    return { material, owned: [], notes: [] };
  },
};

/** `mesh_decal_double_diffuse.mt`: brows. Primary colour/coverage, secondary alpha, gradient tint, sqrt-space blend. */
const doubleDiffuseDecal: MaterialAdapter = {
  id: "double-diffuse-decal",
  create(chunk, textures, mesh, context) {
    const primary = need(textures("DiffuseTexture", "colour", "repeat"), "DiffuseTexture", chunk);
    const secondary = need(textures("SecondaryDiffuseAlpha", "data", "repeat"), "SecondaryDiffuseAlpha", chunk);
    const gradient = need(textures("GradientMap", "colour", "clamp"), "GradientMap", chunk);
    const notes: string[] = [];
    let gbufferBlend = false;
    if (context.underlay) {
      try { mesh.geometry.setAttribute("xfsUnderlay", context.underlay(mesh)); gbufferBlend = true; }
      catch (error) { notes.push(`linear decal blend (${(error as Error).message})`); }
    }
    const material = createDoubleDiffuseDecalMaterial(primary, secondary, gradient,
      { gbufferBlend, parameters: doubleDiffuseParameters(chunk.scalars, chunk.colours) });
    return { material, owned: [], notes };
  },
};

export const MATERIAL_ADAPTERS: Readonly<Record<RenderAdapterId, MaterialAdapter>> = Object.freeze({
  "hair-strand": hairStrand, "hair-cap-decal": hairCapDecal, "double-diffuse-decal": doubleDiffuseDecal });

/** The adapter for a chunk's template, or undefined when the preview does not draw that template. */
export function materialAdapter(template: string | null): MaterialAdapter | undefined {
  const inputs = renderTemplate(template);
  return inputs ? MATERIAL_ADAPTERS[inputs.adapter] : undefined;
}
