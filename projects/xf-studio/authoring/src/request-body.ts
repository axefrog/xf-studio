/**
 * A host endpoint's JSON body, read within a byte limit (PIPE-83): a declared `Content-Length` over the limit is refused before
 * anything is read, and the body is counted in bytes as it streams in, so a sender that declares nothing (or too little) is cut off
 * at the limit instead of being buffered whole. Shared by the character and creator endpoints. Host side only.
 */
export class BodyTooLargeError extends Error { constructor() { super("Request is too large."); } }

/** The body's text; throws `BodyTooLargeError` past `maxBytes`, and a `SyntaxError` when it isn't UTF-8. */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("Content-Length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new BodyTooLargeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new SyntaxError("The request is not text."); }
}

/** The body parsed as JSON (see `readBodyText`). */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBodyText(request, maxBytes));
}
