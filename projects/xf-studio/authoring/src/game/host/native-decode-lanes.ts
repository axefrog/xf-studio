/** Host lane propagation at the shared native port, including callers that decode animations directly rather than through fetch(). */
import { currentLane } from "../../host/host-jobs";
import type { NativeDecoder } from "../../native/native-decode";
import type { PrioritisedNativeRequest } from "../../native/native-priority";

const ports = new WeakMap<NativeDecoder, NativeDecoder>();

function inLane<T extends PrioritisedNativeRequest>(request: T): T {
  const lane = currentLane(), priority = request.priority ?? (lane === "ahead" ? "background" : lane ?? undefined);
  return priority === request.priority ? request : { ...request, priority };
}

/** A stateless adapter, not another decoder/queue/lifetime. All views share the underlying route-owned worker. */
export function nativeDecodeLanes(decoder: NativeDecoder): NativeDecoder {
  const known = ports.get(decoder);
  if (known) return known;
  const port: NativeDecoder = {
    get identity() { return decoder.identity; },
    decode: request => decoder.decode(inLane(request)),
    ...(decoder.decodeAnim ? { decodeAnim: (request: Parameters<NonNullable<NativeDecoder["decodeAnim"]>>[0]) => decoder.decodeAnim!(inLane(request)) } : {}),
    ...(decoder.decodeTexture ? { decodeTexture: (request: Parameters<NonNullable<NativeDecoder["decodeTexture"]>>[0]) => decoder.decodeTexture!(inLane(request)) } : {}),
    ...(decoder.decodeMask ? { decodeMask: (request: Parameters<NonNullable<NativeDecoder["decodeMask"]>>[0]) => decoder.decodeMask!(inLane(request)) } : {}),
    ...(decoder.decodeGeometry ? { decodeGeometry: (request: Parameters<NonNullable<NativeDecoder["decodeGeometry"]>>[0]) => decoder.decodeGeometry!(inLane(request)) } : {}),
    ...(decoder.canAnswer ? { canAnswer: () => decoder.canAnswer!() } : {}),
    close: () => decoder.close(),
  };
  ports.set(decoder, port); ports.set(port, port);
  return port;
}
