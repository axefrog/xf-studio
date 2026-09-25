/**
 * Why the prepared 3D head could not be shown in this window, as a typed code. The renderer and
 * the preview record loader throw these; the preview setup service turns each code into plain
 * wording and one next step (never the loader's own text).
 *
 * - `webgl_unavailable`: this window has no WebGL 2 (graphics driver, remote desktop, blocked GPU).
 * - `preview_damaged`: the prepared files are there but don't load (wrong hash, unreadable model,
 *   missing parts); preparing them again from the game files fixes it.
 * - `preview_unreachable`: the files couldn't be fetched (the host went away or is changing them).
 * - `head_load_failed`: anything else.
 */
export type HeadLoadFailureCode = "webgl_unavailable" | "preview_damaged" | "preview_unreachable" | "head_load_failed";

export class HeadLoadError extends Error {
  constructor(readonly code: HeadLoadFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HeadLoadError";
  }
}

/** The code for any failure while loading the head; untyped WebGL failures (Three's own) are recognised. */
export function headLoadFailureCode(error: unknown): HeadLoadFailureCode {
  if (error instanceof HeadLoadError) return error.code;
  const code = (error as { code?: unknown })?.code;
  if (code === "webgl_unavailable" || code === "preview_damaged" || code === "preview_unreachable") return code;
  return /webgl/i.test(String((error as Error)?.message ?? error)) ? "webgl_unavailable" : "head_load_failed";
}
