import { InstallDetectionActions, type InstallDetectionTransport } from "../install-detection-actions";

/**
 * The page's detection service over `/api/install-detection`. `answer` lets a verification workspace answer a request itself (a specimen
 * check, compose/framework-status-verification.ts); returning undefined asks the host as usual.
 */
export function createBrowserInstallDetection(answer?: (target: Parameters<InstallDetectionTransport>[0]) => ReturnType<InstallDetectionTransport> | undefined) {
  return new InstallDetectionActions(async target => {
    const specimen = answer?.(target);
    if (specimen) return specimen;
    const response = await fetch(`/api/install-detection?target=${target}`);
    return { ok: response.ok, status: response.status, data: await response.json() };
  });
}
