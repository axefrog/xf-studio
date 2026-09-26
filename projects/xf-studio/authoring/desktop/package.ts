import { resolve } from "node:path";
import { desktopEyePlate, desktopPackageAdapter, type WolvenKitProbe } from "./build";
import { LocalSettingsStore } from "../src/local-settings-store";
import { defaultLocalSettings } from "../src/local-settings";
import { DesktopWorkActivity } from "./work-activity";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { MAX_PACKAGE_REQUEST_BYTES, PackageHostService, type HostPrerequisite, type PackageAction } from "../src/platform/export/product-host";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/** One Check and one Build at a time for this desktop host (the shared package host service, PIPE-03). */
const service = new PackageHostService();

export type DesktopBuildHost = { dataRoot: string; toolsRoot: string; settings: LocalSettingsStore;
  deadlineMs?: number; shutdownSignal?: AbortSignal; wolvenKitProbe?: WolvenKitProbe;
  /** Where Build failure details go (the desktop host log); never shown raw in the page. */
  log?: (message: string) => void;
  /** XF Studio's own downloaded WolvenKit, used when the settings name none. */
  managedWolvenKit?: () => string | null };
/** Browser requests contain only action and collection; all build paths are host owned. */
export async function desktopPackageRequest(request: Request, workerPath = resolve(import.meta.dir, "check-worker.ts"),
  timeoutMs?: number, buildHost?: DesktopBuildHost, activity?: DesktopWorkActivity): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return json({ error: "Expected a JSON package request." }, 415);
  if (Number(request.headers.get("Content-Length")) > MAX_PACKAGE_REQUEST_BYTES)
    return json({ error: "Collection exceeds 16 MB." }, 413);
  let body: string;
  try { body = await request.text(); }
  catch { return json({ error: "Could not read collection snapshot." }, 400); }
  if (Buffer.byteLength(body) > MAX_PACKAGE_REQUEST_BYTES) return json({ error: "Collection exceeds 16 MB." }, 413);
  let input: { action?: unknown; collection?: unknown };
  try { input = JSON.parse(body); }
  catch { return json({ error: "Expected a package action and collection only." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      (input.action !== "check" && input.action !== "build") ||
      Object.keys(input).some(key => key !== "action" && key !== "collection") || !("collection" in input))
    return json({ error: "Expected a package action and collection only." }, 400);
  const action = input.action as PackageAction;
  if (action === "build" && !buildHost) return json({ code: "package_build_host_unavailable", error: "Desktop package tools are unavailable." }, 503);
  if (service.busy(action)) return json({ code: `package_${action}_busy`, error: action === "build"
    ? "A package Build is already running." : "A package Check is already running. Wait for its result before starting another." }, 409);
  const end = activity?.begin("package");
  if (activity && !end) return json({ code: "package_restart_pending",
    error: "An update restart is being prepared. Finish it before starting package work." }, 409);
  try {
    let settings = defaultLocalSettings();
    try {
      const saved = buildHost?.settings.load().settings;
      if (saved) settings = { ...saved, wolvenKitCli: saved.wolvenKitCli ?? buildHost?.managedWolvenKit?.() ?? null };
    } catch { /* Check still works without saved settings; Build's readiness explains what is missing. */ }
    const dataRoot = buildHost?.dataRoot ?? "";
    // Each exporting feature's host prerequisites, bound by ID (eye makeup: the built-in eye plate). Without a build
    // host (Check only) there is no plate cache, so Check plans on none.
    const adapter = desktopPackageAdapter({ exporters: STUDIO_EXPORTERS, settings, dataRoot, toolsRoot: buildHost?.toolsRoot ?? "",
      checkWorker: workerPath, wolvenKitProbe: buildHost?.wolvenKitProbe, log: buildHost?.log,
      prerequisites: (current): Record<string, HostPrerequisite> => buildHost ? { [EYE_PLATE_PREREQUISITE]: desktopEyePlate(current, dataRoot) } : {} });
    const signal = buildHost?.shutdownSignal ? AbortSignal.any([request.signal, buildHost.shutdownSignal]) : request.signal;
    const outcome = await service.run(adapter, action, input.collection, signal, action === "check" ? timeoutMs : buildHost?.deadlineMs);
    return outcome.ok ? json(outcome.result) : json({ code: outcome.code, error: outcome.message }, outcome.status);
  } finally { end?.(); }
}
