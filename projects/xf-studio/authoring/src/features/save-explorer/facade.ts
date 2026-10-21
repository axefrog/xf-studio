/**
 * The Save Explorer's facade: what the presentation may reach of its service (actions, capabilities, the detached snapshot and reads, each
 * for one panel instance), as method wrappers so the view never holds the service object itself. The composition registers it as the
 * module's service.
 */
import type { ModuleService } from "../../platform/api";
import { SAVE_EXPLORER_MODULE } from "./module";
import type { SaveExplorerSessions } from "./sessions";

export type SaveExplorerFacade = { readonly module: ModuleService["module"] } & Pick<SaveExplorerSessions,
  "capability" | "dispatch" | "descriptors" | "snapshot" | "subscribe" | "tree" | "node" | "entries" | "object" | "modData" | "thumbnail" | "release">;

export function saveExplorerFacade(service: SaveExplorerSessions): SaveExplorerFacade {
  return Object.freeze({
    module: SAVE_EXPLORER_MODULE.id,
    capability: action => service.capability(action),
    dispatch: action => service.dispatch(action),
    descriptors: () => service.descriptors(),
    snapshot: instance => service.snapshot(instance),
    subscribe: listener => service.subscribe(listener),
    tree: instance => service.tree(instance),
    node: (instance, id) => service.node(instance, id),
    entries: (instance, offset, limit, filter) => service.entries(instance, offset, limit, filter),
    object: (instance, ref) => service.object(instance, ref),
    modData: instance => service.modData(instance),
    thumbnail: (instance, folder) => service.thumbnail(instance, folder),
    release: instance => service.release(instance),
  } satisfies SaveExplorerFacade);
}
// The facade is a module service (its actions name the panel instance they come from).
const _isService: (facade: SaveExplorerFacade) => ModuleService = facade => facade as unknown as ModuleService;
void _isService;
