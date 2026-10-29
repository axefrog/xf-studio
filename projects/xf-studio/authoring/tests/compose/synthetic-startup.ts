/** Only this test composition integrates the synthetic feature. It starts the real product root. */
import { EMPTY_STARTUP_COMPOSITION, type StudioStartupComposition } from "../../src/compose/startup-composition";
import { Registry, type AnyOwner } from "../../src/platform/core/registry";
import { PartRegistry } from "../../src/platform/core/document";
import { viewCatalogue } from "../../src/studio-ui/views/contribution";
import { SYNTHETIC, ID } from "../features/synthetic-layers";
import { BINDING, VIEW } from "../features/synthetic-layers/view";
import { startStudio } from "../../src/compose/studio-startup";
import { createBrowserPreviewPreparation } from "../../src/preview/preview-preparation";
import { createBrowserWolvenKitSetup } from "../../src/setup/wolvenkit-setup";
import { startBrowserWorkspaceLease } from "../../src/app/browser/workspace-lease-device";
import { browserPage, startDocumentOutbox } from "../../src/app/browser/document-outbox-device";
import { localOutboxStorage } from "../../src/app/browser/outbox-storage";
import { immutableDocumentKind } from "../../src/compose/document-kinds";
import { LOCALHOST_SETUP_PLACE } from "../../src/app/alpha-availability";

export const COMPOSITION: StudioStartupComposition = {
  ...EMPTY_STARTUP_COMPOSITION,
  registry: new Registry<AnyOwner>([...EMPTY_STARTUP_COMPOSITION.registry.owners(), SYNTHETIC as AnyOwner]),
  documents: { parts: new PartRegistry([SYNTHETIC]), live: ID },
  modules: { ...EMPTY_STARTUP_COMPOSITION.modules, modules: [{ id: ID, feature: ID, label: "Closure layers", icon: "layers",
    stage: "dev", group: "tools", shownByDefault: true, description: "Test-only layered editor." }] },
  views: [...EMPTY_STARTUP_COMPOSITION.views, VIEW],
  view: { ...EMPTY_STARTUP_COMPOSITION.view, catalogue: viewCatalogue([...EMPTY_STARTUP_COMPOSITION.views, VIEW]), features: [BINDING] },
};
/** Localhost host adapters, isolated by their normal verification path; no alternate bootstrap or makeup facade. */
export async function startSyntheticStudio() {
  if (new URLSearchParams(location.search).get("verify") !== "1") throw Error("Synthetic startup requires ?verify=1.");
  const lease = await startBrowserWorkspaceLease({ verification: true });
  const documents = startDocumentOutbox({ prefix: "/api/verification/documents", send: fetch, workspace: lease.workspace,
    storage: localOutboxStorage(localStorage, lease.workspace), immutable: immutableDocumentKind, lease: lease.lease, page: browserPage() });
  return startStudio({ storage: localStorage, lease: lease.lease, documents,
    previewPreparation: createBrowserPreviewPreparation("/api/preview-core"), wolvenKitSetup: createBrowserWolvenKitSetup("/api/wolvenkit"),
    setupPlace: LOCALHOST_SETUP_PLACE }, { composition: COMPOSITION });
}
if (typeof location !== "undefined" && new URLSearchParams(location.search).get("composition") === "synthetic") void startSyntheticStudio();
