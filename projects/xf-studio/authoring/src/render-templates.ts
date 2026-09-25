/**
 * The material templates the browser renderer can draw, and which of each template's inputs its
 * adapter reads. The host uses this table only to decide which resolved textures and profiles to
 * export for a chunk; it never interprets them. The renderer's material adapters
 * (`character-material-adapters.ts`) interpret the channels. A chunk whose template is not listed
 * here is recorded but not drawn (for example hair shadow meshes on `glass.mt` or `metal_base.remt`).
 *
 * A template is identified the way the engine finds its compiled programs: by the template's own `name`
 * (the `CMaterialTemplate.name` CName), not by its depot path (knowledge/materials-and-shaders.md §3.1). A mod
 * that ships a copy of `mesh_decal.mt` at its own path (for example to change `materialPriority`) keeps the name
 * `mesh_decal` and draws with the same programs, so it gets the same adapter. When the template resource could
 * not be read, the vanilla depot path is the fallback key. Nothing here names a mod or framework.
 */
export type RenderAdapterId = "skin" | "hair-strand" | "hair-cap-decal" | "double-diffuse-decal" | "mesh-decal" | "eye" | "eye-shell"
  | "layered-placeholder" | "decal-placeholder";
/** Members of the post-G-buffer decal family that the face-detail path draws through one shared material (face-decal-material.ts). */
export type DecalKind = "mesh-decal" | "double-diffuse" | "gradient-recolor";
export type RenderTemplateInputs = {
  readonly adapter: RenderAdapterId;
  /** The vanilla template's depot path (the fallback key when a chunk's template name is unknown). */
  readonly path: string;
  /** Texture parameters the adapter samples. */
  readonly textures: readonly string[];
  /** `CHairProfile` parameters the adapter reads. */
  readonly profiles: readonly string[];
  /** `CSkinProfile` parameters the adapter reads. */
  readonly skinProfiles: readonly string[];
  /** `CGradient` parameters the adapter reads (their stops go into the record). */
  readonly gradients?: readonly string[];
  /** A post-G-buffer decal the face-detail path draws with the shared decal material, and the textures that material reads. */
  readonly decal?: DecalKind;
  readonly decalTextures?: readonly string[];
  /**
   * Recorded so the renderer can say the chunk is not drawn yet, never drawn itself: a component is planned only
   * when it has at least one chunk that really draws (so a part made only of such chunks stays out, as before),
   * except face details, which are recorded so the missing part can be reported.
   */
  readonly placeholder?: true;
};

const DECAL_SURFACE = ["NormalTexture", "NormalAlphaTex", "RoughnessTexture", "MetalnessTexture", "SecondaryMask"] as const;
const none = { profiles: [], skinProfiles: [] } as const;
/** A decal-family template the preview does not draw yet: recorded, hidden, and reported with the `decal-template` limit. */
const decalPlaceholder = (name: string) => ({ adapter: "decal-placeholder" as const, path: `base\\materials\\${name}.mt`, textures: [], ...none, placeholder: true as const });

