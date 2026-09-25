/**
 * Localhost entry for the XF Studio page: the shared composition root with browser storage and
 * the local server's 3D preview preparation. The desktop bootstrap starts the same root with its
 * own host services instead of loading this entry.
 */
import { LOCALHOST_SETUP_PLACE } from "./alpha-availability";
import { createBrowserPreviewPreparation } from "./preview-preparation";
import { startStudio } from "./studio-startup";
import { createBrowserWolvenKitSetup } from "./wolvenkit-setup";

void startStudio({
  storage: localStorage,
  previewPreparation: createBrowserPreviewPreparation("/api/preview-core"),
  wolvenKitSetup: createBrowserWolvenKitSetup("/api/wolvenkit"),
  setupPlace: LOCALHOST_SETUP_PLACE,
});
