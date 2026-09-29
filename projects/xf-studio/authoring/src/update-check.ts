/**
 * Checking for a newer XF Studio (release-readiness-audit.md item 22): the policy, with no network or file mechanics of its own.
 * XF Studio checks once when it starts (unless Settings turns that off) and whenever the person asks. The releases come from a
 * `ReleaseSource` adapter (`update-check-github.ts`), what was found is kept in an `UpdateCheckMemory` (`update-check-host.ts`), and
 * time comes from the caller's clock. The host runs this service; the page asks it through `update-check-actions.ts`.
 *
 * The policy:
 * - the check at start is skipped when the setting is off, runs at most once per start, and reuses what was found within the last
 *   few hours instead of asking GitHub again; its failures are silent;
 * - a manual check always asks GitHub, and says plainly what it found, including when it couldn't check;
 * - a newer version is announced by the check at start only once per start, and never again after the person skips that version.
 * Pre-releases count (XF Studio ships alphas and betas); drafts and tags that aren't versions are ignored.
 */

/** A published release, as the source reports it (drafts already left out). */
export type ReleaseInfo = { version: string; tag: string; prerelease: boolean };
/** Why a check couldn't finish; the page shows one friendly line for all of them. */
export type CheckFailure = "offline" | "rate_limited" | "unavailable";
export type ReleaseList = { ok: true; releases: ReleaseInfo[] } | { ok: false; reason: CheckFailure };
/** Lists the published releases; aborting the signal abandons the request. */
export type ReleaseSource = (signal: AbortSignal) => Promise<ReleaseList>;

/** What the host keeps between starts. */
export type UpdateCheckMemory = {
  /** When releases were last read (ms since the epoch), or when GitHub last said to wait; null before the first check. */
  checkedAt: number | null;
  /** The newest release found then. */
  latest: ReleaseInfo | null;
  /** The version the person chose to skip: the check at start stops announcing it. */
  skipped: string | null;
};
export type UpdateCheckStore = { load(): UpdateCheckMemory; save(memory: UpdateCheckMemory): void };
export const emptyUpdateCheckMemory = (): UpdateCheckMemory => ({ checkedAt: null, latest: null, skipped: null });

export const UPDATE_CHECK_SCHEMA = "xfs/update-check-1" as const;
/**
 * The answer the page receives. `result`: `newer` (a newer version is published), `current` (this is the newest), `failed` (it
 * couldn't check) or `skipped` (the check at start is turned off). `announce` says whether the check at start should show its notice.
 */
export type UpdateCheckAnswer = {
  schema: typeof UPDATE_CHECK_SCHEMA;
  installed: string;
  result: "newer" | "current" | "failed" | "skipped";
  latest: { version: string; tag: string } | null;
  reason: CheckFailure | null;
  announce: boolean;
  /** Whether the check at start runs (the Settings switch). */
  automatic: boolean;
  checkedAt: number | null;
};

/** How long what was found stays fresh for the check at start. */
export const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

// ---- Versions (SemVer 2.0.0 precedence) ----

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export type Version = { major: number; minor: number; patch: number; pre: string[] };

/** A version or a release tag (`v0.1.0-alpha.2`); null when it isn't one. Build metadata is ignored, as SemVer says. */
export function parseVersion(text: unknown): Version | null {
  if (typeof text !== "string") return null;
  const match = SEMVER.exec(text.trim());
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, pre: match[4] ? match[4].split(".") : [] };
}
/** The version's text without a `v` or build metadata. */
export const versionText = (version: Version) =>
  `${version.major}.${version.minor}.${version.patch}${version.pre.length ? `-${version.pre.join(".")}` : ""}`;

const numeric = (part: string) => /^\d+$/.test(part);
/** Negative when `a` comes before `b`: a pre-release comes before its release, and pre-release parts compare one by one. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (numeric(x) && numeric(y)) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (numeric(x) !== numeric(y)) return numeric(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The newest release whose tag is a version, or null. */
export function newestRelease(releases: readonly ReleaseInfo[]): ReleaseInfo | null {
  let best: { release: ReleaseInfo; version: Version } | null = null;
  for (const release of releases) {
    const version = parseVersion(release.tag);
    if (version && (!best || compareVersions(version, best.version) > 0)) best = { release: { ...release, version: versionText(version) }, version };
  }
  return best?.release ?? null;
}

