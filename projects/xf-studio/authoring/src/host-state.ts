/**
 * Where a host keeps the person's settings and install receipts, and whether it may add mods (INSTALL-01, INSTALL-04).
 *
 * - **Settings follow the data folder.** A localhost server keeps its settings in `%LOCALAPPDATA%\XF Studio` (per user), unless it
 *   runs with its own data folder (`XFAS_DATA_DIR`, as every test and acceptance server does) or an explicit settings folder
 *   (`XFS_SETTINGS_DIR`): then they live there, and the real settings are never read or written. The desktop app keeps its
 *   settings in its own data folder (its identity and channel).
 * - **Install receipts are per user on this computer**, beside localhost's settings (`%LOCALAPPDATA%\XF Studio\install-receipts`),
 *   so localhost and the desktop app recognise each other's installs and share one lock. A host's own earlier receipts folder
 *   (`<data>/install-receipts`) is read once and its record taken over. An isolated server keeps receipts in its own folder.
 * - **An isolated server doesn't add mods** unless `XFS_MOD_INSTALL=on` (for install tests against temporary fixtures);
 *   `XFS_MOD_INSTALL=off` switches adding off anywhere.
 * - **A verification workspace (`?verify`)** has a settings store of its own, in the data folder, that starts from the host's
 *   settings and keeps every change to itself; its installs are refused (mod-install-host.ts `readOnly`).
 */
import { resolve } from "node:path";
import { localSettingsDirectory } from "./local-settings-store";
import { installReceiptsRoot } from "./mod-install-host";

export type LocalHostState = {
  /** The server's private data folder (libraries, diagnostics, verification scopes). */
  dataRoot: string;
  /** Where its settings live. */
  settingsDirectory: string;
  /** Where its install receipts live. */
  installReceipts: string;
  /** Earlier receipts folders whose records are taken over. */
  legacyInstallReceipts: string[];
  /** Running with its own data or settings folder: never the person's real settings. */
  isolated: boolean;
  /** Whether "Add to my mod manager" may change anything. */
  installs: boolean;
};

/** Per user on this computer: `%LOCALAPPDATA%\XF Studio\install-receipts` on Windows (INSTALL-04). */
export const machineInstallReceiptsRoot = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) =>
  resolve(localSettingsDirectory(platform, env), "install-receipts");

/** A localhost server's folders, from its environment (see above). */
export function localHostState(defaultDataRoot: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): LocalHostState {
  const dataRoot = resolve(env.XFAS_DATA_DIR || defaultDataRoot);
  const explicit = env.XFS_SETTINGS_DIR ? resolve(env.XFS_SETTINGS_DIR) : null;
  const isolated = !!env.XFAS_DATA_DIR || explicit !== null;
  const settingsDirectory = explicit ?? (env.XFAS_DATA_DIR ? dataRoot : localSettingsDirectory(platform, env));
  const installReceipts = isolated ? resolve(settingsDirectory, "install-receipts") : machineInstallReceiptsRoot(env, platform);
  const legacy = installReceiptsRoot(dataRoot);
  return { dataRoot, settingsDirectory, installReceipts, legacyInstallReceipts: legacy === installReceipts ? [] : [legacy], isolated,
    installs: env.XFS_MOD_INSTALL === "on" || (!isolated && env.XFS_MOD_INSTALL !== "off") };
}

/** A verification workspace's own settings folder, inside the host's data folder. */
export const verificationSettingsDirectory = (dataRoot: string) => resolve(dataRoot, "verification-settings");
/** A verification workspace's receipts folder: its plans read here, and nothing is ever written. */
export const verificationInstallReceipts = (dataRoot: string) => resolve(dataRoot, "verification-install-receipts");
