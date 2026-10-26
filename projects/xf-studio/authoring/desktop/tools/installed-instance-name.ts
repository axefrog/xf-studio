/**
 * The single-instance mutex name of an installed XF Studio, for tools/refresh-installed.ps1 and its helper:
 *
 *   bun tools/installed-instance-name.ts <LOCALAPPDATA> <identifier> <channel>
 *
 * An installed app's `Utils.paths.userData` is `<LOCALAPPDATA>\<identifier>\<channel>`: Electrobun's `paths.userData` joins the app-data
 * folder (`%LOCALAPPDATA%`), the `version.json` identifier and the install root's folder name, which is the channel for an install at
 * `<LOCALAPPDATA>\<identifier>\<channel>\app` (`resolveInstalledRootNameForPaths` in its `Utils.ts`). `main.ts` claims
 * `instanceName(Utils.paths.userData)`, so naming it here from the same function keeps the two from drifting.
 */
import { join } from "node:path";
import { instanceName } from "../single-instance";

/** The data folder Electrobun gives an app installed under `localAppData` with this identifier and channel. */
export const installedUserData = (localAppData: string, identifier: string, channel: string) => join(localAppData, identifier, channel);

export const installedInstanceName = (localAppData: string, identifier: string, channel: string) =>
  instanceName(installedUserData(localAppData, identifier, channel));

if (import.meta.main) {
  const [localAppData, identifier, channel] = process.argv.slice(2);
  if (!localAppData || !identifier || !channel) { console.error("Usage: bun tools/installed-instance-name.ts <LOCALAPPDATA> <identifier> <channel>"); process.exit(2); }
  console.log(installedInstanceName(localAppData, identifier, channel));
}
