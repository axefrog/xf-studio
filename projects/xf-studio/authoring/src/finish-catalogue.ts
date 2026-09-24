import { canonicalFinish, finishDescription, type Finish } from "./finish";
import type { GlitterModel } from "./glitter-model";
import { SUPPORTED_FLAT_FINISHES } from "./preset-compiler";

/** Canonical finish IDs offered for new edits; `satin` is a legacy alias of `regular`. */
export type FinishId = ReturnType<typeof canonicalFinish>;
export type FinishDescriptor = {
  id: FinishId;
  label: string;
  description: string;
  /** Browser preview maturity, not a claim about in-game appearance. */
  preview: "working" | "preview-study";
  /** Mirrors the compiler's finish gate. A package Check remains authoritative. */
  exportAdapter: "flat-provisional" | "none";
  exportNote: string;
};
export type GlitterModelDescriptor = { id: GlitterModel; label: string; summary: string };

const labels: Record<FinishId, string> = {
  matte: "Matte", regular: "Satin", metallic: "Metallic / foil", shimmer: "Shimmer / pearl",
  glitter: "Glitter", glossy: "Glossy / wet look", iridescent: "Colour-shifting",
};
const order: FinishId[] = ["matte", "regular", "metallic", "shimmer", "glitter", "glossy", "iridescent"];

/**
 * Read-only finish taxonomy for presentations. Export status derives from the same
 * `SUPPORTED_FLAT_FINISHES` list the package filter and compiler use, so a UI never
 * keeps its own copy of eligibility. Descriptors are informational: Check decides.
 */
export function finishCatalogue(): FinishDescriptor[] {
  return order.map(id => {
    const exportable = SUPPORTED_FLAT_FINISHES.includes(id);
    return {
      id, label: labels[id], description: finishDescription(id as Finish),
      preview: exportable ? "working" : "preview-study",
      exportAdapter: exportable ? "flat-provisional" : "none",
      exportNote: exportable
        ? "Can become local mod files through the provisional flat adapter. Game appearance is unverified."
        : "Preview study only. Check and Build omit active layers with this finish.",
    };
  });
}

export function glitterModelCatalogue(): GlitterModelDescriptor[] {
  return [
    { id: "classic", label: "Classic reflective flakes",
      summary: "Original reflective flake map; existing classic recipes retain this look." },
    { id: "irregular", label: "Irregular raster flakes",
      summary: "Irregular flakes are baked into a texture. Dense settings cover the eye UV area and can lose sparkle at face distance." },
    { id: "direct", label: "Direct-light glints",
      summary: "Fine facets and occasional larger flashes respond to the preview light." },
    { id: "clustered", label: "Clustered fine glints",
      summary: "Fine facets gather in soft clusters over a continuous sheen." },
    { id: "fine", label: "Dense fine speckles",
      summary: "Denser tiny speckles with a sparse population of larger flashes; can look frosty." },
  ];
}
