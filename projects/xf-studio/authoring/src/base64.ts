/**
 * Base64 text to bytes, in one pass (host face motion records, solver buffers, animation set tracks). A mapped `Uint8Array.from(atob(text),
 * …)` calls a function per byte: the idle's 6 MB face record took 160 ms of the page's thread that way (research/backlog/performance.md,
 * warm restart). Uses the runtime's own decoder where it has one.
 */
export function bytesFromBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64;
  if (native) return native(text);
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
