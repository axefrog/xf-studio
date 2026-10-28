import type { DocumentState as MakeupDocumentState } from "../authoring/makeup-document";
import type { DocumentState as NeutralDocumentState } from "../authoring/authoring-document";
import type { PreviewActions } from "../../preview/preview-actions";
import type { WorkspaceState as MakeupWorkspace } from "./makeup-workspace";
import type { WorkspaceState as NeutralWorkspace } from "./workspace-state";
export type WorkspaceInput = NeutralWorkspace | MakeupWorkspace;
import { parseUIPreferences } from "../ui-preferences";

export type WorkspaceCapturePorts<W extends WorkspaceInput = MakeupWorkspace> = {
  editor(): W extends MakeupWorkspace ? MakeupDocumentState : NeutralDocumentState;
  uvView(): W["uvView"];
  savedV(): W["savedV"];
  collections(): W["collections"];
  quality(): W["preview"]["textureSize"];
  preview(): ReturnType<PreviewActions["snapshot"]> | undefined;
  /**
   * The character context's stored form (character-context-actions.ts `stored`): undefined while the context isn't attached (the
   * workspace's is kept), null when nothing needs storing.
   */
  character?(): W["preview"]["character"] | null | undefined;
  uiPreferences?(): W["uiPreferences"];
  /** The view graph's stored form: undefined for the default one-view graph (whose state is the mirrored `preview`). */
  views?(): W["views"];
  previewSetup?(): W["previewSetup"];
  /**
   * How held expressions' changes animate (platform/core/transition-settings.ts `stored`): undefined while every source has the default,
   * so a workspace that never changes it keeps its bytes. Stored whether or not the 3D preview is ready (it is set before the head loads).
   */
  transitions?(): W["preview"]["transitions"];
  /**
   * Read live device state that moves without any change into its owners before anything is captured (the shown head's idle phase into its
   * scene node, `MotionActions.sample`); records and publishes nothing.
   */
  sample?(): void;
  /** The profiles migration's mark and the sessions it built (profiles design §8), as the migration holds them now. */
  profiles?(): Pick<W, "migration" | "profiles">;
};

/**
 * Composes durable workspace state from typed ports; the dock layout arrives with the UI preferences. The `preview` block's motion fields
 * (idle, blink, the idle played, the pose) are written back as they were read: the motion lives in the view graph's scene nodes
 * (animation/scene-motion.ts), stored with the profile session, so those fields only keep what a build before the move reads.
 */
export class WorkspaceComposer<W extends WorkspaceInput = MakeupWorkspace> {
  private previewReady = false;
  constructor(private initial: W, private ports: WorkspaceCapturePorts<W>) {}
  setPreviewReady() { this.previewReady = true; }
  capture(): W {
    this.ports.sample?.();
    const document = this.ports.editor();
    const editor = "recipe" in document ? document : {
      history: document.history ?? this.initial.history, liveFeatures: document.features, liveLocked: document.locked,
    };
    const views = this.ports.views?.();
    const editing = { ...editor, uvView: this.ports.uvView(),
      ...(views ? { views } : {}),
      savedV: this.ports.savedV(), ...("glitterChoices" in this.initial ? { glitterChoices: this.initial.glitterChoices } : {}),
      library: this.initial.library, collections: this.ports.collections(),
      uiPreferences: parseUIPreferences(this.ports.uiPreferences?.() ?? this.initial.uiPreferences),
      ...(this.ports.previewSetup ? { previewSetup: this.ports.previewSetup() } : {}) };
    const quality = this.ports.quality();
    const base: W = { ...this.initial };
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
    const preview: W["preview"] = { ...original, ...config, textureSize: quality };
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
  private withTransitions(preview: W["preview"]): W["preview"] {
    if (!this.ports.transitions) return preview;
    const transitions = this.ports.transitions();
    const { transitions: _stored, ...rest } = preview;
    return transitions ? { ...rest, transitions } : rest;
  }
}
