/**
 * The composition list (feature-module platform §4, §9): every system family and feature
 * module the Studio registers, in catalogue order, and the composition the roots inject from it.
 *
 * Only composition roots import this module (the browser startup, the server and desktop hosts,
 * tools and tests); every other module receives the registry, the part registry and the live
 * feature as arguments (CORE-29). Adding a feature module adds it here; the compiler then requires
 * `StudioApplication` to bind a handler for it (`StudioOwnerActions`).
 */
import { Registry } from "../platform/core/registry";
import { PartRegistry } from "../platform/core/document";
import { EYE_MAKEUP, EYE_MAKEUP_ID } from "../features/eye-makeup";
import { COLLECTION_FAMILY, HISTORY_FAMILY, MOTION_FAMILY, PREVIEW_FAMILY, QUALITY_FAMILY, SAVED_V_FAMILY } from "./system-families";
import type { DocumentModel } from "../collection-workspace";
import type { StudioOwnerActions, StudioOwnerId } from "../studio-application";
import type { StudioComposition } from "../trusted-authoring-core";

export type { StudioOwnerActions, StudioOwnerId };

/** Registration order is catalogue order: the golden registry snapshot pins it. */
export const STUDIO_OWNERS = [HISTORY_FAMILY, EYE_MAKEUP, COLLECTION_FAMILY, PREVIEW_FAMILY, MOTION_FAMILY,
  QUALITY_FAMILY, SAVED_V_FAMILY] as const;

// Compile-time: the list's IDs are exactly the owners StudioApplication binds handlers for.
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
/** The document model the collection, library and workspace code is given. */
export const STUDIO_DOCUMENTS: DocumentModel = Object.freeze({ parts: STUDIO_PARTS, live: LIVE_FEATURE });
/** Everything the trusted core needs from the composition. */
export const STUDIO_COMPOSITION: StudioComposition = Object.freeze({ registry: STUDIO_REGISTRY, documents: STUDIO_DOCUMENTS });
export type { EyeMakeupAction, EyeMakeupEditor, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupMemory, EyeMakeupResult,
  EyeMakeupState } from "../features/eye-makeup";
