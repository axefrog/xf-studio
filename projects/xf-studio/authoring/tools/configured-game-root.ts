/** The game folder for local research tools: the one chosen in the Studio's setup, or XFS_PACKAGE_GAMEPATH.
 * Tools never assume a store's default install location. */
import { packageToolPaths } from "../src/setup/host/local-settings-readiness";
import { LocalSettingsStore } from "../src/setup/host/local-settings-store";

export function configuredGameRoot(): string {
  const root = packageToolPaths(new LocalSettingsStore().load().settings).gamepath;
  if (!root) throw Error("Choose the Cyberpunk 2077 folder in the Studio's setup, or set XFS_PACKAGE_GAMEPATH, then run this again.");
  return root;
}
