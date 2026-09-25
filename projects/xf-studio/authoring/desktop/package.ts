import { resolve } from "node:path";
import { runDesktopCheck } from "./check-runner";
import { runDesktopBuild, type WolvenKitProbe } from "./build";
import { LocalSettingsStore } from "../src/local-settings-store";
import { DesktopWorkActivity } from "./work-activity";

const maxBytes = 16_000_000;
let checking = false;
let building = false;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export type DesktopBuildHost = { dataRoot: string; toolsRoot: string; settings: LocalSettingsStore;
  deadlineMs?: number; shutdownSignal?: AbortSignal; wolvenKitProbe?: WolvenKitProbe;
  /** Where Build failure details go (the desktop host log); never shown raw in the page. */
  log?: (message: string) => void };
/** Browser requests contain only action and collection; all build paths are host owned. */
export async function desktopPackageRequest(request: Request, workerPath = resolve(import.meta.dir, "check-worker.ts"),
  timeoutMs?: number, buildHost?: DesktopBuildHost, activity?: DesktopWorkActivity): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return json({ error: "Expected a JSON package request." }, 415);
  if (Number(request.headers.get("Content-Length")) > maxBytes)
    return json({ error: "Collection exceeds 16 MB." }, 413);
  let body: string;
  try { body = await request.text(); }
  catch { return json({ error: "Could not read collection snapshot." }, 400); }
  if (Buffer.byteLength(body) > maxBytes) return json({ error: "Collection exceeds 16 MB." }, 413);
  let input: any;
  try { input = JSON.parse(body); }
  catch { return json({ error: "Expected a package action and collection only." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      (input.action !== "check" && input.action !== "build") ||
      Object.keys(input).some(key => key !== "action" && key !== "collection") || !("collection" in input))
    return json({ error: "Expected a package action and collection only." }, 400);
  const end = activity?.begin("package");
  if (activity && !end) return json({ code: "package_restart_pending",
    error: "An update restart is being prepared. Finish it before starting package work." }, 409);
  try {
  if (input.action === "build") {
    if (!buildHost) return json({ code: "package_build_host_unavailable",
      error: "Desktop package tools are unavailable." }, 503);
    if (building) return json({ code: "package_build_busy", error: "A package Build is already running." }, 409);
    building = true;
    try {
      const signal = buildHost.shutdownSignal ? AbortSignal.any([request.signal, buildHost.shutdownSignal]) : request.signal;
      const result = await runDesktopBuild(input.collection, buildHost.settings.load().settings,
        buildHost.dataRoot, buildHost.toolsRoot, buildHost.deadlineMs, signal, buildHost.wolvenKitProbe, undefined, buildHost.log);
      if (result.kind === "success") return json(result.result);
      return json({ code: result.code, error: result.message }, result.code === "package_build_unavailable" ? 503 :
        result.code === "invalid_collection" ? 422 : result.code === "package_build_timeout" ? 504 :
        result.code === "package_build_cancelled" ? 499 : 422);
    } catch { return json({ code: "package_build_failed", error: "Package Build could not start." }, 422); }
    finally { building = false; }
  }
  if (checking) return json({ code: "package_check_busy", error: "A package Check is already running. Wait for its result before starting another." }, 409);
  checking = true;
  let result;
  try { result = await runDesktopCheck(input.collection, workerPath, timeoutMs, request.signal); }
  finally { checking = false; }
  if (result.kind === "success") return json(result.result);
  if (result.kind === "invalid") return json({ error: result.message }, 400);
  const status = result.code === "package_check_timeout" ? 504 : result.code === "package_check_cancelled" ? 499 :
    result.code?.startsWith("package_check_worker") ? 503 : 422;
  return json({ error: result.message, ...(result.code ? { code: result.code } : {}) }, status);
  } finally { end?.(); }
}
