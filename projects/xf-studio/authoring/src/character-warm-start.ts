/**
 * Browser device: the V's details made ready while the head loads, after a restart (research/backlog/performance.md, warm restart).
 *
 * The page asks for its V only once the head scene is built (the head, its maps, the idle and the blink: about 1.3 s after the page
 * starts), and then fetched, verified and decoded some 80 files (about 100 MB of maps and meshes for the default V) one stage after
 * another, so V was complete about 4 s after the page started even with the host's answer kept from the last session. This device
 * remembers the last request the page asked for (in the workspace's storage, per workspace), and on the next start asks the host
 * about it at once, as a page of its own and without letting the host prepare anything (`X-XFS-Warm`: a kept or known answer, else
 * nothing). When the host has it, every file its record names is fetched, verified and decoded (maps to bitmaps off the page's thread,
 * meshes parsed a stage per task) while the head loads, within the loader's budgets; the load that shows the V takes them instead of
 * reading them again (character-detail-loader.ts `warmed`).
 *
 * Only a V the page asked for last is read, only when the host already has it, and whatever the page didn't take within
 * `WARM_KEEP_MS` is let go (its bitmaps closed), so a V that changed meanwhile costs a few seconds of reading at most. Nothing here
 * decides what V is shown: the character context does, as before.
 */
import { cpuReadFiles, cpuReadSize, decodeDetailTexture, fetchDetailFile, parseDetailGeometry, plannedReads, readCharacterRecord,
  type CharacterDetailFetch, type DecodedTexture, type ParsedGeometry, type WarmedFiles } from "./character-detail-loader";
import { CHARACTER_WARM_HEADER, parseCharacterRequest, type CharacterRequest } from "./character-detail-request";

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
  setTimer?: (run: () => void, ms: number) => unknown;
};

export class CharacterWarmStart {
  private readonly fetcher: CharacterDetailFetch;
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private textures = new Map<string, Promise<DecodedTexture>>();
  private geometries = new Map<string, Promise<ParsedGeometry>>();
  private remembered: string | null = null;
  private released = false;
  /** What the loader takes instead of reading (each file once). */
  readonly files: WarmedFiles;
  constructor(private readonly options: CharacterWarmStartOptions) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    const take = <T>(map: Map<string, Promise<T>>, file: string) => { const found = map.get(file); map.delete(file); return found; };
    this.files = { bytes: file => take(this.bytes, file), texture: file => take(this.textures, file), geometry: file => take(this.geometries, file) };
  }

  /** The page asked the host for this V: the next start reads it ahead. Storage that refuses is fine (the next start just doesn't). */
  remember(request: CharacterRequest): void {
    const text = JSON.stringify(request);
    if (text === this.remembered) return;
    this.remembered = text;
    try { this.options.storage.setItem(storageKey(this.options.verification), text); } catch { /* A convenience only. */ }
  }

  /** Read the last V's files ahead, when the host has it (never waits for a preparation). Resolves once everything is asked for. */
  async start(): Promise<void> {
    let request: CharacterRequest;
    try {
      const stored = this.options.storage.getItem(storageKey(this.options.verification));
      if (!stored) return;
      request = parseCharacterRequest(JSON.parse(stored));
    } catch { return; }
    (this.options.setTimer ?? setTimeout)(() => this.release(), WARM_KEEP_MS);
    try {
      const response = await this.fetcher(CHARACTER_DETAIL_ENDPOINT, { method: "POST",
        headers: { "Content-Type": "application/json", "X-XFS-Page": "warm-start", [CHARACTER_WARM_HEADER]: "1" }, body: JSON.stringify(request) });
      if (!response.ok) return;
      const state = await response.json() as { phase?: unknown; record?: unknown };
      if (state.phase !== "ready" || typeof state.record !== "string" || !/^[a-f0-9]{64}\.json$/.test(state.record) || this.released) return;
      const record = await readCharacterRecord(state.record, this.fetcher);
      if (this.released) return;
      const cpuRead = cpuReadFiles(record);
      let bytes = 0;
      // Behind the head's own files: a few at a time, each asked for at low priority, so the head's requests keep the connections.
      const queue: (() => void)[] = [];
      let running = 0;
      const slot = <T>(work: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
        const go = () => { running++; work().then(resolve, reject).finally(() => { running--; queue.shift()?.(); }); };
        if (running < WARM_CONCURRENCY) go(); else queue.push(go);
      });
      const lowPriority: CharacterDetailFetch = (url, init) => this.fetcher(url, { ...init, priority: "low" } as RequestInit);
      const fetchOnce = (resource: { file: string; sha256: string; }) => {
        let pending = this.bytes.get(resource.file);
        if (!pending) {
          pending = slot(() => fetchDetailFile(lowPriority, resource)).then(buffer => {
            bytes += buffer.byteLength;
            if (bytes > WARM_MAX_BYTES) throw Error("Over the budget read ahead.");
            return buffer;
          });
          pending.catch(() => { /* The load reads it again and reports it. */ });
          this.bytes.set(resource.file, pending);
        }
        return pending;
      };
      for (const { component, textures } of plannedReads(record)) {
        for (const texture of textures) {
          if (this.textures.has(texture.file)) continue;
          const bytesOf = fetchOnce(texture);
          this.bytes.delete(texture.file);
          const decoded = bytesOf.then(buffer => decodeDetailTexture(buffer, cpuRead.has(texture.file) ? cpuReadSize(texture) : null, cpuRead.has(texture.file)));
          decoded.catch(() => { /* The load reads it again and reports it. */ });
          this.textures.set(texture.file, decoded);
        }
        if (!this.geometries.has(component.geometry.file)) {
          const bytesOf = fetchOnce(component.geometry);
          this.bytes.delete(component.geometry.file);
          const parsed = bytesOf.then(parseDetailGeometry);
          parsed.catch(() => { /* The load reads it again and reports it. */ });
          this.geometries.set(component.geometry.file, parsed);
        }
        if (component.dangle) fetchOnce(component.dangle);
      }
    } catch { /* Read ahead only: the load reads everything itself. */ }
  }

  /** Let go of what the page didn't take (the V changed, or the page never asked): decoded bitmaps are closed. */
  release(): void {
    this.released = true;
    for (const decoded of this.textures.values()) void decoded.then(item => { item.bitmap?.close(); item.reduced?.close(); }, () => {});
    this.bytes.clear(); this.textures.clear(); this.geometries.clear();
  }
}
