import type { EyeMakeupFacade } from "../../../../app/studio-presentation";
import type { GuidanceContribution } from "../../../../studio-ui/guidance/contributions";
import { toursFor, ONBOARDING_TOUR_ID } from "../../../../studio-ui/guidance/tours";
import { helpTopicsFor, helpReference } from "../../../../studio-ui/guidance/help-topics";
import { MAKEUP_ANCHORS } from "./anchors";

export const MAKEUP_GUIDANCE: GuidanceContribution = {
  anchors: MAKEUP_ANCHORS,
  create(input) {
    const facade = input as EyeMakeupFacade, view = () => facade.view();
    const finishes = facade.finishCatalogue();
    return { tours: toursFor(finishes), topics: helpTopicsFor(finishes), reference: helpReference(), onboarding: { tour: ONBOARDING_TOUR_ID, offer: { eyebrow: "Welcome", title: "New to XF Studio?",
    body: "A short tour shows where everything is: layers, drawing, the 3D view, colour and finish, your library and making your mod. It takes about two minutes, and you can replay it from Help.\n\nXF Studio is in beta. If something doesn't work, **Report a problem…** in Help prepares a report for you to review; nothing is sent by itself." } },
      editing: {
        facts() { const layer = view().layer(); return { layers: view().recipe().layers.length,
          activeLayer: layer?.id ?? null, finish: layer?.finish ?? null, color: layer?.color ?? null }; },
        layer: () => view().layer(), layerIds: () => view().recipe().layers.map(layer => layer.id),
        canCapture() { const layer = view().layer(); return !!layer && facade.capability({ kind: "layer.setEnabled", id: layer.id, enabled: layer.enabled }).available; },
      } };
  },
};
