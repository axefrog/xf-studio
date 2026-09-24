import { InstallDetectionActions } from "./install-detection-actions";

export function createBrowserInstallDetection() {
  return new InstallDetectionActions(async target => {
    const response = await fetch(`/api/install-detection?target=${target}`);
    return { ok: response.ok, status: response.status, data: await response.json() };
  });
}
