/** Host endpoint for read-only install detection and the framework version check. GET only; the
 * browser chooses a fixed target, never a path, registry key or command. The framework check reads
 * the host's own local settings. */
import { checkFrameworkVersions, type FrameworkCheckInput, type FrameworkHostPort } from "./framework-versions";
import { detectGameInstalls, detectMo2Instances, type DetectionHostPort } from "./install-detection";
import { createWindowsDetectionHost } from "./install-detection-host";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const targets = ["games", "mo2", "frameworks"];

/** The framework check for host readiness; undefined (reported as unavailable) if the host can't read it. */
export function hostFrameworkCheck(settings: FrameworkCheckInput, port: () => FrameworkHostPort = createWindowsDetectionHost) {
  try { return checkFrameworkVersions(port(), settings); } catch { return undefined; }
}

export type FrameworkCheckSource = { settings: () => FrameworkCheckInput; port?: () => FrameworkHostPort };

export function createInstallDetectionHandler(host: () => DetectionHostPort = () => createWindowsDetectionHost(),
  frameworks: FrameworkCheckSource | null = null) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to detect installs." }, 403);
    if (request.method !== "GET") return json({ code: "method", error: "Method not allowed." }, 405);
    const target = url.searchParams.get("target");
    if (!target || !targets.includes(target) || [...url.searchParams.keys()].length !== 1)
      return json({ code: "invalid_target", error: "Choose games, mo2 or frameworks detection." }, 400);
    if (target === "frameworks") {
      if (!frameworks) return json({ code: "unavailable", error: "This host can't check frameworks." }, 404);
      try { return json(checkFrameworkVersions((frameworks.port ?? createWindowsDetectionHost)(), frameworks.settings())); }
      catch { return json({ code: "detection_failed", error: "We couldn't check your frameworks. Try again in a moment." }, 500); }
    }
    try {
      const port = host();
      const mo2 = await detectMo2Instances(port);
      return json(target === "mo2" ? mo2 : await detectGameInstalls(port, mo2));
    } catch { return json({ code: "detection_failed", error: "Install detection failed on this host." }, 500); }
  };
}
