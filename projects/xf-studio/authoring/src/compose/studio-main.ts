/**
 * Localhost entry for the XF Studio page: the shared composition root with browser storage and
 * the local server's 3D preview preparation. The desktop bootstrap starts the same root with its
 * own host services instead of loading this entry.
 */
import { LOCALHOST_SETUP_PLACE } from "../app/alpha-availability";
import { createBrowserPreviewPreparation } from "../preview/preview-preparation";
import { startStudio } from "./studio-startup";
import { selectStartupComposition } from "./startup-composition";
import { createBrowserDesktopApp } from "../setup/browser/browser-desktop-app-device";
import { createBrowserWolvenKitSetup } from "../setup/wolvenkit-setup";
import { browserExperiments } from "./experiments";
import { startBrowserWorkspaceLease } from "../app/browser/workspace-lease-device";
import { browserPage, startDocumentOutbox } from "../app/browser/document-outbox-device";
import { localOutboxStorage } from "../app/browser/outbox-storage";
import { immutableDocumentKind } from "./document-kinds";

const verification = new URLSearchParams(location.search).has("verify");
const composition = selectStartupComposition(location.search);
// One writer per workspace (profiles design §2.3): the lease is settled before the Studio builds anything, so a second tab opens read-only.
const workspaceLease = await startBrowserWorkspaceLease({ verification });
// The outbox (§2.2): the one way documents reach the library, kept in this browser's storage under the workspace's identity.
const workspace = workspaceLease.workspace;
const documents = startDocumentOutbox({ prefix: `${verification ? "/api/verification" : "/api"}/documents`, send: fetch, workspace,
  storage: localOutboxStorage(localStorage, workspace), immutable: immutableDocumentKind, lease: workspaceLease.lease, page: browserPage() });
void startStudio({
  storage: localStorage,
  lease: workspaceLease.lease,
  documents,
  experiments: (verify, signal) => browserExperiments(location.search, signal, verify, documents),
  previewPreparation: createBrowserPreviewPreparation("/api/preview-core"),
  wolvenKitSetup: createBrowserWolvenKitSetup("/api/wolvenkit"),
  setupPlace: LOCALHOST_SETUP_PLACE,
  // Localhost-only: offer the desktop app (a verification workspace checks it too, but never starts anything).
  desktopApp: createBrowserDesktopApp(verification ? "/api/verification/desktop-app" : "/api/desktop-app"),
}, { composition });
