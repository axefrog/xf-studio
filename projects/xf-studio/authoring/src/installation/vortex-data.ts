/** Vortex v2.9.0 cli.ts and Application.ts setupPersistence. Facts only; no host access.
 * Launch arguments override startup.json; user.multiUser in the base DB selects shared
 * storage unless the shared DB explicitly disables it. Logs are a last-run lead only.
 */
export type VortexDataSource = "process" | "shortcut" | "startup" | "shared" | "last-run-log" | "default";
export type VortexDataFolder = { readonly path: string; readonly kind: "user" | "shared" | "custom" };
export type VortexDataCandidate = VortexDataFolder & { readonly source: VortexDataSource; readonly reason: string };
export interface VortexDataFacts {
  readonly platform: "win32" | "posix";
  readonly appData?: string;
  readonly programData?: string;
  readonly processes?: readonly { readonly executable: string; readonly commandLine: string }[];
  readonly shortcuts?: readonly { readonly target: string; readonly arguments: string }[];
  readonly startupUserData?: string;
  readonly userMultiUser?: boolean;
  readonly sharedMultiUser?: boolean;
  readonly lastRunUserData?: string;
}
export interface VortexDataPaths {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  isAbsolute(path: string): boolean;
}

/** Windows argv quoting: backslashes are special only immediately before a quote. */
export function splitVortexCommandLine(text: string): string[] {
  const args: string[] = [];
  let word = "", quoted = false, started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch) && !quoted) { if (started) args.push(word); word = ""; started = false; continue; }
    started = true;
    if (ch === "\\") {
      let count = 1;
      while (text[i + 1] === "\\") { count++; i++; }
      if (text[i + 1] === '"') {
        word += "\\".repeat(Math.floor(count / 2)); i++;
        if (count % 2) word += '"'; else quoted = !quoted;
      } else word += "\\".repeat(count);
    } else if (ch === '"') {
      if (quoted && text[i + 1] === '"') { word += '"'; i++; } else quoted = !quoted;
    } else word += ch;
  }
  // An incomplete quote is not reliable launch evidence.
  if (quoted) return [];
  if (started) args.push(word);
  return args;
}

export function vortexStartupUserData(text: string): string | undefined {
  try { const value: unknown = JSON.parse(text)?.userData; return typeof value === "string" && value.length ? value : undefined; }
  catch { return undefined; }
}

/** The caller supplies only the bounded tail; partial first lines do not match. */
export function vortexLastRunUserData(tail: string): string | undefined {
  for (const line of tail.split(/\r?\n/).reverse()) {
    const match = /^(?:\S+ )?\[INFO\] (?:\[MAIN\] )?using (.+) as the storage directory[ \t]*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/** Ordered discovery leads, not a claim that separate Vortex launches have a global precedence.
 * The host still matches the deploying instance (then game path) within this order.
 */
export function resolveVortexDataFolders(facts: VortexDataFacts, paths: VortexDataPaths): VortexDataCandidate[] {
  const base = facts.appData ? paths.join(facts.appData, "Vortex") : undefined;
  const shared = facts.platform === "win32" && facts.programData && facts.userMultiUser === true && facts.sharedMultiUser !== false
    ? paths.join(facts.programData, "vortex") : undefined;
  const result: VortexDataCandidate[] = [];
  const add = (path: string | undefined, source: VortexDataSource, reason: string, kind: VortexDataFolder["kind"] = "custom") => {
    if (!path || !paths.isAbsolute(path)) return;
    path = paths.resolve(path);
    const key = (value: string) => facts.platform === "win32" ? value.toLowerCase() : value;
    if (kind === "custom") {
      if (base && paths.isAbsolute(base) && key(paths.resolve(base)) === key(path)) kind = "user";
      else if (facts.platform === "win32" && facts.programData && paths.isAbsolute(facts.programData) && key(paths.resolve(facts.programData, "vortex")) === key(path)) kind = "shared";
    }
    if (!result.some(row => key(row.path) === key(path))) result.push({ path, kind, source, reason });
  };
  const launch = (executable: string, args: readonly string[], source: "process" | "shortcut") => {
    if (!/(?:^|[\\/])vortex\.exe$/i.test(executable) || !paths.isAbsolute(executable)) return;
    // Electron children and command-line state editors aren't a running UI instance.
    if (args.some(arg => /^--(?:type|run|get|set|del)(?:=|$)/.test(arg) || ["-g", "-s"].includes(arg))) return;
    let custom: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--") break;
      if (args[i] === "--user-data") { custom = args[++i]; if (custom === undefined) return; }
      else if (args[i]!.startsWith("--user-data=")) custom = args[i]!.slice(12);
    }
    if (custom !== undefined) {
      if (!custom || custom.startsWith("--")) return;
      // setVortexPath calls Electron app.setPath, which rejects relative paths.
      add(custom, source, `${source === "process" ? "Running Vortex" : "Vortex shortcut"}: --user-data.`);
    } else if (facts.startupUserData) {
      add(facts.startupUserData, source, "Launch uses startup.json userData.");
    } else if (shared) add(shared, source, "Launch uses shared mode (base user.multiUser; shared state has no false veto).", "shared");
    else add(base, source, "Launch uses Vortex's default per-user folder.", "user");
  };
  for (const row of facts.processes ?? []) {
    const argv = splitVortexCommandLine(row.commandLine);
    if (argv.length) launch(row.executable, argv.slice(1), "process");
  }
  for (const row of facts.shortcuts ?? []) {
    const argv = splitVortexCommandLine(row.arguments);
    if (!row.arguments.trim() || argv.length) launch(row.target, argv, "shortcut");
  }
  // Never resolve relative startup paths against Studio's cwd.
  add(facts.startupUserData, "startup", "Saved startup.json userData (fallback discovery lead).");
  add(shared, "shared", "Base user.multiUser selects shared storage; shared state has no false veto.", "shared");
  add(facts.lastRunUserData, "last-run-log", "Last run's base vortex.log recorded this storage directory (historical lead).");
  add(base, "default", "Vortex's default per-user folder.", "user");
  return result;
}
