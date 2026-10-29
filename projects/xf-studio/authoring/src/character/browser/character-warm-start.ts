/**
 * Browser device: the V's details made ready while the head loads, after a restart (research/backlog/performance.md, warm restart).
 *
 * The head attachment asks for the current V alongside core-head construction, before its idle and blink finish. This device starts
 * still earlier: it remembers the last request the page asked for (in the workspace's storage, per workspace), and on the next start asks the host
 * about it at once, as a page of its own and without letting the host prepare anything (`X-XFS-Warm`: a kept or known answer, else
 * nothing). When the host has it, every file its record names is fetched, verified and decoded (maps to bitmaps off the page's thread,
 * meshes parsed a stage per task) while the head loads, within the loader's budgets; the load that shows the V takes them instead of
 * reading them again (character-detail-loader.ts `warmed`).
 *
 * Only a V the page asked for last is read, only when the host already has it, and whatever the page didn't take within
 * `WARM_KEEP_MS` is let go (its bitmaps closed), so a V that changed meanwhile costs a few seconds of reading at most; when the page asks
 * for another V, it is let go at once (PREV-199), so the stale V's bitmaps are never held beside the real one's. What is read ahead
 * follows the loader's budgets: the maps its texel budget would decode (`plannedReads`), and at most its byte budget; the load counts
 * what it takes against its own budget as if it had read it. Nothing here decides what V is shown: the character context does, as before.
 */
import { cpuReadFiles, cpuReadSize, decodeDetailTexture, fetchDetailFile, parseDetailGeometry, plannedReads, readCharacterRecord,
  type CharacterDetailFetch, type DecodedTexture, type ParsedGeometry, type WarmedFiles } from "../render/character-detail-loader";
import { CHARACTER_WARM_HEADER, parseCharacterRequest, type CharacterRequest } from "../character-detail-request";

/** How long files read ahead wait to be taken before they are let go. */
export const WARM_KEEP_MS = 20_000;
/** How many files are read ahead at once (the page has six connections to its host, and the head's files come first). */
const WARM_CONCURRENCY = 3;
/** The bytes read ahead at most (the loader's own budget for one V). */
const WARM_MAX_BYTES = 256 * 1024 * 1024;
const CHARACTER_DETAIL_ENDPOINT = "/api/preview-character";
const storageKey = (verification: boolean) => `xfs:character:last-request:${verification ? "verification" : "workspace"}`;

export type CharacterWarmStartOptions = {
  storage: Pick<Storage, "getItem" | "setItem">;
  verification: boolean;
  fetcher?: CharacterDetailFetch;
  signal?: AbortSignal;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};
type WarmRead<T> = { promise: Promise<T>; life: AbortController; signal: AbortSignal };

