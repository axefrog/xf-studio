/** Transitional layered renderer adapter. The head owns only the returned lifecycle callbacks. */
import type { createBrowserPreviewDevice } from "../../legacy/eye-makeup/browser/browser-preview-device";
import type { LayeredMakeupSurface } from "../../engines/layered-makeup/render/makeup-stack";
import type { HeadPreviewWiring, HeadAttachmentPorts } from "./browser-head-attachment";
type Scene = Awaited<ReturnType<HeadAttachmentPorts["viewport"]["buildHead"]>>;
type Device = ReturnType<typeof createBrowserPreviewDevice>;
export type LayeredSurfaceWiring = {
  feature: string; surface(scene: Scene): LayeredMakeupSurface | undefined;
  preview: Pick<Device, "connectScene" | "disconnectScene" | "presentInitialLayers" | "fillScene" | "holdsCurrent" | "releaseScene">;
  edited?: boolean;
};
export function layeredPreviewWiring(wiring: LayeredSurfaceWiring): HeadPreviewWiring {
  return { feature: wiring.feature, edited: wiring.edited, bind(scene, viewport) {
    const surface = wiring.surface(scene);
    if (!surface) throw Error(`The ${wiring.feature} renderer is not composed.`);
    return {
      connect: () => { wiring.preview.connectScene(surface); }, disconnect: () => wiring.preview.disconnectScene(surface),
      present: () => wiring.preview.presentInitialLayers(), fill: () => wiring.preview.fillScene(surface),
      current: () => wiring.preview.holdsCurrent(surface), release: () => wiring.preview.releaseScene(surface),
      preparation: () => ({
        ...(wiring.edited && viewport.surfaceGuides ? { overlays: () => viewport.surfaceGuides!(scene) } : {}),
        ...(wiring.edited && viewport.surfaceSteps ? { work: () => viewport.surfaceSteps!(scene, surface.surface) } : {}),
      }),
    };
  } };
}