/** Keyed by template name. */
export const RENDER_TEMPLATES: Readonly<Record<string, RenderTemplateInputs>> = Object.freeze({
  // The head's skin (knowledge/head-cc-rendering.md §2, materials-and-shaders.md §4.1). The wrinkle maps
  // (`Detailmap_Stretch/Squash`) and blood flow are animation-driven and neutral at rest, so they are not read.
  skin: { adapter: "skin", path: "base\\materials\\skin.mt", profiles: [], skinProfiles: ["SkinProfile"],
    textures: ["Albedo", "Normal", "Roughness", "DetailNormal", "MicroDetail", "TintColorMask", "SecondaryAlbedo", "EmissiveMask"] },
  // Hair cards and lashes (knowledge/hair-shading.md §1–4).
  hair: { adapter: "hair-strand", path: "base\\materials\\hair.mt", textures: ["Strand_Alpha", "Strand_ID", "Strand_Gradient"], profiles: ["HairProfile"], skinProfiles: [] },
  // Hair caps: a post-G-buffer decal recoloured through a gradient. On the face it is a member of the decal family,
  // which also reads the ID map (`DiffuseTexture`) the gradient is indexed by.
  mesh_decal_gradientmap_recolor: { adapter: "hair-cap-decal", path: "base\\materials\\mesh_decal_gradientmap_recolor.mt", decal: "gradient-recolor",
    textures: ["MaskTexture", "GradientMap"], decalTextures: ["MaskTexture", "GradientMap", "DiffuseTexture", ...DECAL_SURFACE], ...none },
  // Brows and several lip styles: the double-diffuse post-G-buffer decal. Brows keep their own study adapter (brow-material.ts);
  // on the face the decal family also reads the normal and surface inputs.
  mesh_decal_double_diffuse: { adapter: "double-diffuse-decal", path: "base\\materials\\mesh_decal_double_diffuse.mt", decal: "double-diffuse",
    textures: ["DiffuseTexture", "SecondaryDiffuseAlpha", "GradientMap"],
    decalTextures: ["DiffuseTexture", "SecondaryDiffuseAlpha", "GradientMap", ...DECAL_SURFACE], ...none },
  // The plain post-G-buffer decal: eye makeup, most lip styles, cheeks, freckles, pimples, scars, tattoos, face cyberware,
  // stubble and the personal-link port (knowledge/head-cc-rendering.md §3). 2.31 has no separate normal-only decal template:
  // scars and cyberware write their normals through this one.
  mesh_decal: { adapter: "mesh-decal", path: "base\\materials\\mesh_decal.mt", decal: "mesh-decal", textures: ["DiffuseTexture", ...DECAL_SURFACE],
    decalTextures: ["DiffuseTexture", ...DECAL_SURFACE], ...none },
  // The eyeball (knowledge/eye-rendering.md §2). Both templates share one program; the gradient one adds the iris
  // mask and colour ramp. `Normal` and `NormalBubble` feed the two-normal eye light (ranks 4–5) and are recorded now.
  eye: { adapter: "eye", path: "base\\materials\\eye.mt", profiles: [], skinProfiles: [], textures: ["Albedo", "Normal", "Roughness", "NormalBubble"] },
  eye_gradient: { adapter: "eye", path: "base\\materials\\eye_gradient.mt", profiles: [], skinProfiles: [], gradients: ["IrisColorGradient"],
    textures: ["Albedo", "Normal", "Roughness", "NormalBubble", "IrisMask"] },
  // The eye's wetness shell: a forward pass that darkens the eye towards the lids and adds the tear line (§4).
  eye_shadow: { adapter: "eye-shell", path: "base\\materials\\eye_shadow.mt", textures: ["Mask"], profiles: [], skinProfiles: [] },
  // Layered (`.mlsetup`) materials: the graphic eye designs, many piercings and accessories. No adapter draws them yet.
  multilayered: { adapter: "layered-placeholder", path: "engine\\materials\\multilayered.mt", textures: [], profiles: [], skinProfiles: [], placeholder: true },
  // The rest of the 2.31 decal family (names from the installed shader cache's compiled templates): recorded, not drawn yet.
  ...Object.fromEntries(["mesh_decal__blackbody", "mesh_decal_blendable", "mesh_decal_emissive", "mesh_decal_emissive_subsurface", "mesh_decal_gradient",
    "mesh_decal_gradientmap_recolor_2", "mesh_decal_gradientmap_recolor_blendable", "mesh_decal_gradientmap_recolor_emissive", "mesh_decal_morph",
    "mesh_decal_multitinted", "mesh_decal_parallax", "mesh_decal_particles", "mesh_decal_revealed", "mesh_decal_wet_character"]
    .map(name => [name, decalPlaceholder(name)])),
});

const key = (template: string) => template.toLowerCase().replaceAll("/", "\\");
const BY_NAME = new Map(Object.entries(RENDER_TEMPLATES).map(([name, inputs]) => [name.toLowerCase(), inputs]));
const BY_PATH = new Map(Object.values(RENDER_TEMPLATES).map(inputs => [key(inputs.path), inputs]));

/**
 * The renderer's inputs for a chunk's template, or undefined when the preview does not draw it. `name` is the template's
 * own name (read from the `.mt`); without it, only the vanilla depot paths are recognised.
 */
export function renderTemplate(template: string | null | undefined, name?: string | null): RenderTemplateInputs | undefined {
  if (name) return BY_NAME.get(name.toLowerCase());
  return template ? BY_PATH.get(key(template)) : undefined;
}

/** The texture parameters a chunk's adapter reads: the decal family's when the chunk is drawn as a face detail. */
export const templateTextures = (inputs: RenderTemplateInputs, faceDetail: boolean): readonly string[] =>
  faceDetail && inputs.decalTextures ? inputs.decalTextures : inputs.textures;

/** `EMaterialPriority`, in draw order (WolvenKit's RED4 enum: `EMP_Normal` 0, `EMP_Front` 1) [source]. */
export const MATERIAL_PRIORITIES = ["EMP_Normal", "EMP_Front"] as const;
/** A template's draw-order rank; an absent or unknown value is the serializer's default, `EMP_Normal`. */
export const priorityRank = (priority: string | null | undefined) => Math.max(0, MATERIAL_PRIORITIES.indexOf(priority as typeof MATERIAL_PRIORITIES[number]));
