/** Browser preview contribution on the existing registered owner; no fallback feature or worker. */
import type { createBrowserPreviewDevice } from "../../legacy/eye-makeup/browser/browser-preview-device";
import type { GlitterPreviewMeasurement } from "../../app/presentation-status";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
type Core = ReturnType<typeof createTrustedAuthoringCore>;
type Device = ReturnType<typeof createBrowserPreviewDevice>;
export type BrowserPreviewOptions = Omit<Parameters<typeof createBrowserPreviewDevice>[0], "document" | "region" | "measurement" | "makeWorker"> & {
  signal: AbortSignal; makeWorker?: Parameters<typeof createBrowserPreviewDevice>[0]["makeWorker"];
  changed(): void;
};
export type BrowserPreview = Device & { readonly feature: string; start(): void; measurements(): GlitterPreviewMeasurement[] };
export type BrowserPreviewCapability = { create(state: unknown, options: BrowserPreviewOptions): BrowserPreview };
export function createRegisteredPreview(core: Pick<Core, "app" | "documents">, options: BrowserPreviewOptions): BrowserPreview | undefined {
  options.signal.throwIfAborted();
  const owner = core.app.actionRegistry().owner(core.documents.live);
  return owner?.owner === "feature" ? (owner as typeof owner & { preview?: BrowserPreviewCapability }).preview?.create(core, options) : undefined;
}
/** Readiness when no feature contributes generated textures. Creates no raster scheduler, worker or feature state. */
export function noGeneratedPreview(size: BrowserPreviewOptions["initialSize"]) {
  return { readiness: () => ({ phase: "ready" as const, size, pending: 0, waiting: false, estimatedBytes: 0, layers: [] }),
    subscribe: (_listener: () => void) => () => {} };
}
