/**
 * Poses (research/animation/pose-library-design.md P3): a Studio module without a document part. Its pure core is the tree (library.ts)
 * and the per-user preferences (preferences.ts), its application service `actions.ts`; `view/` is its panel and `host/` the preferences
 * store both hosts mount. Playing a pose is the motion service's body source (motion-actions.ts `holdPose`) on the scene's idle rig.
 */
export { POSES_MODULE } from "./module";
export { POSE_LIBRARY_DESCRIPTORS, PoseLibraryActions, type PoseCatalogueView, type PoseLibraryAction, type PoseLibraryDevice, type PoseLibraryOutcome,
  type PoseLibraryState, type PoseMotionPort, type PoseStage } from "./actions";
export { buildPoseTree, foldText, NOT_INSTALLED, searchWords, type PoseGroup, type PoseRow, type PoseTree } from "./library";
export { defaultPosePreferences, FAVOURITES_GROUP, parsePosePreferences, POSE_PREFERENCES_SCHEMA, RECENT_GROUP, type PosePreferences } from "./preferences";
export { poseLibraryFacade, type PoseLibraryFacade } from "./facade";
