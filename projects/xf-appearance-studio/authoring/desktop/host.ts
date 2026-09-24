export type DesktopCapabilities = Readonly<{
  schema: "xfs/desktop-capabilities-1";
  host: "electrobun-spike";
  renderer: "webview2";
  version: string;
  channel: "dev" | "canary" | "stable";
  library: true;
  packageCheck: false;
  packageBuild: false;
  installation: false;
  updater: false;
  previewAssets: "missing" | "user-provided";
}>;

export type DesktopVersion = Pick<DesktopCapabilities, "version" | "channel">;

export const desktopCapabilities = (previewAssets: DesktopCapabilities["previewAssets"],
  version: DesktopVersion): DesktopCapabilities => ({
  schema: "xfs/desktop-capabilities-1",
  host: "electrobun-spike",
  renderer: "webview2",
  ...version,
  library: true,
  packageCheck: false,
  packageBuild: false,
  installation: false,
  updater: false,
  previewAssets,
});
