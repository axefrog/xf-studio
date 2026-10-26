/** Panel command wiring. P3-iii replaces the static catalogue input with the incoming live contribution source. */
import { PanelActions } from "../app/profiles/panel-actions";
import type { ProfileSessions } from "../app/profiles/profile-sessions";
import type { TargetResolver } from "../app/profiles/targets";
import { STUDIO_CATALOGUE } from "./views";
import { defaultDockState } from "../studio-ui/layout-defaults";
import type { JsonValue } from "../app/ui-preferences";

export function panelCommands(session: ProfileSessions, targets: TargetResolver) {
  return new PanelActions(session, { types: () => STUDIO_CATALOGUE.panels.map(panel => panel.id === "head" ? { ...panel, id: "view" } : panel), world: () => targets.world(),
    factory: () => ({ format: "xfs/dock", version: 1, state: defaultDockState(STUDIO_CATALOGUE) as unknown as JsonValue }) });
}
