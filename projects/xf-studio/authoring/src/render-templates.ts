/**
 * The material templates the browser renderer can draw, and which of each template's inputs its
 * adapter reads. The host uses this table only to decide which resolved textures and profiles to
 * export for a chunk; it never interprets them. The renderer's material adapters
 * (`character-material-adapters.ts`) interpret the channels. A chunk whose template is not listed
 * here is recorded but not drawn (for example hair shadow meshes on `glass.mt` or `metal_base.remt`).
 *
 * Template paths are the game's own depot paths; nothing here names a mod or framework.
 */
export type RenderAdapterId = "hair-strand" | "hair-cap-decal" | "double-diffuse-decal";
export type RenderTemplateInputs = {
  readonly adapter: RenderAdapterId;
  /** Texture parameters the adapter samples. */
  readonly textures: readonly string[];
  /** `CHairProfile` parameters the adapter reads. */
  readonly profiles: readonly string[];
};

export const RENDER_TEMPLATES: Readonly<Record<string, RenderTemplateInputs>> = Object.freeze({
  // Hair cards and lashes (knowledge/hair-shading.md §1–4).
  "base\\materials\\hair.mt": { adapter: "hair-strand", textures: ["Strand_Alpha", "Strand_ID", "Strand_Gradient"], profiles: ["HairProfile"] },
  // Hair caps: a post-G-buffer decal recoloured through a gradient.
  "base\\materials\\mesh_decal_gradientmap_recolor.mt": { adapter: "hair-cap-decal", textures: ["MaskTexture", "GradientMap"], profiles: [] },
  // Brows (and, later, several lip styles): the double-diffuse post-G-buffer decal.
  "base\\materials\\mesh_decal_double_diffuse.mt": { adapter: "double-diffuse-decal",
    textures: ["DiffuseTexture", "SecondaryDiffuseAlpha", "GradientMap"], profiles: [] },
});

const key = (template: string) => template.toLowerCase().replaceAll("/", "\\");
const BY_KEY = new Map(Object.entries(RENDER_TEMPLATES).map(([template, inputs]) => [key(template), inputs]));

/** The renderer's inputs for a template depot path, or undefined when the preview does not draw it. */
export function renderTemplate(template: string | null | undefined): RenderTemplateInputs | undefined {
  return template ? BY_KEY.get(key(template)) : undefined;
}
