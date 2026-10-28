/** Exercise the real worker entry with its existing timer-yield fallback in Bun. Buffer startup messages across import. */
const pending: MessageEvent[] = [];
self.onmessage = event => { pending.push(event); };
Object.defineProperty(globalThis, "MessageChannel", { value: undefined, configurable: true });
await import("../../src/legacy/eye-makeup/browser/raster-worker");
for (const event of pending) self.onmessage!(event);
export {};
