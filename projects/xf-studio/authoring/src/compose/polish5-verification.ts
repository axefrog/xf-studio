import { CollectionServiceError } from "../library/collection-service";
import type { CollectionTransport } from "../library/collection-service";

/** Isolated visual specimen: exercise the real Build/Stop service without starting a host build. */
export function polish5Verification(transport: CollectionTransport) {
  let armed = false, stopping = false;
  let finish: (() => void) | undefined;
  return {
    arm() { armed = true; stopping = false; },
    stopped() { if (!stopping || !finish) throw Error("Stop the specimen first."); finish(); },
    transport: {
      ...transport,
      package: (action, collection, signal) => {
        if (!armed || action !== "build") return transport.package(action, collection, signal);
        return new Promise((_, reject) => {
          const stop = () => { stopping = true; };
          finish = () => { armed = false; finish = undefined; reject(new CollectionServiceError("package_build_cancelled", "Build stopped. Nothing was promoted. Your collection is unchanged.")); };
          if (!signal) throw Error("Build specimen needs its cancellation signal.");
          if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
        });
      },
      packageProgress: () => armed ? Promise.resolve({ stage: "convert", step: 3, steps: 5, looks: 2 })
        : transport.packageProgress?.() ?? Promise.resolve(null),
    } satisfies CollectionTransport,
  };
}
