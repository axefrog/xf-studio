// The staged bridge's config.ini, read and changed by key ("overlay.enabled"), for the session runner's config.set.
//
// Edits keep the file as it is (comments, order, line endings) and change only the value after "key =". The first
// change keeps a backup of the original bytes in the report folder; restore() puts them back at the end of the run,
// unless someone else changed the file since our last write (then it leaves it alone and says so).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type IniValues = Record<string, string>;

/** Every "section.key" -> value in the file (keys outside a section are ".key"). Comment lines are skipped. */
export function readIni(text: string): IniValues {
  const out: IniValues = {};
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const head = /^\[([^\]]+)\]$/.exec(trimmed);
    if (head) { section = head[1].trim(); continue; }
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (pair && !Object.hasOwn(out, `${section}.${pair[1]}`)) out[`${section}.${pair[1]}`] = pair[2].trim();
  }
  return out;
}

/** Splits "section.key" (the first dot). */
export function splitKey(name: string): { section: string; key: string } {
  const dot = name.indexOf(".");
  if (dot <= 0 || dot === name.length - 1) throw new Error(`A config key is section.key, for example overlay.enabled (got "${name}")`);
  return { section: name.slice(0, dot), key: name.slice(dot + 1) };
}

/** The text with section.key set to value: the existing line's value replaced, else a line added at the end of the section (or a new section). */
export function setIni(text: string, name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("A config value is one line");
  const { section, key } = splitKey(name);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let current = "";
  let lastInSection = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const head = /^\[([^\]]+)\]$/.exec(trimmed);
    if (head) { current = head[1].trim(); if (current === section) lastInSection = i; continue; }
    if (current !== section || !trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    lastInSection = i;
    const pair = /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/.exec(lines[i]);
    if (pair && pair[2] === key) {
      lines[i] = `${pair[1]}${pair[2]}${pair[3]}${value}`;
      return lines.join(eol);
    }
  }
  if (lastInSection >= 0) lines.splice(lastInSection + 1, 0, `${key} = ${value}`);
  else {
    while (lines.length && lines.at(-1) === "") lines.pop();
    lines.push("", `[${section}]`, `${key} = ${value}`, "");
  }
  return lines.join(eol);
}

export type ConfigChange = { key: string; from: string | undefined; to: string };

/** One config file, changed during a run and put back at its end. */
export class ConfigEditor {
  private original: Buffer | null = null;
  private lastWritten: string | null = null;
  constructor(readonly path: string, private readonly backupDir: string) {}
  exists() {
    return existsSync(this.path);
  }
  read(): IniValues {
    return readIni(readFileSync(this.path, "utf8"));
  }
  /** Sets every key; answers what changed (unchanged keys aren't written). The first real change makes the backup. */
  set(values: Record<string, string | number | boolean>): { changed: ConfigChange[]; backup?: string } {
    const before = readFileSync(this.path);
    let text = before.toString("utf8");
    const now = readIni(text);
    const changed: ConfigChange[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const to = String(raw);
      if (now[key] === to) continue;
      text = setIni(text, key, to);
      changed.push({ key, from: now[key], to });
    }
    if (!changed.length) return { changed, ...(this.original ? { backup: this.backupPath() } : {}) };
    if (!this.original) {
      this.original = before;
      mkdirSync(this.backupDir, { recursive: true });
      copyFileSync(this.path, this.backupPath());
    }
    writeFileSync(this.path, text);
    this.lastWritten = text;
    return { changed, backup: this.backupPath() };
  }
  backupPath() {
    return join(this.backupDir, "config.ini.before-session");
  }
  /** Puts the original bytes back if this run changed the file. */
  restore(): { restored: boolean; reason?: string } {
    if (!this.original) return { restored: false, reason: "unchanged by this run" };
    const current = readFileSync(this.path, "utf8");
    if (this.lastWritten !== null && current !== this.lastWritten) {
      return { restored: false, reason: `config.ini changed since the runner's last write; left as it is (the original is at ${this.backupPath()})` };
    }
    writeFileSync(this.path, this.original);
    this.original = null;
    this.lastWritten = null;
    return { restored: true };
  }
}

/** The staged bridge's config.ini inside an MO2 mod folder (or a game folder). */
export const stagedConfigPath = (modDir: string) => join(modDir, "red4ext", "plugins", "XFRuntimeBridge", "config.ini");
export const stagedManifestPath = (modDir: string) => join(modDir, "red4ext", "plugins", "XFRuntimeBridge", "manifest.json");
export const stagedDllPath = (modDir: string) => join(modDir, "red4ext", "plugins", "XFRuntimeBridge", "XFRuntimeBridge.dll");
