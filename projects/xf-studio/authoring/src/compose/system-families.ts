/**
 * The platform's system families (feature-module platform §4): flat, grandfathered action
 * kinds registered in the same table shape as feature modules. Their descriptors still live
 * in `studio-action-descriptors.ts` and their services in `src/`; the family definitions move
 * into `platform/core` when that table is split (migration step 5).
 */
import { actionTable, asyncActionTable, familyId, type AsyncSystemFamily, type SystemFamily } from "../platform/api";
import type { CollectionRequest } from "../collection-service";
import type { StudioFileAction } from "../studio-file-operations";
import type { CollectionStudioAction } from "../collection-actions";
import type { HistoryAction } from "../authoring-history";
import type { MotionAction } from "../motion-actions";
import type { PreviewAction } from "../preview-actions";
import type { QualityAction } from "../preview-quality-actions";
import type { SavedAppearanceAction } from "../saved-appearance-actions";
import { ACTION_DESCRIPTORS, FILE_DESCRIPTORS, REQUEST_DESCRIPTORS, type ActionScope, type FileDescriptor,
  type RequestDescriptor } from "../studio-action-descriptors";

export type { CollectionStudioAction, HistoryAction };

const HISTORY_ID = familyId("history");
const COLLECTION_ID = familyId("collection");
const PREVIEW_ID = familyId("preview");
const MOTION_ID = familyId("motion");
const QUALITY_ID = familyId("quality");
const SAVED_V_ID = familyId("savedV");
const LIBRARY_ID = familyId("library");
const FILES_ID = familyId("files");

export const HISTORY_FAMILY: SystemFamily<HistoryAction, ActionScope, typeof HISTORY_ID> = Object.freeze({
  owner: "system", id: HISTORY_ID, label: "History",
  actions: actionTable<HistoryAction, ActionScope>(ACTION_DESCRIPTORS,
    { "history.undo": true, "history.redo": true, "history.jumpTo": true }),
});

export const COLLECTION_FAMILY: SystemFamily<CollectionStudioAction, ActionScope, typeof COLLECTION_ID> = Object.freeze({
  owner: "system", id: COLLECTION_ID, label: "Collection",
  actions: actionTable<CollectionStudioAction, ActionScope>(ACTION_DESCRIPTORS, {
    "preset.edit": true, "preset.select": true, "collection.rename": true,
    "collection.open": true, "collection.undoOpen": true, "collection.importRecipe": true }),
});

/** Camera and viewing: device-backed, so it needs the scene and a failure after the gate is `unavailable`. */
export const PREVIEW_FAMILY: SystemFamily<PreviewAction, ActionScope, typeof PREVIEW_ID> = Object.freeze({
  owner: "system", id: PREVIEW_ID, label: "Preview", needsScene: true, thrown: "unavailable",
  actions: actionTable<PreviewAction, ActionScope>(ACTION_DESCRIPTORS, {
    "camera.front": true, "camera.setFov": true, "camera.endFovGesture": true, "camera.restore": true,
    "camera.navigate": true, "camera.creatorFraming": true, "preview.setLightingPreset": true,
    "preview.setCreatorLighting": true, "preview.setExposure": true, "preview.setKeyAngle": true,
    "preview.setEyeShape": true, "preview.setPiercingPreview": true, "preview.setPiercings": true,
    "preview.setSurfaceControls": true, "preview.setWire": true, "preview.setNormals": true,
    "preview.setEyeOptics": true, "preview.setHair": true, "preview.setDetail": true }),
});

export const MOTION_FAMILY: SystemFamily<MotionAction, ActionScope, typeof MOTION_ID> = Object.freeze({
  owner: "system", id: MOTION_ID, label: "Motion", needsScene: true, thrown: "unavailable",
  actions: actionTable<MotionAction, ActionScope>(ACTION_DESCRIPTORS, {
    "motion.setIdle": true, "motion.setPaused": true, "motion.setContributions": true,
    "motion.setBlink": true, "motion.playBlink": true }),
});

/** Preview quality works without the scene (it sizes generated textures), but its device failures are `unavailable`. */
export const QUALITY_FAMILY: SystemFamily<QualityAction, ActionScope, typeof QUALITY_ID> = Object.freeze({
  owner: "system", id: QUALITY_ID, label: "Preview quality", thrown: "unavailable",
  actions: actionTable<QualityAction, ActionScope>(ACTION_DESCRIPTORS, { "quality.set": true, "quality.rebuild": true }),
});

export const SAVED_V_FAMILY: SystemFamily<SavedAppearanceAction, ActionScope, typeof SAVED_V_ID> = Object.freeze({
  owner: "system", id: SAVED_V_ID, label: "Saved V", needsScene: true,
  actions: actionTable<SavedAppearanceAction, ActionScope>(ACTION_DESCRIPTORS, { "savedV.load": true, "savedV.restore": true }),
});

/**
 * Asynchronous families (CORE-36): the collection library's requests (`CollectionService.execute`) and
 * the file workflows (`StudioFileOperations`). They never record Undo; the registry routes them by
 * owner (`routeAsync`) and keeps them out of the synchronous action table and its golden snapshot.
 */
export const LIBRARY_FAMILY: AsyncSystemFamily<CollectionRequest, RequestDescriptor, typeof LIBRARY_ID> = Object.freeze({
  owner: "system", async: true, id: LIBRARY_ID, label: "Library",
  actions: asyncActionTable<CollectionRequest, RequestDescriptor>(REQUEST_DESCRIPTORS),
});
export const FILES_FAMILY: AsyncSystemFamily<StudioFileAction, FileDescriptor, typeof FILES_ID> = Object.freeze({
  owner: "system", async: true, id: FILES_ID, label: "Files",
  actions: asyncActionTable<StudioFileAction, FileDescriptor>(FILE_DESCRIPTORS),
});
