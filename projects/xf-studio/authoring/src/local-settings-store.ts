import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync, fsyncSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { defaultLocalSettings, migrateLocalSettings, parseLocalSettings, type LocalSettings, type LocalSettingsDraft } from "./local-settings";

/** Caller supplies the app user-data directory in a desktop host; this is the localhost default. */
export function localSettingsDirectory(platform = process.platform, env = process.env): string {
  const home = homedir();
  if (platform === "win32") return resolve(env.LOCALAPPDATA || join(home, "AppData", "Local"), "XF Studio");
  if (platform === "darwin") return resolve(home, "Library", "Application Support", "XF Studio");
  const xdg = env.XDG_CONFIG_HOME;
  return resolve(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), "xf-studio");
}

export type SettingsLoad = { settings: LocalSettings; source: "new" | "primary" | "backup"; migrated: boolean };
export class LocalSettingsStore {
  readonly file: string;
  readonly backup: string;

  constructor(directory = localSettingsDirectory()) {
    if (!isAbsolute(directory)) throw Error("Settings directory must be absolute.");
    this.file = join(resolve(directory), "settings.json");
    this.backup = `${this.file}.previous`;
  }

  load(): SettingsLoad {
    if (!existsSync(this.file) && !existsSync(this.backup))
      return { settings: defaultLocalSettings(), source: "new", migrated: false };
    for (const [file, source] of [[this.file, "primary"], [this.backup, "backup"]] as const) {
      if (!existsSync(file)) continue;
      try {
        const result = migrateLocalSettings(JSON.parse(readFileSync(file, "utf8")));
        return { ...result, source };
      } catch { /* Try the last good document. Do not log its contents or path. */ }
    }
    throw Error("Local settings and previous-good backup are unreadable. Restore or move them before saving new settings.");
  }

  /** Optimistic revision prevents stale UI panels from replacing a newer settings edit. */
  save(draft: LocalSettingsDraft, expectedRevision: number): LocalSettings {
    const current = this.load();
    if (current.settings.revision !== expectedRevision) throw Error("Local settings changed since they were opened. Reload and retry.");
    if (current.source === "backup") throw Error("Local settings need recovery from the previous-good backup before editing.");
    const next = parseLocalSettings({ ...draft, schema: "xfs/local-settings-1", revision: expectedRevision + 1 });
    this.write(next, current.source === "primary");
    return next;
  }

  /** Explicit recovery leaves the damaged primary in place until a verified backup is loaded. */
  restorePrevious(): LocalSettings {
    if (!existsSync(this.backup)) throw Error("No previous-good local settings backup exists.");
    const restored = migrateLocalSettings(JSON.parse(readFileSync(this.backup, "utf8"))).settings;
    this.write(restored, false);
    return restored;
  }

  private write(settings: LocalSettings, backUpCurrent: boolean): void {
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.settings-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      const handle = openSync(temporary, "r+");
      try { fsyncSync(handle); } finally { closeSync(handle); }
      // Preserve the current valid file before replacement. A damaged primary is never copied over backup.
      if (backUpCurrent && existsSync(this.file)) {
        const backupTemp = join(directory, `.settings-backup-${randomUUID()}.tmp`);
        try {
          copyFileSync(this.file, backupTemp);
          const backupHandle = openSync(backupTemp, "r+");
          try { fsyncSync(backupHandle); } finally { closeSync(backupHandle); }
          renameSync(backupTemp, this.backup);
        } finally { rmSync(backupTemp, { force: true }); }
      }
      renameSync(temporary, this.file);
      // Directory fsync is supported on Unix; Windows rename has its own durable metadata semantics.
      if (process.platform !== "win32") {
        try { const handle = openSync(directory, "r"); try { fsyncSync(handle); } finally { closeSync(handle); } } catch { /* Best effort. */ }
      }
    } finally { rmSync(temporary, { force: true }); }
  }
}
