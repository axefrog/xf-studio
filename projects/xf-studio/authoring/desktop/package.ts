import { preflightPackageCollection } from "../src/package-preflight";
import { parseCollection } from "../src/preset-collection";

const maxBytes = 16_000_000;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Desktop package port. Build has no portable resource/verifier adapter yet. */
export async function desktopPackageRequest(request: Request): Promise<Response> {
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
  let collection;
  try { collection = parseCollection(input.collection); }
  catch (error) { return json({ error: (error as Error).message }, 400); }
  if (input.action === "build") return json({ code: "package_build_host_unavailable",
    error: "Desktop mod builds are unavailable until the external plate, WolvenKit and independent verifier pipeline has a portable adapter." }, 503);
  try {
    // Mirror localhost's request normalization before the shared CLI preflight.
    const { packagedCollectionJson: _snapshot, ...result } = preflightPackageCollection(collection);
    return json(result);
  } catch (error) {
    const message = (error as Error).message;
    return json({ error: message, ...(message.startsWith("No mod files can be made") ? { code: "no_exportable_content" } : {}) },
      422);
  }
}
