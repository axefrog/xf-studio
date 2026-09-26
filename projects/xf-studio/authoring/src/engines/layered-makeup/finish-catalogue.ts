import { canonicalFinish, finishDescription, type Finish } from "./finish";
import { defaultFlakes } from "./finish";
import type { GlitterModel } from "./glitter-model";
import { finishExportSummary } from "./finish-export";
import type { RegionWording } from "./region";

/** Canonical finish IDs offered for new edits; `satin` is a legacy alias of `regular`. */
export type FinishId = ReturnType<typeof canonicalFinish>;
export type FinishDescriptor = {
  id: FinishId;
  /** Full name for menus and search, e.g. "Glossy / wet look". */
  label: string;
  /** One-word card name, e.g. "Glossy"; synonyms move to `aliases`. */
  shortLabel: string;
  /** Other names people use for this family (foil, pearl, wet look, duochrome). */
  aliases: string[];
  /**
   * Stored names that mean this finish (older recipes' `satin` is `regular`): `layer.setFinish` accepts them,
   * menus never offer them, and a view finds a layer's finish by its ID or one of these (UI-54).
   */
  stored: string[];
  description: string;
  /** Browser preview maturity, not a claim about in-game appearance. */
  preview: "working" | "preview-study";
  /** Mirrors the export route policy (finish-export.ts). A package Check remains authoritative:
   * experimental finishes export only in their game-matched model. */
  exportAdapter: "flat-provisional" | "experimental" | "none";
  exportNote: string;
};
export type GlitterModelDescriptor = { id: GlitterModel; label: string; summary: string;
  /**
   * The stored flake-model names that mean this Glitter model (a layer's `flakes.model`; classic flakes have none), so a view
   * finds a layer's model by data, never by its own table (UI-10).
   */
  stored: string[];
  /** The settings a layer without stored flakes shows for this model (the defaults the model starts from; UI-93). */
  defaults?: Readonly<Record<string, number>>;
  /**
   * A control's usable range where it is narrower than the action accepts: the legacy glint-strength control stopped at 16 of the
   * parser's 32 for usable slider resolution (UI-93).
   */
  controlMax?: Readonly<Record<string, number>>;
};

const labels: Record<FinishId, string> = {
  matte: "Matte", regular: "Satin", metallic: "Metallic / foil", shimmer: "Shimmer / pearl",
  glitter: "Glitter", glossy: "Glossy / wet look", iridescent: "Colour-shifting",
};
const short: Record<FinishId, [string, string[]]> = {
  matte: ["Matte", []], regular: ["Satin", []], metallic: ["Metallic", ["foil"]], shimmer: ["Shimmer", ["pearl"]],
  glitter: ["Glitter", []], glossy: ["Glossy", ["wet look"]], iridescent: ["Colour-shift", ["duochrome"]],
};
/** Finish IDs offered for new edits, in menu order. */
export const FINISH_IDS: readonly FinishId[] = ["matte", "regular", "metallic", "shimmer", "glitter", "glossy", "iridescent"];
/** Stored legacy names `layer.setFinish` still accepts (as the same finish) but never offers. */
export const LEGACY_FINISH_ALIASES: readonly Finish[] = ["satin"];

/**
 * Read-only finish taxonomy for presentations. Export status derives from the same route
 * policy the package filter and compiler use, so a UI never keeps its own copy of
 * eligibility. Descriptors are informational: Check decides.
 */
export function finishCatalogue(wording: RegionWording): FinishDescriptor[] {
  return FINISH_IDS.map(id => {
    const summary = finishExportSummary(id as Finish);
    return {
      id, label: labels[id], shortLabel: short[id][0], aliases: short[id][1],
      stored: LEGACY_FINISH_ALIASES.filter(alias => canonicalFinish(alias) === id), description: finishDescription(id as Finish, wording.surface),
      preview: summary.adapter === "none" ? "preview-study" : "working",
      exportAdapter: summary.adapter, exportNote: summary.note,
    };
  });
}

/** The legacy glint-strength control's top (of the parser's 32), kept for usable slider resolution. */
const GLINT_CONTROL_MAX = Object.freeze({ strength: 16 });
const classicDefaults = () => { const { cells, density, tilt } = defaultFlakes(); return Object.freeze({ cells, density, tilt }); };
/** The Glitter models' descriptors; `wording` names the region's area. */
export function glitterModelCatalogue(wording: RegionWording): GlitterModelDescriptor[] {
  return [
    { id: "classic", label: "Classic reflective flakes", stored: [], defaults: classicDefaults(),
      summary: "Original reflective flake map; existing classic recipes retain this look." },
    { id: "irregular", label: "Irregular raster flakes", stored: ["irregular-planar-1"],
      summary: `Irregular flakes are baked into a texture. Dense settings cover ${wording.area} and can lose sparkle at face distance.` },
    { id: "direct", label: "Direct-light glints", stored: ["uv-cell-direct-1"], controlMax: GLINT_CONTROL_MAX,
      summary: "Fine facets and occasional larger flashes respond to the preview light." },
    { id: "clustered", label: "Clustered fine glints", stored: ["uv-cell-direct-2"], controlMax: GLINT_CONTROL_MAX,
      summary: "Fine facets gather in soft clusters over a continuous sheen." },
    { id: "fine", label: "Dense fine speckles", stored: ["uv-cell-direct-3"], controlMax: GLINT_CONTROL_MAX,
      summary: "Denser tiny speckles with a sparse population of larger flashes; can look frosty." },
  ];
}