export class CharacterWarmStart {
  private readonly fetcher: CharacterDetailFetch;
  private bytes = new Map<string, WarmRead<ArrayBuffer>>();
  private textures = new Map<string, WarmRead<DecodedTexture & { bytes: number }>>();
  private geometries = new Map<string, WarmRead<ParsedGeometry & { bytes: number }>>();
  private remembered: string | null = null;
  /** The request whose files are being read ahead (as `parseCharacterRequest` reads it), until they are let go. */
  private warming: string | null = null;
  private released = false;
  private readonly lifetime = new AbortController();
  private timer: unknown;
  /** What the loader takes instead of reading (each file once). */
  readonly files: WarmedFiles;
  constructor(private readonly options: CharacterWarmStartOptions) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    const take = <T>(map: Map<string, WarmRead<T>>, file: string) => { const found = map.get(file); map.delete(file); return found?.promise; };
    this.files = { bytes: file => take(this.bytes, file), texture: file => take(this.textures, file), geometry: file => take(this.geometries, file) };
    options.signal?.addEventListener("abort", () => this.release(), { once: true });
    if (options.signal?.aborted) this.release();
  }

  /** The page asked the host for this V: the next start reads it ahead. Storage that refuses is fine (the next start just doesn't). */
  remember(request: CharacterRequest): void {
    if (this.options.signal?.aborted) return;
    // The page asks for another V than the one read ahead: let it go now rather than hold both for `WARM_KEEP_MS` (PREV-199).
    if (this.warming !== null && !this.released) {
      let asked: string | null = null;
      try { asked = JSON.stringify(parseCharacterRequest(JSON.parse(JSON.stringify(request)))); } catch { /* Not one the host reads. */ }
      if (asked !== this.warming) this.release();
    }
    const text = JSON.stringify(request);
    if (text === this.remembered) return;
    this.remembered = text;
    try { this.options.storage.setItem(storageKey(this.options.verification), text); } catch { /* A convenience only. */ }
  }

  /** Read the last V's files ahead, when the host has it (never waits for a preparation). Resolves once everything is asked for. */
  async start(): Promise<void> {
    if (this.released) return;
    const signal = this.lifetime.signal;
    let request: CharacterRequest;
    try {
      const stored = this.options.storage.getItem(storageKey(this.options.verification));
      if (!stored) return;
      request = parseCharacterRequest(JSON.parse(stored));
    } catch { return; }
    this.warming = JSON.stringify(request);
    this.timer = (this.options.setTimer ?? setTimeout)(() => this.release(), WARM_KEEP_MS);
    try {
      const response = await this.fetcher(CHARACTER_DETAIL_ENDPOINT, { method: "POST", signal,
        headers: { "Content-Type": "application/json", "X-XFS-Page": "warm-start", [CHARACTER_WARM_HEADER]: "1" }, body: JSON.stringify(request) });
      if (!response.ok) return;
      const state = await response.json() as { phase?: unknown; record?: unknown };
      if (state.phase !== "ready" || typeof state.record !== "string" || !/^[a-f0-9]{64}\.json$/.test(state.record) || this.released) return;
      const record = await readCharacterRecord(state.record, this.fetcher, signal);
      if (this.released) return;
      const cpuRead = cpuReadFiles(record);
      let bytes = 0;
      // Behind the head's own files: a few at a time, each asked for at low priority, so the head's requests keep the connections.
      const queue: (() => void)[] = [];
      let running = 0;
      const slot = <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
        const go = () => {
          if (signal.aborted) { reject(signal.reason); queue.shift()?.(); return; }
          running++; work().then(resolve, reject).finally(() => { running--; queue.shift()?.(); });
        };
        if (running < WARM_CONCURRENCY) go(); else queue.push(go);
      });
      const lowPriority: CharacterDetailFetch = (url, init) => this.fetcher(url, { ...init, priority: "low" } as RequestInit);
      const fetchOnce = (resource: { file: string; sha256: string; }) => {
        let pending = this.bytes.get(resource.file);
        if (!pending) {
          const life = new AbortController(), fileSignal = this.options.signal ? AbortSignal.any([life.signal, this.options.signal]) : life.signal;
          const promise = slot(fileSignal, () => fetchDetailFile(lowPriority, resource, fileSignal)).then(buffer => {
            fileSignal.throwIfAborted();
            bytes += buffer.byteLength;
            if (bytes > WARM_MAX_BYTES) throw Error("Over the budget read ahead.");
            return buffer;
          });
          pending = { promise, life, signal: fileSignal };
          pending.promise.catch(() => { /* The load reads it again and reports it. */ });
          this.bytes.set(resource.file, pending);
        }
        return pending;
      };
      for (const { component, textures } of plannedReads(record)) {
        if (signal.aborted) break;
        for (const texture of textures) {
          if (this.textures.has(texture.file)) continue;
          const bytesOf = fetchOnce(texture);
          const signal = bytesOf.signal;
          this.bytes.delete(texture.file);
          const decoded = bytesOf.promise.then(async buffer => {
            signal.throwIfAborted();
            const bytes = buffer.byteLength;
            const decoded = await decodeDetailTexture(buffer, cpuRead.has(texture.file) ? cpuReadSize(texture) : null, cpuRead.has(texture.file), signal);
            // Browser bitmap decodes cannot be interrupted; their late return still belongs to this owner.
            if (signal.aborted) { decoded.bitmap?.close(); decoded.reduced?.close(); signal.throwIfAborted(); }
            return { ...decoded, bytes };
          });
          decoded.catch(() => { /* The load reads it again and reports it. */ });
          this.textures.set(texture.file, { ...bytesOf, promise: decoded });
        }
        if (!this.geometries.has(component.geometry.file)) {
          const bytesOf = fetchOnce(component.geometry);
          const signal = bytesOf.signal;
          this.bytes.delete(component.geometry.file);
          const parsed = bytesOf.promise.then(async buffer => { signal.throwIfAborted(); const bytes = buffer.byteLength;
            const parsed = await parseDetailGeometry(buffer, signal); signal.throwIfAborted(); return { ...parsed, bytes }; });
          parsed.catch(() => { /* The load reads it again and reports it. */ });
          this.geometries.set(component.geometry.file, { ...bytesOf, promise: parsed });
        }
        if (component.dangle) fetchOnce(component.dangle);
      }
    } catch { /* Read ahead only: the load reads everything itself. */ }
  }

  /** Let go of what the page didn't take (the V changed, or the page never asked): decoded bitmaps are closed. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.lifetime.abort();
    if (this.timer !== undefined) (this.options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = undefined;
    for (const read of this.bytes.values()) read.life.abort();
    for (const read of this.geometries.values()) read.life.abort();
    for (const read of this.textures.values()) {
      read.life.abort();
      void read.promise.then(item => { item.bitmap?.close(); item.reduced?.close(); }, () => {});
    }
    this.bytes.clear(); this.textures.clear(); this.geometries.clear();
  }
}
