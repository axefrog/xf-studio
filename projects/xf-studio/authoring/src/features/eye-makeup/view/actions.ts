import type { EyeMakeupAction } from "../../../eye-makeup-model";
import type { EyeMakeupFacade } from "../../../studio-presentation";
import type { FeatureViewContext } from "../../../studio-ui/views/feature-view";

/**
 * What eye makeup's view receives from the shell: a context over eye makeup's facade only (UI-52, UI-73).
 * Its dispatches, capabilities, limits and choices are the facade's, which refuses any other owner's kind;
 * feedback is the shell's, exactly as for any other dispatch. A platform action the view offers (adding a
 * preset, Undo) goes through the context's `platform`, which refuses a feature's kinds.
 */
export type EyeMakeupViewContext = FeatureViewContext<EyeMakeupFacade>;

/** Add a layer at the front of the selected preset (a fresh action each time). */
export const addLayer = (): EyeMakeupAction => ({ kind: "layer.edit", command: { kind: "add" } });
/** Layer creation; refused (with a reason) while no preset owns the editor. */
export const addLayerCapability = (ctx: EyeMakeupViewContext) => ctx.facade.capability(addLayer());

type Catalogues = {
  readonly finishes: ReturnType<EyeMakeupFacade["finishCatalogue"]>;
  readonly glitterModels: ReturnType<EyeMakeupFacade["glitterModelCatalogue"]>;
  /** The catalogue's finish a layer's stored finish name means (its ID, or a stored alias such as older recipes' `satin`). */
  finishOf(finish: string): ReturnType<EyeMakeupFacade["finishCatalogue"]>[number] | undefined;
  /** The Glitter model a layer's stored flakes are, by the catalogue's stored names (classic flakes name none; UI-10). */
  glitterModelOf(flakes: unknown): ReturnType<EyeMakeupFacade["glitterModelCatalogue"]>[number];
};
const read = new WeakMap<EyeMakeupViewContext, Catalogues>();
/** Eye makeup's static catalogues (finishes, Glitter models), read from its facade once per context. */
export function catalogues(ctx: EyeMakeupViewContext): Catalogues {
  let entry = read.get(ctx);
  if (!entry) {
    const finishes = ctx.facade.finishCatalogue(), glitterModels = ctx.facade.glitterModelCatalogue();
    const classic = glitterModels.find(item => !item.stored.length)!;
    entry = Object.freeze({ finishes, glitterModels,
      finishOf: (finish: string) => finishes.find(item => item.id === finish || item.stored.includes(finish)),
      glitterModelOf: (flakes: unknown) => {
        const stored = flakes && typeof flakes === "object" && "model" in flakes ? String((flakes as { model: unknown }).model) : null;
        return (stored && glitterModels.find(item => item.stored.includes(stored))) || classic;
      } });
    read.set(ctx, entry);
  }
  return entry;
}
