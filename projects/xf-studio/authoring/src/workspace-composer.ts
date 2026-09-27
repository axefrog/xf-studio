import type { DocumentState } from "./authoring-document";
import type { MotionActions } from "./motion-actions";
import type { PreviewActions } from "./preview-actions";
import type { WorkspaceState } from "./workspace-state";
import { parseUIPreferences } from "./ui-preferences";

export type WorkspaceCapturePorts = {
  editor(): DocumentState;
  uvView(): WorkspaceState["uvView"];
  savedV(): WorkspaceState["savedV"];
  collections(): WorkspaceState["collections"];
  quality(): WorkspaceState["preview"]["textureSize"];
  preview(): ReturnType<PreviewActions["snapshot"]> | undefined;
  motion(): ReturnType<MotionActions["snapshot"]> | undefined;
  /**
   * The character context's stored form (character-context-actions.ts `stored`): undefined while the context isn't attached (the
   * workspace's is kept), null when nothing needs storing.
   */
  character?(): WorkspaceState["preview"]["character"] | null | undefined;
  uiPreferences?(): WorkspaceState["uiPreferences"];
  /** The view graph's stored form: undefined for the default one-view graph (whose state is the mirrored `preview`). */
  views?(): WorkspaceState["views"];
  previewSetup?(): WorkspaceState["previewSetup"];
};

/** Composes durable workspace state from typed ports; the dock layout arrives with the UI preferences. */
export class WorkspaceComposer {
  private previewReady = false;
  constructor(private initial: WorkspaceState, private ports: WorkspaceCapturePorts) {}
  setPreviewReady() { this.previewReady = true; }
  capture(): WorkspaceState {
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
    if (!this.previewReady) return structuredClone({ ...base, ...editing,
      preview: { ...this.initial.preview, textureSize: quality } });
    const config = this.ports.preview(), motion = this.ports.motion(), original = this.initial.preview;
    const preview: WorkspaceState["preview"] = { ...original, ...config, textureSize: quality,
      blink: motion?.blink ?? original.blink, blinkPlaying: motion?.blinkPlaying ?? original.blinkPlaying,
      idle: motion?.idle ?? original.idle, idleTime: motion?.idleTime ?? original.idleTime,
      idlePaused: motion?.idlePaused ?? original.idlePaused,
      idleBody: motion?.idleBody ?? original.idleBody, idleFace: motion?.idleFace ?? original.idleFace };
    // The chosen idle is stored only when it isn't the default (the close-up), so a workspace that never chooses keeps its bytes.
    const idleClip = motion ? motion.idleClip : original.idleClip;
    delete preview.idleClip;
    if (idleClip && idleClip !== "closeup") preview.idleClip = idleClip;
    // The held pose is view state: stored only while one is the body source.
    const pose = motion ? motion.pose : original.pose;
    delete preview.pose;
    if (pose) preview.pose = { id: pose.id, label: pose.label };
    // The context owns every creator choice (CORE-58) and is stored only when something was set. The retired tried piercing style is
    // written back as read until the context stores choices (it migrates the style into them once its catalogue is ready, CORE-74);
    // then it is written empty.
    const character = this.ports.character?.();
    if (character !== undefined) {
      if (character) { preview.character = character; preview.piercingStyle = ""; preview.piercingDefinition = ""; } else delete preview.character;
    }
    return structuredClone({ ...base, ...editing, preview });
  }
}
