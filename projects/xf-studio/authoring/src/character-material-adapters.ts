import * as THREE from "three";
import { createDoubleDiffuseDecalMaterial, doubleDiffuseParameters } from "./brow-material";
import { hairMaterialFromScalars, type ProfileEncoding } from "./hair-colour-model";
import { attachHairColor, attachHairVertexRed, hairProfileTexture, HAIR_CAP_DECAL_MATERIAL, STRAND_COVERAGE_MATERIAL,
  STRAND_COVERAGE_OVER_MAKEUP_MATERIAL } from "./hair-shading";
import type { DetailSlot, RenderChunkMaterial } from "./render-detail";
import { renderTemplate, type RenderAdapterId } from "./render-templates";
import { createSkinMaterial, skinBaseImage, skinParameters, type SkinImage, type SkinMaterialHandle } from "./skin-material";

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
  /**
   * Linear skin colour under each vertex of a decal mesh, for the sqrt-space G-buffer blend; throws when unavailable.
   * `skin` is the resolved skin's toned base colour when the V's skin loaded before the decal.
   */
  underlay?: (mesh: THREE.Mesh, skin?: SkinImage | null) => THREE.BufferAttribute;
  /** The resolved skin's toned base colour (8-bit sRGB), when the skin was loaded first. */
  skinBase?: () => SkinImage | null;
  /** How hair profile stops are decoded (knowledge/hair-shading.md §3). */
  profileEncoding: ProfileEncoding;
};
export type AdaptedMaterial = { material: THREE.Material; owned: THREE.Texture[]; notes: string[];
  /** Plain lines for the person using the app when part of the chunk is not drawn. */
  limits?: string[];
  /** The skin adapter's handle and its toned base colour for decals drawn over it. */
  skin?: { handle: SkinMaterialHandle; base: () => SkinImage | null } };
export interface MaterialAdapter {
  readonly id: RenderAdapterId;
  create(chunk: RenderChunkMaterial, textures: ChunkTextures, mesh: THREE.Mesh, context: AdapterContext): AdaptedMaterial;
}

const need = (texture: THREE.Texture | undefined, parameter: string, chunk: RenderChunkMaterial) => {
  if (!texture) throw Error(`chunk ${chunk.chunk} has no ${parameter}`);
  return texture;
};

/**
 * Pixels of a loaded texture image, scaled to at most `size` on its longer side, or null outside a browser
 * (no canvas) or before the image has loaded.
 */
export function texturePixels(texture: THREE.Texture | undefined, size: number): SkinImage | null {
  const image = texture?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image || !image.width || !image.height || typeof document === "undefined") return null;
  const scale = Math.min(1, size / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

const FLAT_NORMAL = [128, 128, 255, 255], BLACK = [0, 0, 0, 255], CLEAR = [0, 0, 0, 0];
/** Size of the skin colour image decals blend against (enough for per-vertex sampling). */
const SKIN_BASE_SIZE = 1024;
const GLOW_LIMIT = "Glowing skin details from your installed mods aren't shown yet.";

/**
 * `skin.mt`: the head's skin from the resolved chain (skin-material.ts): albedo, RG normal, roughness R/B
 * (and G as metalness), detail normal, microdetail with the tint-mask selectors, tone tint, secondary
 * albedo, and the profile's dual specular lobe with a subsurface stand-in. An optional input the chain
 * leaves out falls back to its neutral value; the emissive mask is read only to say when it would glow.
 */
const skinAdapter: MaterialAdapter = {
  id: "skin",
  create(chunk, textures) {
    // The engine samples every skin input through its resource's own format, so each honours `isGamma`
    // (a framework's tint mask can be a gamma texture); vanilla normals, roughness and masks are linear anyway.
    const sampled = (parameter: string) => textures(parameter, "colour", "repeat");
    const albedo = need(sampled("Albedo"), "Albedo", chunk);
    const normal = need(sampled("Normal"), "Normal", chunk);
    const roughness = need(sampled("Roughness"), "Roughness", chunk);
    const owned: THREE.Texture[] = [];
    const neutral = (rgba: number[]) => {
      const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
      texture.needsUpdate = true;
      owned.push(texture);
      return texture;
    };
    const tintMask = sampled("TintColorMask"), secondary = sampled("SecondaryAlbedo");
    const parameters = skinParameters(chunk);
    const { material, handle } = createSkinMaterial({ albedo, normal, roughness,
      detailNormal: sampled("DetailNormal") ?? neutral(FLAT_NORMAL),
      microDetail: sampled("MicroDetail") ?? neutral(FLAT_NORMAL),
      tintMask: tintMask ?? neutral(BLACK), secondary: secondary ?? neutral(CLEAR) }, parameters);
    const notes: string[] = [], limits: string[] = [];
    if (!parameters.profile) notes.push("no readable skin profile; the base game's default profile values are used");
    // Emissive has no path in the preview yet: say so only when the resolved mask would actually glow.
    const emissive = parameters.emissiveEV > 0.001 ? sampled("EmissiveMask") : undefined;
    const glow = texturePixels(emissive, 64);
    if (glow && Array.from({ length: glow.width * glow.height }, (_, i) => glow.data[i * 4]!).some(red => red > 2)) limits.push(GLOW_LIMIT);
    let base: SkinImage | null | undefined;
    const baseImage = () => {
      if (base !== undefined) return base;
      const colour = texturePixels(albedo, SKIN_BASE_SIZE);
      const size = colour ? Math.max(colour.width, colour.height) : 0;
      base = colour ? skinBaseImage(colour, texturePixels(tintMask, size), texturePixels(secondary, size), parameters,
        { albedo: albedo.colorSpace === THREE.SRGBColorSpace, secondary: secondary?.colorSpace === THREE.SRGBColorSpace,
          mask: tintMask?.colorSpace === THREE.SRGBColorSpace }) : null;
      return base;
    };
    return { material, owned, notes, limits, skin: { handle, base: baseImage } };
  },
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
      try { mesh.geometry.setAttribute("xfsUnderlay", context.underlay(mesh, context.skinBase?.() ?? null)); gbufferBlend = true; }
      catch (error) { notes.push(`linear decal blend (${(error as Error).message})`); }
    }
    const material = createDoubleDiffuseDecalMaterial(primary, secondary, gradient,
      { gbufferBlend, parameters: doubleDiffuseParameters(chunk.scalars, chunk.colours) });
    return { material, owned: [], notes };
  },
};

export const MATERIAL_ADAPTERS: Readonly<Record<RenderAdapterId, MaterialAdapter>> = Object.freeze({
  skin: skinAdapter, "hair-strand": hairStrand, "hair-cap-decal": hairCapDecal, "double-diffuse-decal": doubleDiffuseDecal });

/** The adapter for a chunk's template, or undefined when the preview does not draw that template. */
export function materialAdapter(template: string | null): MaterialAdapter | undefined {
  const inputs = renderTemplate(template);
  return inputs ? MATERIAL_ADAPTERS[inputs.adapter] : undefined;
}
