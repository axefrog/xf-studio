import { CollectionApplication } from "./collection-application";
import type { AuthoringPreviewCoordinator } from "./authoring-preview-coordinator";
import type { CollectionTransport } from "./collection-service";
import type { SavedAppearanceState } from "./saved-appearance-actions";
import type { SavedV } from "./save-reader";
import { StudioFileOperations, type StudioFilePort } from "./studio-file-operations";
import { createStudioPresentation, type StudioPresentationPort } from "./studio-presentation";
import type { PresentationStatusSource } from "./presentation-status";
import type { createTrustedAuthoringCore } from "./trusted-authoring-core";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";
import type { WorkspaceState } from "./workspace-state";
import type { LocalSetupActions } from "./local-setup-actions";

type Core = ReturnType<typeof createTrustedAuthoringCore>;

/** Compose trusted services before mounting any presentation. No legacy control IDs are read here. */
export function createTrustedStudioBootstrap<Slot>(options: {
  workspace: WorkspaceState;
  core: Core;
  preferences: UIPreferenceActions;
  viewport: ViewportAttachment<Slot>;
  previewReadiness: Pick<AuthoringPreviewCoordinator, "readiness" | "subscribe">;
  fileDevice: StudioFilePort;
  transport: CollectionTransport;
  onEditorRestored(): void;
  /** Optional device status (autosave, asset diagnostics) exposed read-only to the view. */
  status?: Pick<PresentationStatusSource, "snapshot" | "subscribe">;
  localSetup?: LocalSetupActions;
  onRecipeImported(): void;
  savedAppearance: {
    has(): boolean;
    read(): SavedV | undefined;
    load(bytes: Uint8Array): Readonly<SavedAppearanceState>;
    ready(): boolean;
    unavailableReason?(): string | undefined;
  };
}) {
  const { workspace, core } = options;
  let collection: CollectionApplication;
  const files = new StudioFileOperations(options.fileDevice, {
    recipe: () => core.presentation.recipe(), selectedLayer: () => core.presentation.layer(),
    importRecipe: (recipe, name) => {
      collection.importRecipe(recipe, name);
      options.onRecipeImported();
    },
    hasSavedV: options.savedAppearance.has, savedV: options.savedAppearance.read,
    loadSavedV: bytes => {
      const applied = options.savedAppearance.load(bytes);
      core.app.recordAppliedSavedAppearance(applied);
      return applied;
    },
    savedVReady: options.savedAppearance.ready,
    savedVUnavailableReason: options.savedAppearance.unavailableReason,
    executeCollection: request => core.app.execute(request),
    recoverCollection: () => collection.recover(),
    buildReadiness: options.localSetup && (() => {
      const setup = options.localSetup!.snapshot();
      if (!setup.view) return setup.error ? "needs-setup" : "loading";
      if (setup.view.source === "backup") return "damaged";
      return setup.view.readiness.build.ready ? "ready" : "needs-setup";
    }),
  });
  collection = new CollectionApplication(workspace.collections, workspace.library,
    core.document, options.onEditorRestored, options.transport, core.app, files);
  const port = createStudioPresentation({ authoring: core.app, library: collection,
    files, viewport: options.viewport, preferences: options.preferences,
    previewReadiness: options.previewReadiness, editor: core.presentation, status: options.status,
    localSetup: options.localSetup });
  return {
    /** Trusted handles are retained by the composition root; never pass this object to a UI. */
    files, collection,
    mount<T>(mountPresentation: (presentation: StudioPresentationPort<Slot>) => T): T {
      return mountPresentation(port);
    },
  };
}
