import { parseCollection } from "../src/preset-collection";
import { preflightPackageCollection } from "../src/package-preflight";
import { EYE_MAKEUP_REGION } from "../src/features/eye-makeup/region";
import { parsePlateUvFootprint } from "../src/engines/layered-makeup/plate-uv-window";
import type { CheckRequest } from "./check-runner";

// One request per worker. The host terminates this worker after a complete
// response or its deadline; synchronous compiler work never runs on loopback.
self.onmessage = (event: MessageEvent<CheckRequest>) => {
  let collection, plate: CheckRequest["plate"] = null;
  try {
    collection = parseCollection(event.data?.collection);
    if (event.data?.plate) plate = { footprint: parsePlateUvFootprint(event.data.plate.footprint), sha256: String(event.data.plate.sha256) };
  }
  catch (error) {
    self.postMessage({ kind: "invalid", message: error instanceof Error ? error.message : "Invalid collection." });
    return;
  }
  try {
    const { packagedCollectionJson: _snapshot, ...result } = preflightPackageCollection(collection, EYE_MAKEUP_REGION, plate);
    self.postMessage({ kind: "success", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package Check failed.";
    self.postMessage({ kind: "failure", message,
      code: message.startsWith("No mod files can be made") ? "no_exportable_content" : undefined });
  }
};
