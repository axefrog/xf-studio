/**
 * The Poses module's facade: what the presentation may reach of its service (actions, capabilities, the detached snapshot and reads), as
 * method wrappers so the view never holds the service object itself. The composition registers it as the module's service.
 */
import type { ModuleService } from "../../platform/api";
import { POSES_MODULE } from "./module";
import type { PoseLibraryActions } from "./actions";

export type PoseLibraryFacade = { readonly module: ModuleService["module"] } &
  Pick<PoseLibraryActions, "capability" | "dispatch" | "descriptors" | "snapshot" | "subscribe" | "tree" | "entry">;

export function poseLibraryFacade(service: PoseLibraryActions): PoseLibraryFacade {
  return Object.freeze({
    module: POSES_MODULE.id,
    capability: action => service.capability(action),
    dispatch: action => service.dispatch(action),
    descriptors: () => service.descriptors(),
    snapshot: () => service.snapshot(),
    subscribe: listener => service.subscribe(listener),
    tree: query => service.tree(query),
    entry: id => service.entry(id),
  } satisfies PoseLibraryFacade);
}
// The facade is a module service (its methods take the library's own actions).
const _isService: (facade: PoseLibraryFacade) => ModuleService = facade => facade;
void _isService;
