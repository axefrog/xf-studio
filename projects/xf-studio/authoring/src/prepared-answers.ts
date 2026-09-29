/**
 * Host adapter: the character-detail host's answers kept across restarts (research/backlog/performance.md, warm restart). A V the host
 * prepared is written to the content-addressed store (its record and files never change); what a restart lacked was knowing, without
 * resolving the V again (open 1.4–2 s, creator resource 1.4–1.9 s, resolve 2.5–3.6 s on the reference installation), that the record still
 * answers the request. An answer kept here names the request, the launch route (its settings, WolvenKit and WolvenKit's identity:
 * installation-registry.ts `installationRouteKey`), the host code that prepared it (host-code-identity.ts) and the installation it was
 * prepared from, by that installation's watch list: every folder, archive, `.xl` file, mod list and settings file its answer depends on,
 * with the stamp read when it was opened (resolver-host.ts `Installation.watch`). It is served only when every one of those stamps is
 * unchanged (read again in parallel, about 40–90 ms on the reference installation), which is the rule the installation registry reuses an
 * opened installation by, and when its record is still in the store. Anything else (a mod installed, updated, removed or reordered;
 * another route, WolvenKit or version of XF Studio; Clear) prepares again, as before.
 *
 * Only a preparation that was complete (not degraded by a failure that may not repeat) is kept, and only the most recent `KEEP`. The
 * answers live beside the choice manifests (`choices/answers/`), so Clear removes them with everything else prepared. Private host metadata
 * (the watch list holds physical paths); never served to a page.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterRequest } from "./character-detail-request";
import { choiceKey } from "./choice-manifest";
import { writeFileAtomic } from "./derived-cache";
import { canonicalJson } from "./eye-plate-recipe";
import { watchDigest, watchUnchanged } from "./installation-snapshot";
import type { WatchedPath } from "./source-discovery";

export const PREPARED_ANSWER_SCHEMA = "xfs/prepared-answer-1" as const;
/** How many stamps a kept answer's check reads at once. */
export const ANSWER_CHECK_CONCURRENCY = 1024;
/** How many answers are kept (the most recently prepared). */
export const KEEP_ANSWERS = 16;

export type PreparedAnswer = { schema: typeof PREPARED_ANSWER_SCHEMA; route: string; code: string; recordSchema: string; request: string;
  record: string; message: string; watch: string; at: number };
export type KeptAnswer = { record: string; message: string };
export type PreparedAnswersOptions = {
  /** The host code identity (host-code-identity.ts `hostCodeIdentity`). */
  code: () => Promise<string>;
  /** The record schema the host writes (a page reads only its own). */
  recordSchema: string;
  /** Whether a record is still in the store (character-detail-host.ts `filePath`). */
  recordExists: (record: string) => boolean;
  /** Reads a path's stamp now (a test seam; default `lstat`). */
  stamp?: (path: string) => Promise<string>;
  now?: () => number;
};

export class PreparedAnswers {
  constructor(private readonly root: string, private readonly options: PreparedAnswersOptions) {}

  private file(route: string, request: CharacterRequest) { return join(this.root, `${choiceKey(route, request)}.json`); }
  private watchFile(digest: string) { return join(this.root, `watch-${digest}.json`); }

  /** The kept answer for `request` on `route` while everything it was prepared from is unchanged, else null. */
  async find(route: string, request: CharacterRequest): Promise<KeptAnswer | null> {
    let answer: PreparedAnswer;
    try { answer = JSON.parse(await readFile(this.file(route, request), "utf8")) as PreparedAnswer; } catch { return null; }
    if (answer?.schema !== PREPARED_ANSWER_SCHEMA || answer.route !== route || answer.request !== canonicalJson(request)
      || answer.recordSchema !== this.options.recordSchema || answer.code !== await this.options.code()
      || typeof answer.record !== "string" || typeof answer.watch !== "string" || !this.options.recordExists(answer.record)) return null;
    let watch: WatchedPath[];
    try { watch = JSON.parse(await readFile(this.watchFile(answer.watch), "utf8")) as WatchedPath[]; } catch { return null; }
    if (!Array.isArray(watch) || !watch.length || watchDigest(watch) !== answer.watch) return null;
    // Many stamps in flight at once: the check answers a person waiting on a restart while the host is busy starting (about 45 ms idle,
    // and 80 ms rather than 240 ms with the loop four-fifths busy, at 1,024 against 64).
    return await watchUnchanged(watch, this.options.stamp, ANSWER_CHECK_CONCURRENCY) ? { record: answer.record, message: typeof answer.message === "string" ? answer.message : "" } : null;
  }

  /**
   * Keep a complete preparation's answer: its request on `route`, its record and message, and the watch list of the installation it was
   * prepared from. Advisory: a failed write only means the next start prepares again.
   */
  async remember(route: string, request: CharacterRequest, answer: KeptAnswer, watch: readonly WatchedPath[]): Promise<void> {
    if (!watch.length) return;
    try {
      const digest = watchDigest(watch), code = await this.options.code();
      mkdirSync(this.root, { recursive: true });
      const watchPath = this.watchFile(digest);
      try { statSync(watchPath); } catch { writeFileAtomic(watchPath, JSON.stringify(watch)); }
      writeFileAtomic(this.file(route, request), JSON.stringify({ schema: PREPARED_ANSWER_SCHEMA, route, code, recordSchema: this.options.recordSchema,
        request: canonicalJson(request), record: answer.record, message: answer.message, watch: digest, at: (this.options.now ?? Date.now)() } satisfies PreparedAnswer));
      this.prune();
    } catch { /* Advisory. */ }
  }

  /** Keep the most recent `KEEP_ANSWERS` answers and the watch lists they name. */
  private prune(): void {
    const answers: { path: string; at: number; watch: string }[] = [];
    let names: string[];
    try { names = readdirSync(this.root); } catch { return; }
    for (const name of names) {
      if (!/^[a-f0-9]{40}\.json$/.test(name)) continue;
      try {
        const path = join(this.root, name), answer = JSON.parse(readFileSync(path, "utf8")) as PreparedAnswer;
        answers.push({ path, at: Number(answer.at) || 0, watch: String(answer.watch) });
      } catch { rmSync(join(this.root, name), { force: true }); }
    }
    answers.sort((a, b) => b.at - a.at);
    for (const old of answers.slice(KEEP_ANSWERS)) rmSync(old.path, { force: true });
    const used = new Set(answers.slice(0, KEEP_ANSWERS).map(answer => answer.watch));
    for (const name of names) {
      const match = /^watch-([a-f0-9]{32})\.json$/.exec(name);
      if (match && !used.has(match[1]!)) rmSync(join(this.root, name), { force: true });
    }
  }
}
