/**
 * The composition list (feature-module platform §4, §9): every system family and feature
 * module the Studio registers, in catalogue order. Adding a feature module adds it here and
 * to `StudioOwnerActions`; the compiler then requires `StudioApplication` to bind a handler.
 */
import { Registry } from "../platform/core/registry";
import { PartRegistry } from "../platform/core/document";
import { EYE_MAKEUP, EYE_MAKEUP_ID, type EyeMakeupAction } from "../features/eye-makeup";
import { COLLECTION_FAMILY, HISTORY_FAMILY, MOTION_FAMILY, PREVIEW_FAMILY, QUALITY_FAMILY, SAVED_V_FAMILY,
  type CollectionStudioAction, type HistoryAction } from "./system-families";
import type { MotionAction } from "../motion-actions";
import type { PreviewAction } from "../preview-actions";
import type { QualityAction } from "../preview-quality-actions";
import type { SavedAppearanceAction } from "../saved-appearance-actions";

/** Each registered owner's action union, keyed by its ID. */
export type StudioOwnerActions = {
  history: HistoryAction;
  "eye-makeup": EyeMakeupAction;
  collection: CollectionStudioAction;
  preview: PreviewAction;
  motion: MotionAction;
  quality: QualityAction;
  savedV: SavedAppearanceAction;
};
export type StudioOwnerId = keyof StudioOwnerActions;

/** Registration order is catalogue order: the golden registry snapshot pins it. */
export const STUDIO_OWNERS = [HISTORY_FAMILY, EYE_MAKEUP, COLLECTION_FAMILY, PREVIEW_FAMILY, MOTION_FAMILY,
  QUALITY_FAMILY, SAVED_V_FAMILY] as const;

// Compile-time: the list's IDs are exactly the keys of StudioOwnerActions.
type ListedIds = (typeof STUDIO_OWNERS)[number]["id"];
type Unlisted = { [K in StudioOwnerId]: [Extract<ListedIds, K>] extends [never] ? K : never }[StudioOwnerId];
const exact: [ListedIds] extends [StudioOwnerId] ? [Unlisted] extends [never] ? true : false : false = true;
void exact;

export const STUDIO_REGISTRY = new Registry<(typeof STUDIO_OWNERS)[number]>(STUDIO_OWNERS);

/** Every registered feature's part and editor codecs: the document model's composition list. */
export const STUDIO_PARTS = new PartRegistry(STUDIO_OWNERS.filter(owner => owner.owner === "feature"));
/**
 * The feature the one live editor document edits. Until the look history (migration step 4)
 * the authoring document holds eye makeup's part; other parts of a look are carried unchanged.
 */
export const LIVE_FEATURE = EYE_MAKEUP_ID;
/** Eye makeup's feature ID, for the eye-makeup package pipeline's view of a look collection (moves with the exporter, step 8). */
export const EYE_MAKEUP_FEATURE = EYE_MAKEUP_ID;
export type { EyeMakeupAction, EyeMakeupEditor, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupMemory, EyeMakeupResult,
  EyeMakeupState } from "../features/eye-makeup";
