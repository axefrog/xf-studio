/**
 * The material templates the browser renderer can draw, and which of each template's inputs its
 * adapter reads. The host uses this table only to decide which resolved textures and profiles to
 * export for a chunk; it never interprets them. The renderer's material adapters
 * (`character-material-adapters.ts`) interpret the channels. A chunk whose template is not listed
 * here is recorded but not drawn (for example hair shadow meshes on `glass.mt` or `metal_base.remt`).
 *
 * Template paths are the game's own depot paths; nothing here names a mod or framework.
 */
export type RenderAdapterId = "skin" | "hair-strand" | "hair-cap-decal" | "double-diffuse-decal" | "eye" | "eye-shell" | "layered-placeholder";
export type RenderTemplateInputs = {
  readonly adapter: RenderAdapterId;
  /** Texture parameters the adapter samples. */
  readonly textures: readonly string[];
  /** `CHairProfile` parameters the adapter reads. */
  readonly profiles: readonly string[];
  /** `CSkinProfile` parameters the adapter reads. */
  readonly skinProfiles: readonly string[];
  /** `CGradient` parameters the adapter reads (their stops go into the record). */
  readonly gradients?: readonly string[];
  /**
   * Recorded so the renderer can say the chunk is not drawn yet, never drawn itself: a component is planned only
   * when it has at least one chunk that really draws (so a part made only of such chunks stays out, as before).
   */
  readonly placeholder?: true;
};

export const RENDER_TEMPLATES: Readonly<Record<string, RenderTemplateInputs>> = Object.freeze({
  // The head's skin (knowledge/head-cc-rendering.md §2, materials-and-shaders.md §4.1). The wrinkle maps
  // (`Detailmap_Stretch/Squash`) and blood flow are animation-driven and neutral at rest, so they are not read.
  "base\\materials\\skin.mt": { adapter: "skin", profiles: [], skinProfiles: ["SkinProfile"],
    textures: ["Albedo", "Normal", "Roughness", "DetailNormal", "MicroDetail", "TintColorMask", "SecondaryAlbedo", "EmissiveMask"] },
  // Hair cards and lashes (knowledge/hair-shading.md §1–4).
  "base\\materials\\hair.mt": { adapter: "hair-strand", textures: ["Strand_Alpha", "Strand_ID", "Strand_Gradient"], profiles: ["HairProfile"], skinProfiles: [] },
  // Hair caps: a post-G-buffer decal recoloured through a gradient.
  "base\\materials\\mesh_decal_gradientmap_recolor.mt": { adapter: "hair-cap-decal", textures: ["MaskTexture", "GradientMap"], profiles: [], skinProfiles: [] },
  // Brows (and, later, several lip styles): the double-diffuse post-G-buffer decal.
  "base\\materials\\mesh_decal_double_diffuse.mt": { adapter: "double-diffuse-decal",
    textures: ["DiffuseTexture", "SecondaryDiffuseAlpha", "GradientMap"], profiles: [], skinProfiles: [] },
  // The eyeball (knowledge/eye-rendering.md §2). Both templates share one program; the gradient one adds the iris
  // mask and colour ramp. `Normal` and `NormalBubble` feed the two-normal eye light (ranks 4–5) and are recorded now.
  "base\\materials\\eye.mt": { adapter: "eye", profiles: [], skinProfiles: [],
    textures: ["Albedo", "Normal", "Roughness", "NormalBubble"] },
  "base\\materials\\eye_gradient.mt": { adapter: "eye", profiles: [], skinProfiles: [], gradients: ["IrisColorGradient"],
    textures: ["Albedo", "Normal", "Roughness", "NormalBubble", "IrisMask"] },
  // The eye's wetness shell: a forward pass that darkens the eye towards the lids and adds the tear line (§4).
  "base\\materials\\eye_shadow.mt": { adapter: "eye-shell", textures: ["Mask"], profiles: [], skinProfiles: [] },
  // Layered (`.mlsetup`) materials: the graphic eye designs, many piercings and accessories. No adapter draws them yet.
  "engine\\materials\\multilayered.mt": { adapter: "layered-placeholder", textures: [], profiles: [], skinProfiles: [], placeholder: true },
});

const key = (template: string) => template.toLowerCase().replaceAll("/", "\\");
const BY_KEY = new Map(Object.entries(RENDER_TEMPLATES).map(([template, inputs]) => [key(template), inputs]));

/** The renderer's inputs for a template depot path, or undefined when the preview does not draw it. */
export function renderTemplate(template: string | null | undefined): RenderTemplateInputs | undefined {
  return template ? BY_KEY.get(key(template)) : undefined;
}
