// The export host's Check worker (a composition root): one request per worker. The host terminates it after a
// complete response or its deadline; synchronous compiler work never runs on the host's own thread. Both hosts run
// it: localhost from the source tree, desktop from its view bundle (desktop/check-worker.ts imports this file).
import { checkProducts } from "../src/platform/export/product-check";
import { ExportRefusal } from "../src/platform/api";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import type { CheckOutcome, CheckRequest } from "../src/platform/export/check-runner";

self.onmessage = (event: MessageEvent<CheckRequest>) => {
  const request = event.data;
  let outcome: CheckOutcome;
  try {
    const { result } = checkProducts({ collection: request?.collection, exporters: STUDIO_EXPORTERS,
      prerequisites: request?.prerequisites && typeof request.prerequisites === "object" ? request.prerequisites : {},
      diagnostics: false, preflight: true, collectionSha256: String(request?.collectionSha256 ?? "") });
    outcome = { kind: "success", result };
  } catch (error) {
    outcome = { kind: "failure", message: error instanceof Error ? error.message : "Package Check failed.",
      code: error instanceof ExportRefusal ? error.code : "package_check_failed" };
  }
  self.postMessage(outcome);
};
