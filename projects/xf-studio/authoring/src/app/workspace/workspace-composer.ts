import type { DocumentState } from "../authoring/authoring-document";
import type { PreviewActions } from "../../preview/preview-actions";
import type { WorkspaceState } from "./workspace-state";
import { parseUIPreferences } from "../ui-preferences";

export type WorkspaceCapturePorts = {
  editor(): DocumentState;
  uvView(): WorkspaceState["uvView"];
  savedV(): WorkspaceState["savedV"];
  collections(): WorkspaceState["collections"];
  quality(): WorkspaceState["preview"]["textureSize"];
  preview(): ReturnType<PreviewActions["snapshot"]> | undefined;
  /**
   * The character context's stored form (character-context-actions.ts `stored`): undefined while the context isn't attached (the
   * workspace's is kept), null when nothing needs storing.
   */
  character?(): WorkspaceState["preview"]["character"] | null | undefined;
  uiPreferences?(): WorkspaceState["uiPreferences"];
  /** The view graph's stored form: undefined for the default one-view graph (whose state is the mirrored `preview`). */
  views?(): WorkspaceState["views"];
  previewSetup?(): WorkspaceState["previewSetup"];
  /**
   * How held expressions' changes animate (platform/core/transition-settings.ts `stored`): undefined while every source has the default,
   * so a workspace that never changes it keeps its bytes. Stored whether or not the 3D preview is ready (it is set before the head loads).
   */
  transitions?(): WorkspaceState["preview"]["transitions"];
  /**
   * Read live device state that moves without any change into its owners before anything is captured (the shown head's idle phase into its
   * scene node, `MotionActions.sample`); records and publishes nothing.
   */
  sample?(): void;
  /** The profiles migration's mark and the sessions it built (profiles design §8), as the migration holds them now. */
  profiles?(): Pick<WorkspaceState, "migration" | "profiles">;
};

/**
 * Composes durable workspace state from typed ports; the dock layout arrives with the UI preferences. The `preview` block's motion fields
 * (idle, blink, the idle played, the pose) are written back as they were read: the motion lives in the view graph's scene nodes
 * (animation/scene-motion.ts), stored with the profile session, so those fields only keep what a build before the move reads.
 */
export class WorkspaceComposer {
  private previewReady = false;
  constructor(private initial: WorkspaceState, private ports: WorkspaceCapturePorts) {}
  setPreviewReady() { this.previewReady = true; }
  capture(): WorkspaceState {
    this.ports.sample?.();
    const editing = { ...this.ports.editor(), uvView: this.ports.uvView(),
      savedV: this.ports.savedV(), glitterChoices: this.initial.glitterChoices,
      library: this.initial.library, collections: this.ports.collections(),
      uiPreferences: parseUIPreferences(this.ports.uiPreferences?.() ?? this.initial.uiPreferences),
      ...(this.ports.previewSetup ? { previewSetup: this.ports.previewSetup() } : {}) };
    const quality = this.ports.quality();
    if (this.ports.views) {
      const views = this.ports.views();
      if (views) (editing as Partial<WorkspaceState>).views = views;
    }
    const base: WorkspaceState = { ...this.initial };
    if (this.ports.views) delete base.views;
    if (this.ports.profiles) {
      const { migration, profiles } = this.ports.profiles();
      delete base.migration; delete base.profiles;
      if (migration) base.migration = migration;
      if (profiles) base.profiles = profiles;
    }
    if (!this.previewReady) return structuredClone({ ...base, ...editing,
      preview: this.withTransitions({ ...this.initial.preview, textureSize: quality }) });
    const config = this.ports.preview(), original = this.initial.preview;
    const preview: WorkspaceState["preview"] = { ...original, ...config, textureSize: quality };
    // The person's own lighting setups are stored only while there are any (the preview's mirror has them then).
    if (config) { delete preview.lightingSetups; if (config.lightingSetups) preview.lightingSetups = config.lightingSetups; }
    // The context owns every creator choice (CORE-58) and is stored only when something was set. The retired tried piercing style is
    // written back as read until the context stores choices (it migrates the style into them once its catalogue is ready, CORE-74);
    // then it is written empty.
    const character = this.ports.character?.();
    if (character !== undefined) {
      if (character) { preview.character = character; preview.piercingStyle = ""; preview.piercingDefinition = ""; } else delete preview.character;
    }
    return structuredClone({ ...base, ...editing, preview: this.withTransitions(preview) });
  }
  private withTransitions(preview: WorkspaceState["preview"]): WorkspaceState["preview"] {
    if (!this.ports.transitions) return preview;
    const transitions = this.ports.transitions();
    const { transitions: _stored, ...rest } = preview;
    return transitions ? { ...rest, transitions } : rest;
  }
}
