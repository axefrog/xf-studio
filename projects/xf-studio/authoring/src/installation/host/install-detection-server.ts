import { NO_PRODUCT, type ProductDefaults } from "../../platform/api/product";
/** Host endpoint for read-only install detection and the framework version check. GET only; the
 * browser chooses a fixed target, never a path, registry key or command. The framework check reads
 * the host's own local settings. */
import { checkFrameworkVersions, frameworkModNames, type FrameworkCheckInput, type FrameworkHostPort } from "../framework-versions";
import { detectGameInstalls, detectMo2Instances, type DetectionHostPort } from "../install-detection";
import { createWindowsDetectionHost } from "./install-detection-host";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const targets = ["games", "mo2", "frameworks"];

/** The framework check for host readiness; undefined (reported as unavailable) if the host can't read it. */
export function hostFrameworkCheck(settings: FrameworkCheckInput, port: () => FrameworkHostPort = createWindowsDetectionHost, product: ProductDefaults = NO_PRODUCT) {
  try { return checkFrameworkVersions(port(), settings, product); } catch { return undefined; }
}

/** The MO2 profile's framework mod folders (the placement keeps a new mod out of their section); none when they can't be read. */
export function profileFrameworkMods(settings: FrameworkCheckInput, port?: () => FrameworkHostPort, product: ProductDefaults = NO_PRODUCT): string[] {
  const route = hostFrameworkCheck(settings, port, product)?.routes.find(item => item.route === "mo2");
  return route?.available ? frameworkModNames(route) : [];
}

export type FrameworkCheckSource = { product?: ProductDefaults; settings: () => FrameworkCheckInput; port?: () => FrameworkHostPort };

export function createInstallDetectionHandler(host: () => DetectionHostPort = () => createWindowsDetectionHost(),
  frameworks: FrameworkCheckSource | null = null, product: ProductDefaults = NO_PRODUCT) {
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
      try { return json(checkFrameworkVersions((frameworks.port ?? createWindowsDetectionHost)(), frameworks.settings(), frameworks.product ?? product)); }
      catch { return json({ code: "detection_failed", error: "We couldn't check your frameworks. Try again in a moment." }, 500); }
    }
    try {
      const port = host();
      // The instance the settings name is offered too, so a portable copy chosen by hand keeps its profiles as choices.
      let configured: string | null = null;
      try { configured = frameworks?.settings().mo2Root ?? null; } catch { /* Unreadable settings: detection alone. */ }
      const mo2 = await detectMo2Instances(port, configured);
      return json(target === "mo2" ? mo2 : await detectGameInstalls(port, mo2, frameworks?.product ?? product));
    } catch { return json({ code: "detection_failed", error: "Install detection failed on this host." }, 500); }
  };
}
