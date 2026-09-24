import { resolve } from "node:path";
import { runDesktopCheck } from "./check-runner";

const maxBytes = 16_000_000;
let checking = false;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Desktop package port. Build has no portable resource/verifier adapter yet. */
export async function desktopPackageRequest(request: Request, workerPath = resolve(import.meta.dir, "check-worker.ts"),
  timeoutMs?: number): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return json({ error: "Expected a JSON package request." }, 403);
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
  if (input.action === "build") return json({ code: "package_build_host_unavailable",
    error: "Desktop mod builds are unavailable until the external plate, WolvenKit and independent verifier pipeline has a portable adapter." }, 503);
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
}
