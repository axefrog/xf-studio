export type DesktopCapabilities = Readonly<{
  schema: "xfs/desktop-capabilities-1";
  host: "electrobun";
  renderer: "webview2";
  version: string;
  channel: "dev" | "canary" | "stable" | "unavailable";
  buildHash: string;
  metadataStatus: "ready" | "unavailable";
  userDataPath: string;
  library: true;
  packageCheck: true;
  packageBuild: boolean;
  installation: false;
  updater: false;
  previewAssets: "missing" | "incomplete" | "ready";
  /**
   * Developer-only five-file preview intake. Community users cannot prepare
   * those files, so it is off unless the data folder holds the marker below.
   */
  previewIntake: boolean;
}>;

/** An empty file with this name in the app's data folder turns on the developer preview intake. */
export const PREVIEW_INTAKE_MARKER = "developer-preview-intake";

export type DesktopVersion = Pick<DesktopCapabilities, "version" | "channel" | "buildHash" | "metadataStatus">;

export function desktopVersionFromMetadata(value: unknown): DesktopVersion {
  if (value && typeof value === "object") {
    const metadata = value as Record<string, unknown>;
    if (typeof metadata.version === "string" &&
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(metadata.version) &&
      ["dev", "canary", "stable"].includes(String(metadata.channel)) &&
      typeof metadata.hash === "string" && /^[a-z0-9]{1,64}$/.test(metadata.hash))
      return { version: metadata.version, channel: metadata.channel as DesktopVersion["channel"],
        buildHash: metadata.hash, metadataStatus: "ready" };
  }
  return { version: "unavailable", channel: "unavailable", buildHash: "unavailable", metadataStatus: "unavailable" };
}

export const desktopCapabilities = (previewAssets: DesktopCapabilities["previewAssets"],
  version: DesktopVersion, userDataPath: string, packageBuild = false, previewIntake = false): DesktopCapabilities => ({
  schema: "xfs/desktop-capabilities-1",
  host: "electrobun",
  renderer: "webview2",
  ...version,
  userDataPath,
  library: true,
  packageCheck: true,
  packageBuild,
  installation: false,
  updater: false,
  previewAssets,
  previewIntake,
});
