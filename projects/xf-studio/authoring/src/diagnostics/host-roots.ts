/**
 * The folders and names a host redacts before anything reaches its diagnostics log, rolling window or a report (docs/diagnostics.md
 * §Privacy). The shared patterns in `tools/private-data.json` find a profile folder by shape, but a name with spaces or an OneDrive
 * folder named after an employer has no shape they can see the end of. The host knows the real ones, so it names them literally:
 *
 * - the profile folder (`os.homedir()`, `%USERPROFILE%`, `$HOME`) becomes `%USERPROFILE%` (`~` off Windows);
 * - the OneDrive folders (`%OneDrive%`, `%OneDriveCommercial%`, `%OneDriveConsumer%`) become `%OneDrive%`;
 * - the account name (`os.userInfo().username`, `%USERNAME%`) becomes `<user>` wherever it stands as a whole word;
 * - the configured folders (game, MO2 and its instance folders, manual mods, tools, caches) come from the host's provider.
 *
 * Host-only (reads the environment).
 */
import { homedir, userInfo } from "node:os";
import { textRedactor, type KnownRoot, type Redactor } from "./redact";

const attempt = <T>(read: () => T): T | null => { try { return read(); } catch { return null; } };

/** The person's own folders and account name, as this process sees them. */
export function personalRoots(env: Readonly<Record<string, string | undefined>> = process.env,
  home: string | null = attempt(homedir), user: string | null = attempt(() => userInfo().username),
  windows = process.platform === "win32"): KnownRoot[] {
  const profile = windows ? "%USERPROFILE%" : "~";
  return [
    { label: profile, path: home }, { label: profile, path: env.USERPROFILE }, { label: profile, path: env.HOME },
    { label: "%OneDrive%", path: env.OneDrive }, { label: "%OneDrive%", path: env.OneDriveCommercial },
    { label: "%OneDrive%", path: env.OneDriveConsumer },
    { label: "<user>", word: user }, { label: "<user>", word: env.USERNAME }, { label: "<user>", word: env.USER },
  ].filter(root => root.path || root.word);
}

let personal: KnownRoot[] | null = null;
/** `personalRoots()` for this process, read once. */
export const processPersonalRoots = () => personal ??= personalRoots();

/**
 * One host's redaction roots: the personal ones plus whatever the host's provider names (its configured folders). The compiled
 * redactor is kept for a few seconds, since the provider may read the settings file and every log line asks for it.
 */
export class RedactionRoots {
  private provider: () => readonly KnownRoot[] = () => [];
  private cached: { at: number; redact: Redactor } | null = null;
  constructor(private readonly personal: () => readonly KnownRoot[] = processPersonalRoots, private readonly now: () => number = Date.now) {}
  /** Name the host's configured folders (the diagnostics endpoint sets this from the settings). */
  setProvider(provider: () => readonly KnownRoot[]) { this.provider = provider; this.cached = null; }
  roots(): KnownRoot[] {
    let configured: readonly KnownRoot[] = [];
    try { configured = this.provider(); } catch { /* Personal roots alone. */ }
    return [...this.personal(), ...configured];
  }
  redactor(): Redactor {
    const at = this.now();
    if (!this.cached || at - this.cached.at > 5_000) this.cached = { at, redact: textRedactor(this.roots()) };
    return this.cached.redact;
  }
}
