/**
 * The Save Explorer (research/save/save-editor-design.md phase 1): a Studio module without a document part. Its pure core is the read
 * model (explorer.ts) and the application service (actions.ts); `view/` is its panel and `host/` the read-only endpoints both hosts mount.
 */
export { SAVE_EXPLORER_MODULE } from "./module";
export { MAX_SAVE_BYTES, SAVE_EXPLORER_DESCRIPTORS, SaveExplorerActions, type SaveExplorerAction, type SaveExplorerDevice, type SaveExplorerOutcome,
  type SaveExplorerState, type SaveExplorerView } from "./actions";
export { hexPreview, namespaceOf, openExplorer, type EntryPage, type InspectField, type ModDataView, type NodeInspection, type ObjectInspection,
  type ObjectRef, type SaveExplorer, type SaveSummary, type TreeRow } from "./explorer";
export { parseSaveListing, parseSaveTypeNames, SAVE_KIND_LABELS, SAVE_KINDS, type SaveKind, type SaveListing, type SaveListingResult,
  type SaveTypeNames } from "./listing";
export { saveExplorerFacade, type SaveExplorerFacade } from "./facade";
