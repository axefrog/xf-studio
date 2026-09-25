import { decodeGradingLutBinary, GRADING_LUT_ASSET_PREFIX, GRADING_LUT_ENDPOINT, GRADING_LUT_FILE, parseGradingLutSource,
  type GradingLut, type GradingLutSource } from "./grading-lut";

/**
 * Browser device for the creator preset's grading LUT: asks the host (same endpoint on both hosts) which
 * LUT the installation's environment resolves to, waits while the host extracts it, and downloads the
 * decoded cube. Any failure falls back to the neutral grade with a plain note; it never throws.
 */
export type GradingLutFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type LoadedGradingLut = { lut: GradingLut | null; source: GradingLutSource };

const neutral = (note: string): LoadedGradingLut => ({ lut: null, source: { kind: "neutral", depotPath: null, archive: null, group: null,
  provider: null, alternatives: [], rule: null, size: null, note, skipped: [] } });
const UNREACHABLE = "Colour grading: the game's LUT couldn't be loaded, so a neutral grade is shown.";

export async function loadGradingLut(fetcher: GradingLutFetch = (url, init) => fetch(url, init),
  options: { signal?: AbortSignal; wait?: (ms: number) => Promise<void>; attempts?: number } = {}): Promise<LoadedGradingLut> {
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  try {
    for (let attempt = 0; attempt < (options.attempts ?? 600); attempt++) {
      if (options.signal?.aborted) return neutral(UNREACHABLE);
      const response = await fetcher(GRADING_LUT_ENDPOINT, { signal: options.signal });
      if (!response.ok) return neutral(UNREACHABLE);
      const state = await response.json() as { phase?: unknown; source?: unknown; file?: unknown };
      if (state.phase === "preparing") { await wait(attempt < 10 ? 300 : 1000); continue; }
      const source = parseGradingLutSource(state.source);
      if (state.phase !== "ready" || !source) return neutral(UNREACHABLE);
      if (typeof state.file !== "string" || !GRADING_LUT_FILE.test(state.file)) return { lut: null, source: source.kind === "neutral" ? source : neutral(UNREACHABLE).source };
      const file = await fetcher(`${GRADING_LUT_ASSET_PREFIX}${state.file}`, { signal: options.signal });
      if (!file.ok) return neutral(UNREACHABLE);
      return { lut: decodeGradingLutBinary(new Uint8Array(await file.arrayBuffer())), source };
    }
    return neutral(UNREACHABLE);
  } catch { return neutral(UNREACHABLE); }
}
