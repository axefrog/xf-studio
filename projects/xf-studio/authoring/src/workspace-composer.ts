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
  sidebar(): Pick<WorkspaceState["panels"], "sidebarLeft" | "sidebarRight">;
  layout(): WorkspaceState["panels"];
  uiPreferences?(): WorkspaceState["uiPreferences"];
};

/** Composes durable workspace state from typed ports; presentation supplies layout only. */
export class WorkspaceComposer {
  private previewReady = false;
  constructor(private initial: WorkspaceState, private ports: WorkspaceCapturePorts) {}
  setPreviewReady() { this.previewReady = true; }
  capture(): WorkspaceState {
    const editing = { ...this.ports.editor(), uvView: this.ports.uvView(),
      savedV: this.ports.savedV(), glitterChoices: this.initial.glitterChoices,
      library: this.initial.library, collections: this.ports.collections(),
      uiPreferences: parseUIPreferences(this.ports.uiPreferences?.() ?? this.initial.uiPreferences) };
    const quality = this.ports.quality();
    if (!this.previewReady) return structuredClone({ ...this.initial, ...editing,
      preview: { ...this.initial.preview, textureSize: quality },
      panels: { ...this.initial.panels, ...this.ports.sidebar(),
        previewQuality: this.ports.layout().previewQuality } });
    const config = this.ports.preview(), motion = this.ports.motion(), original = this.initial.preview;
    const preview: WorkspaceState["preview"] = { ...original, ...config, textureSize: quality,
      blink: motion?.blink ?? original.blink, blinkPlaying: motion?.blinkPlaying ?? original.blinkPlaying,
      idle: motion?.idle ?? original.idle, idleTime: motion?.idleTime ?? original.idleTime,
      idlePaused: motion?.idlePaused ?? original.idlePaused,
      idleBody: motion?.idleBody ?? original.idleBody, idleFace: motion?.idleFace ?? original.idleFace };
    return structuredClone({ ...this.initial, ...editing, preview, panels: this.ports.layout() });
  }
}
