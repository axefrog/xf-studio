/** Panel command wiring over the same live contribution snapshot as layout defaults and the shell. */
import { PanelActions } from "../app/profiles/panel-actions";
import type { ProfileSessions } from "../app/profiles/profile-sessions";
import type { TargetResolver } from "../app/profiles/targets";
import { STUDIO_CATALOGUE } from "./views";
import { defaultDockState } from "../studio-ui/layout-defaults";
import type { JsonValue } from "../app/ui-preferences";
import type { ViewCatalogue } from "../studio-ui/views/contribution";

export function panelCommands(session: ProfileSessions, targets: TargetResolver, catalogue: () => ViewCatalogue = () => STUDIO_CATALOGUE) {
  return new PanelActions(session, { types: () => catalogue().panels.map(panel => panel.id === "head" ? { ...panel, id: "view" } : panel), world: () => targets.world(),
    factory: () => ({ format: "xfs/dock", version: 1, state: defaultDockState(catalogue()) as unknown as JsonValue }) });
}