// ---- The service ----

export type UpdateCheckOptions = {
  /** The running XF Studio's version. */
  installed: string;
  releases: ReleaseSource;
  store: UpdateCheckStore;
  now: () => number;
  /** The Settings switch: whether the check at start runs. */
  automatic: () => boolean;
  recheckMs?: number;
};

export class UpdateCheckService {
  private announced = false;
  private startedThisRun = false;
  private running: Promise<UpdateCheckAnswer> | null = null;
  constructor(private readonly options: UpdateCheckOptions) {}

  private memory(): UpdateCheckMemory {
    try { return this.options.store.load(); } catch { return emptyUpdateCheckMemory(); }
  }
  private remember(memory: UpdateCheckMemory) { try { this.options.store.save(memory); } catch { /* Kept for this run only. */ } }

  private answer(memory: UpdateCheckMemory, result: UpdateCheckAnswer["result"] | null, reason: CheckFailure | null, startup: boolean): UpdateCheckAnswer {
    const installed = parseVersion(this.options.installed);
    const latest = memory.latest ? parseVersion(memory.latest.tag) : null;
    const found = result ?? (!installed ? "failed" : !latest ? "current" : compareVersions(latest, installed) > 0 ? "newer" : "current");
    const announce = startup && found === "newer" && !this.announced && memory.latest!.version !== memory.skipped;
    if (announce) this.announced = true;
    return { schema: UPDATE_CHECK_SCHEMA, installed: this.options.installed, result: found,
      latest: memory.latest && (found === "newer" || found === "current") ? { version: memory.latest.version, tag: memory.latest.tag } : null,
      reason: found === "failed" ? reason ?? "unavailable" : null, announce, automatic: this.options.automatic(), checkedAt: memory.checkedAt };
  }

  /** The last answer, without asking GitHub (About and Help show it). */
  status(): UpdateCheckAnswer { return this.answer(this.memory(), null, null, false); }

  /** The check at start: skipped when turned off, once per run, and from memory while it's fresh. Never throws. */
  async startup(signal: AbortSignal): Promise<UpdateCheckAnswer> {
    if (!this.options.automatic()) return this.answer(this.memory(), "skipped", null, false);
    const memory = this.memory(), recheck = this.options.recheckMs ?? UPDATE_RECHECK_MS;
    const fresh = memory.checkedAt !== null && this.options.now() - memory.checkedAt < recheck && this.options.now() >= memory.checkedAt;
    if (this.startedThisRun || fresh) return this.answer(memory, null, null, true);
    this.startedThisRun = true;
    return this.ask(signal, true);
  }

  /** The person's own check: always asks GitHub (joining a check already running). */
  check(signal: AbortSignal): Promise<UpdateCheckAnswer> { return this.ask(signal, false); }

  /** Stop announcing this version at start (a newer one is announced again). */
  skip(version: string): UpdateCheckAnswer {
    const parsed = parseVersion(version);
    if (!parsed) throw Error("That isn't a version.");
    const memory = { ...this.memory(), skipped: versionText(parsed) };
    this.remember(memory);
    return this.answer(memory, null, null, false);
  }

  private ask(signal: AbortSignal, startup: boolean): Promise<UpdateCheckAnswer> {
    if (!parseVersion(this.options.installed)) return Promise.resolve(this.answer(this.memory(), "failed", "unavailable", startup));
    if (this.running) return this.running.then(answer => startup ? this.answer(this.memory(), answer.result === "failed" ? "failed" : null, answer.reason, true) : answer);
    const run = (async () => {
      let list: ReleaseList;
      try { list = await this.options.releases(signal); } catch { list = { ok: false, reason: signal.aborted ? "unavailable" : "offline" }; }
      const memory = this.memory();
      if (!list.ok) {
        // GitHub asked us to wait: the check at start leaves it for a few hours. Offline is tried again next start.
        if (list.reason === "rate_limited") this.remember({ ...memory, checkedAt: this.options.now() });
        return this.answer(memory, "failed", list.reason, startup);
      }
      const next = { ...memory, checkedAt: this.options.now(), latest: newestRelease(list.releases) };
      this.remember(next);
      return this.answer(next, null, null, startup);
    })();
    this.running = run;
    return run.finally(() => { if (this.running === run) this.running = null; });
  }
}
