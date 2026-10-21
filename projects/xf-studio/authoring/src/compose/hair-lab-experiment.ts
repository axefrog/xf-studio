/** The only entry point imported by the generic experiment loader, and only while opted in. */
import type { ExperimentContext } from "../platform/api/experiment-context";
import { createHairLab, HAIR_GROOM_KIND } from "../features/hair-lab/service";
import type { Groom } from "../features/hair-lab/types";
import { hairRenderer } from "../features/hair-lab/render";
import { workerGeneration } from "../features/hair-lab/render/worker-device";
import { HAIR_VIEW, HAIR_VIEW_BINDING } from "../features/hair-lab/view";
export async function create(context: ExperimentContext, options: { shape?: string } = {}) {
  const grooms = await context.loadDocuments<Groom>(HAIR_GROOM_KIND, context.signal);
  context.signal.throwIfAborted();
  const lab = createHairLab(context, workerGeneration(context.signal, options), grooms);
  return { module: { id: "hair-lab", label: "Hair Lab", icon: "character", group: "character", stage: "dev", shownByDefault: true,
    description: "Try a generated hairstyle on V." } as const, service: lab.facade, renderer: hairRenderer(lab, context.signal),
    histories: () => lab.histories(), actionHints: () => lab.actionHints(),
    visibility(shown: boolean) { if (!shown) lab.withdraw(); }, contribution: HAIR_VIEW, binding: HAIR_VIEW_BINDING };
}
