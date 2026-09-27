/**
 * The Save Explorer's facade: what the presentation may reach of its service (actions, capabilities, the detached snapshot and reads),
 * as method wrappers so the view never holds the service object itself. The composition registers it as the module's service.
 */
import type { ModuleService } from "../../platform/api";
import { SAVE_EXPLORER_MODULE } from "./module";
import type { SaveExplorerActions } from "./actions";

export type SaveExplorerFacade = { readonly module: ModuleService["module"] } & Pick<SaveExplorerActions,
  "capability" | "dispatch" | "descriptors" | "snapshot" | "subscribe" | "tree" | "node" | "entries" | "object" | "modData" | "thumbnail">;

export function saveExplorerFacade(service: SaveExplorerActions): SaveExplorerFacade {
  return Object.freeze({
    module: SAVE_EXPLORER_MODULE.id,
    capability: action => service.capability(action),
    dispatch: action => service.dispatch(action),
    descriptors: () => service.descriptors(),
    snapshot: () => service.snapshot(),
    subscribe: listener => service.subscribe(listener),
    tree: () => service.tree(),
    node: id => service.node(id),
    entries: (offset, limit, filter) => service.entries(offset, limit, filter),
    object: ref => service.object(ref),
    modData: () => service.modData(),
    thumbnail: folder => service.thumbnail(folder),
  } satisfies SaveExplorerFacade);
}
// The facade is a module service (its methods take the explorer's own actions).
const _isService: (facade: SaveExplorerFacade) => ModuleService = facade => facade;
void _isService;
