/**
 * The Holotable module's facade: what the presentation may reach of its service (actions, capabilities and the detached snapshot), as
 * method wrappers so the view never holds the service object itself. The composition registers it as the module's service.
 */
import type { ModuleService } from "../../platform/api";
import { HOLOTABLE_MODULE } from "./module";
import type { HolotableService } from "./service";

export type HolotableFacade = { readonly module: ModuleService["module"] } &
  Pick<HolotableService, "capability" | "dispatch" | "snapshot" | "subscribe" | "speedOptions" | "context" | "navigation" | "nextVisibleChange" | "preference" | "remember">;

export function holotableFacade(service: HolotableService): HolotableFacade {
  return Object.freeze({
    module: HOLOTABLE_MODULE.id,
    capability: action => service.capability(action),
    dispatch: action => service.dispatch(action),
    snapshot: () => service.snapshot(),
    speedOptions: () => service.speedOptions(),
    context: signal => service.context(signal),
    navigation: (view,adapter,signal) => service.navigation(view,adapter,signal),
    nextVisibleChange: () => service.nextVisibleChange(),
    preference: (key,view) => service.preference(key,view),
    remember: (key,value,view) => service.remember(key,value,view),
    subscribe: listener => service.subscribe(listener),
  } satisfies HolotableFacade);
}
// The facade is a module service (its methods take the module's own actions).
const _isService: (facade: HolotableFacade) => ModuleService = facade => facade;
void _isService;
