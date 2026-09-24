import { parseCollection } from "../src/preset-collection";
import { preflightPackageCollection } from "../src/package-preflight";

// One request per worker. The host terminates this worker after a complete
// response or its deadline; synchronous compiler work never runs on loopback.
self.onmessage = (event: MessageEvent<unknown>) => {
  let collection;
  try { collection = parseCollection(event.data); }
  catch (error) {
    self.postMessage({ kind: "invalid", message: error instanceof Error ? error.message : "Invalid collection." });
    return;
  }
  try {
    const { packagedCollectionJson: _snapshot, ...result } = preflightPackageCollection(collection);
    self.postMessage({ kind: "success", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package Check failed.";
    self.postMessage({ kind: "failure", message,
      code: message.startsWith("No mod files can be made") ? "no_exportable_content" : undefined });
  }
};
