/**
 * The module-service composition list (view-graph-design.md §5): every part-less module's application service, built from the devices
 * a composition root supplies and registered as facades on the presentation port (`port.module(id)`). Adding such a module adds its
 * service here; nothing in the shell or the application names it.
 */
import type { ModuleService } from "../platform/api";
import { saveExplorerFacade, SaveExplorerActions, type SaveExplorerDevice } from "../features/save-explorer";

/** The devices module services use; a host without one gets a service that says so. */
export type ModuleDevices = { readonly saves: SaveExplorerDevice | null };

export function createModuleServices(devices: ModuleDevices): readonly ModuleService[] {
  return Object.freeze([saveExplorerFacade(new SaveExplorerActions(devices.saves))]);
}
