/** Host endpoint for read-only install detection. GET only; the browser chooses a fixed target,
 * never a path, registry key or command. */
import { detectGameInstalls, detectMo2Instances, type DetectionHostPort } from "./install-detection";
import { createWindowsDetectionHost } from "./install-detection-host";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function createInstallDetectionHandler(host: () => DetectionHostPort = () => createWindowsDetectionHost()) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to detect installs." }, 403);
    if (request.method !== "GET") return json({ code: "method", error: "Method not allowed." }, 405);
    const target = url.searchParams.get("target");
    if ((target !== "games" && target !== "mo2") || [...url.searchParams.keys()].length !== 1)
      return json({ code: "invalid_target", error: "Choose games or mo2 detection." }, 400);
    try {
      const port = host();
      const mo2 = await detectMo2Instances(port);
      return json(target === "mo2" ? mo2 : await detectGameInstalls(port, mo2));
    } catch { return json({ code: "detection_failed", error: "Install detection failed on this host." }, 500); }
  };
}
