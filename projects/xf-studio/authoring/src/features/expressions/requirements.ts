/** Pure, source-studied minimums for expression-set files; shared by the exporter and composed framework diagnostic. */
export const EXPRESSIONS_REQUIREMENTS = Object.freeze({ ArchiveXL: "1.27.3", TweakXL: "1.11.4" });
export const EXPRESSION_FRAMEWORK_REQUIREMENTS = Object.freeze([
  { framework: "archivexl" as const, minimum: EXPRESSIONS_REQUIREMENTS.ArchiveXL, reason: "Expression sets add an animation component through ArchiveXL resource patches." },
  { framework: "tweakxl" as const, minimum: EXPRESSIONS_REQUIREMENTS.TweakXL, reason: "Expression sets add their photo-mode list entries through TweakXL records." },
]);
