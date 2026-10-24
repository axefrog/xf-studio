import type { DesktopAppActions } from "../setup/desktop-app";
import type { UpdateCheckActions } from "../setup/update-check-actions";
import { CollectionApplication } from "../library/collection-application";
import type { AuthoringPreviewCoordinator } from "../legacy/eye-makeup/preview/authoring-preview-coordinator";
import type { CollectionServiceDeps } from "../library/collection-service";
import type { SavedAppearanceState } from "../character/saved-appearance-actions";
import type { SavedV } from "../saves/save-reader";
import { StudioFileOperations, type StudioFilePort } from "./studio-file-operations";
import { createStudioPresentation, type ProjectLinkPort, type StudioPresentationPort } from "./studio-presentation";
import type { PresentationStatusSource } from "./presentation-status";
import type { createTrustedAuthoringCore } from "./trusted-authoring-core";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";
import { buildToolsChecking, type LocalSetupActions } from "../setup/local-setup-actions";
import type { InstallDetectionActions } from "../installation/install-detection-actions";
import type { ModInstallActions } from "../installation/mod-install-actions";
import type { PreviewSetupActions } from "../preview/preview-setup";
import type { DiagnosticsActions } from "../diagnostics/actions";
import type { ModuleService } from "../platform/api";

type Core = ReturnType<typeof createTrustedAuthoringCore>;

/** Compose trusted services before mounting any presentation. No page control IDs are read here. */
export function createTrustedStudioBootstrap<Slot>(options: {
  core: Core;
  preferences: UIPreferenceActions;
  viewport: ViewportAttachment<Slot>;
  previewReadiness: Pick<AuthoringPreviewCoordinator, "readiness" | "subscribe">;
  fileDevice: StudioFilePort;
  /**
   * The collection service's owners and ports (profiles design §7): the collection owner, the scene whose look it works on, the released
   * library and package routes, and the look editor's write.
   */
  collections: Omit<CollectionServiceDeps, "readRecipe" | "model">;
  /** Optional device status (autosave, asset diagnostics) exposed read-only to the view. */
  status?: Pick<PresentationStatusSource, "snapshot" | "subscribe">;
  localSetup?: LocalSetupActions;
  installDetection?: InstallDetectionActions;
  /** "Add to my mod manager" after Build (UI-82). */
  modInstall?: ModInstallActions;
  /** The 3D preview setup service the presentation drives (card, consent, head pane). */
  previewSetup?: PreviewSetupActions;
  /** "Get the desktop app" (localhost only). */
  desktopApp?: DesktopAppActions;
  /** Checking for a newer XF Studio, through the host. */
  updates?: UpdateCheckActions;
  /** Opens XF Studio's own public pages for the Help view. */
  links?: ProjectLinkPort;
  /** The host's About view (the desktop app's). */
  about?: () => void;
  /** Problem reports, diagnostic mode and error references (docs/diagnostics.md). */
  diagnostics?: DiagnosticsActions;
  /** The modules' services (`compose/module-services.ts`), as facades. */
  modules?: readonly ModuleService[];
  experiments?: import("../platform/api/experiments").ExperimentPort;
  /** The page's workspace lease (profiles design §2.3); without it this page is the only one. */
  lease?: import("./workspace/workspace-lease").WorkspaceLease;
  /** The page's outbox (profiles design §2.2). */
  outbox?: import("../platform/core/document-outbox").DocumentOutbox;
  /** A panel's instance in the tab shown (the profile session's). */
  panelInstance?: (panel: string) => string;
  tabs?: import("./profiles/tab-presentation").LayoutTabsPort;
  /** The input layer's target resolution and the session's focus (profiles design §3.3, §3.6): what the presentation's actions name. */
  targets?: import("./profiles/targets").TargetResolver;
  focus?: Pick<import("../platform/core/focus").FocusService, "focusView" | "focusPanel">;
  /** A history scope's name for people (the editing context Undo names). */
  scopeName?: (scope: string) => string | undefined;
  characterName?: (character: string) => string | undefined;
  onRecipeImported(): void;
  savedAppearance: {
    has(): boolean;
    read(): SavedV | undefined;
    /** Show a save's V on `character` (the V the request named when it was asked). */
    load(bytes: Uint8Array, character: string): Readonly<SavedAppearanceState>;
    /** Whether a save can be shown on `character` now (a 3D view shows that V). */
    ready(character: string): boolean;
    unavailableReason?(): string | undefined;
  };
}) {
  const { core } = options;
  let collection: CollectionApplication;
  const files = new StudioFileOperations(options.fileDevice, {
    recipe: () => core.presentation.recipe(), selectedLayer: () => core.presentation.layer(),
    importRecipe: (recipe, name, into) => {
      collection.importRecipe(recipe, name, into);
      options.onRecipeImported();
    },
    hasSavedV: options.savedAppearance.has, savedV: options.savedAppearance.read,
    loadSavedV: (bytes, character) => {
      const applied = options.savedAppearance.load(bytes, character);
      core.app.recordAppliedSavedAppearance(applied);
      return applied;
    },
    savedVReady: options.savedAppearance.ready,
    savedVUnavailableReason: options.savedAppearance.unavailableReason,
    characterPreset: {
      unavailable: kind => core.app.characterPresetUnavailable(kind),
      // The V the request named when it was asked (profiles design §3.3).
      load: (value, character) => {
        const result = core.app.dispatch({ kind: "character.setSource", character, source: { kind: "preset", value } });
        if (!result.ok) throw Error(result.message);
      },
      save: () => core.app.characterPresetFile(),
    },
    executeCollection: request => core.app.execute(request),
    recoverCollection: draft => collection.recover(draft),
    buildReadiness: options.localSetup && (() => {
      const setup = options.localSetup!.snapshot();
      if (!setup.view) return setup.error ? "needs-setup" : "loading";
      if (setup.view.source === "backup") return "damaged";
      return setup.view.readiness.build.ready ? "ready" : buildToolsChecking(setup.view) ? "checking" : "needs-setup";
    }),
  });
  collection = new CollectionApplication({ ...options.collections, model: core.documents }, core.document, core.app, files);
  const port = createStudioPresentation({ authoring: core.app, library: collection,
    files, viewport: options.viewport, preferences: options.preferences,
    previewReadiness: options.previewReadiness, editor: core.presentation, status: options.status,
    localSetup: options.localSetup, installDetection: options.installDetection, modInstall: options.modInstall, previewSetup: options.previewSetup,
    desktopApp: options.desktopApp, updates: options.updates, links: options.links, about: options.about, diagnostics: options.diagnostics, modules: options.modules, experiments: options.experiments,
    workspace: options.lease, outbox: options.outbox, ...(options.panelInstance ? { panelInstance: options.panelInstance } : {}),
    ...(options.targets ? { targets: options.targets } : {}), ...(options.focus ? { focus: options.focus } : {}),
    ...(options.scopeName ? { scopeName: options.scopeName } : {}),
    ...(options.characterName ? { characterName: options.characterName } : {}), ...(options.tabs ? { tabs: options.tabs } : {}) });
  return {
    /** Trusted handles are retained by the composition root; never pass this object to a UI. */
    files, collection,
    mount<T>(mountPresentation: (presentation: StudioPresentationPort<Slot>) => T): T {
      return mountPresentation(port);
    },
  };
}
