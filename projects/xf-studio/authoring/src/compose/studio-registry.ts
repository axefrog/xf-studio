import { createLayeredPreviewCapability } from "../preview/browser/layered-preview-capability";
import { layeredMaskBake } from "../preview/browser/layered-mask-bake";
import { makeupFiles, makeupCollectionExport } from "../app/authoring/makeup-files";
import femalePlate from "../legacy/eye-makeup/plate/eye-plate-recipe.json" with { type: "json" };
import malePlate from "../legacy/eye-makeup/plate/eye-plate-recipe-pma.json" with { type: "json" };
import type { EyePlateRecipe } from "../legacy/eye-makeup/plate/eye-plate-recipe";
import { createLayeredEditorAdapters } from "../preview/browser/layered-editor-adapters";
/**
 * The composition list (feature-module platform §4, §9): every system family and feature
 * module the Studio registers, in catalogue order, and the composition the roots inject from it.
 *
 * Only composition roots import this module (the browser startup, the server and desktop hosts,
 * tools and tests); every other module receives the registry, the part registry and the live
 * feature as arguments (CORE-29). Features bind from this registration; the compiler checks
 * the application's system-family handlers independently of the feature list.
 */
import { MAKEUP_APPLICATION } from "../app/authoring/makeup-application";
import { makeupAuthoring } from "../app/authoring/makeup-view";
import { layeredStarters } from "../app/starters/layered-starters";
import { loadLookWorkspace } from "../app/workspace/makeup-workspace";
import { Registry } from "../platform/core/registry";
import { PartRegistry } from "../platform/core/document";
import { EYE_MAKEUP, EYE_MAKEUP_ID, EYE_MAKEUP_REGION } from "../features/eye-makeup";
import { EXPRESSIONS } from "../features/expressions";
import { CHARACTER_CONTEXT_FAMILY, COLLECTION_FAMILY, EMPTY_CHOICES_FAMILY, FILES_FAMILY, HISTORY_FAMILY, LIBRARY_FAMILY, MOTION_FAMILY, PREVIEW_FAMILY, PRESETS_FAMILY, QUALITY_FAMILY,
  SAVED_V_FAMILY, SCENES_FAMILY, STARTERS_FAMILY, TABS_FAMILY, PANELS_FAMILY, TRANSITIONS_FAMILY, VIEWS_FAMILY } from "./system-families";
import { STUDIO_MODULE_REGISTRATION } from "./modules";
import type { DocumentModel } from "../app/workspace/collection-workspace";
import type { StudioOwnerActions, StudioOwnerId, StudioRequestOwnerId } from "../app/studio-application";
import type { StudioComposition } from "../app/trusted-authoring-core";

export type { StudioOwnerActions, StudioOwnerId };

/**
 * Registration order is catalogue order: the golden registry snapshot pins it. The asynchronous
 * families (library requests, file workflows) route by owner too, outside the synchronous table.
 */
export const STUDIO_OWNERS = [HISTORY_FAMILY, { ...EYE_MAKEUP, application: MAKEUP_APPLICATION, authoring: makeupAuthoring(EYE_MAKEUP_ID), files: makeupFiles(EYE_MAKEUP_ID),
  starters: layeredStarters(EYE_MAKEUP_REGION),
  workspace: { load: loadLookWorkspace },
  collectionExport: makeupCollectionExport(EYE_MAKEUP_ID), maskBake: layeredMaskBake(EYE_MAKEUP_REGION),
  editors: createLayeredEditorAdapters(EYE_MAKEUP_REGION), preview: createLayeredPreviewCapability(EYE_MAKEUP_REGION),
  previewPreparation: { plate: { female: femalePlate as EyePlateRecipe, male: malePlate as EyePlateRecipe } } }, COLLECTION_FAMILY, SCENES_FAMILY, TABS_FAMILY, PANELS_FAMILY, STARTERS_FAMILY, PREVIEW_FAMILY, MOTION_FAMILY, TRANSITIONS_FAMILY,
  QUALITY_FAMILY, SAVED_V_FAMILY, CHARACTER_CONTEXT_FAMILY, VIEWS_FAMILY, LIBRARY_FAMILY, FILES_FAMILY, EXPRESSIONS, PRESETS_FAMILY, EMPTY_CHOICES_FAMILY] as const;
/**
 * Every feature binds from registration, using pure specs by default. Eye makeup's temporary
 * application publication/facade adapter is contributed above, beside that same registration.
 */
type GenericFeatureIds = Extract<(typeof STUDIO_OWNERS)[number], { owner: "feature" }> ["id"];

// Compile-time: the list's IDs, apart from the generically bound features, are exactly the owners StudioApplication binds handlers for.
type ListedIds = Exclude<(typeof STUDIO_OWNERS)[number]["id"], GenericFeatureIds>;
type BoundIds = Exclude<StudioOwnerId, GenericFeatureIds> | StudioRequestOwnerId;
type Unlisted = { [K in BoundIds]: [Extract<ListedIds, K>] extends [never] ? K : never }[BoundIds];
const exact: [ListedIds] extends [BoundIds] ? [Unlisted] extends [never] ? true : false : false = true;
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
export const STUDIO_DOCUMENTS: DocumentModel & { readonly live: string } = Object.freeze({ parts: STUDIO_PARTS, live: LIVE_FEATURE });
/** The live feature's layered-makeup region: eye makeup's plate, mirror, fine-Glitter scope, textures and wording. */
export const LIVE_REGION = EYE_MAKEUP_REGION;
/** Everything the trusted core needs from the composition. */
export const STUDIO_COMPOSITION = Object.freeze({ registry: STUDIO_REGISTRY, documents: STUDIO_DOCUMENTS,
  region: LIVE_REGION, modules: STUDIO_MODULE_REGISTRATION }) satisfies StudioComposition;
export type { EyeMakeupAction, EyeMakeupEditor, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupMemory, EyeMakeupResult,
  EyeMakeupState } from "../features/eye-makeup";

/** Released product defaults contributed by the registered feature. */
export const STUDIO_PRODUCT = EYE_MAKEUP.product!;
