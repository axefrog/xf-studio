// `bun run build:installer`: the one command that builds the XF Studio desktop setup from this checkout, for installing it
// locally without going to GitHub. It prepares the Electrobun devkit the first time, runs the verified `build:canary` (the same
// build and `verify-canary.ts` gate CI uses) and then says where the single setup program landed and how to install it.
//
// It refuses a `.hutch` folder that is a link to another checkout (Hutch refuses one too, less plainly), and puts Windows' own
// System32 first on the build's PATH, so a GNU `tar` from Git Bash can't shadow the `tar.exe` Hutch and the gate need.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve, win32 } from "node:path";
import { canarySetupExe, desktopRoot } from "./release";

export type HutchFolder = "missing" | "folder" | "link";
export type InstallerStep = { label: string; args: readonly string[] };

/** What `.hutch` is: absent (first build in this clone), a real folder, or a link/junction into another checkout. */
export function hutchFolder(path = resolve(desktopRoot, ".hutch")): HutchFolder {
  try { const stat = lstatSync(path); return stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "folder" : "link"; }
  catch { return "missing"; }
}

/** The steps for this checkout, or the one plain reason it can't build yet. */
export function installerPlan(hutch: HutchFolder, platform: string = process.platform): { steps: InstallerStep[] } | { refusal: string } {
  if (platform !== "win32") return { refusal: "The desktop app's setup is built on Windows. Run this on a Windows PC with this checkout." };
  if (hutch === "link") return { refusal: "This checkout's desktop/.hutch is a link to another checkout, and the Electrobun build refuses that. "
    + "Remove the link itself (on Windows: cmd /c rmdir .hutch, which leaves the other checkout's folder alone), then run this again." };
  return { steps: [
    ...(hutch === "missing" ? [{ label: "Preparing the Electrobun toolchain (first build in this checkout; it downloads about 150 MB)", args: ["run", "prepare:devkit"] }] : []),
    { label: "Building and verifying the setup", args: ["run", "build:canary"] },
  ] };
}

/** PATH with Windows' System32 first, so `tar` is bsdtar (`tar.exe`), which reads `.tar.zst` and ZIP. */
export function buildPath(env: NodeJS.ProcessEnv = process.env): string {
  const system32 = win32.join(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows", "System32");
  const current = env.PATH ?? env.Path ?? "";
  return [system32, ...current.split(";").filter(entry => entry && win32.resolve(entry).toLowerCase() !== system32.toLowerCase())].join(";");
}

/** The closing message: where the setup is and the next step, in plain words. */
export function readyMessage(shown: string, bytes: number, sha256: string): string {
  return [
    "",
    `The XF Studio setup is ready: ${shown}`,
    `  ${Math.round(bytes / 1_048_576)} MB, SHA-256 ${sha256}`,
    "",
    "To install it, open that file (double-click it in Explorer), or in the browser Studio (bun start) choose",
    "Help > Get the desktop app > Install from your build. It installs for your Windows user only; no administrator rights are needed.",
    "It's an unsigned alpha: if Windows says it protected your PC, choose More info, then Run anyway.",
  ].join("\n");
}

if (import.meta.main) {
  const plan = installerPlan(hutchFolder());
  if ("refusal" in plan) { console.error(plan.refusal); process.exit(1); }
  // One PATH entry (Windows' environment is case-insensitive, but a copied object can carry both spellings).
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"));
  env.PATH = buildPath();
  for (const step of plan.steps) {
    console.log(`${step.label}…`);
    const run = spawnSync(process.execPath, step.args, { cwd: desktopRoot, env, stdio: "inherit" });
    if (run.status !== 0) {
      console.error(`\nThe build stopped at: ${step.label}. The messages above say why; fix that and run bun run build:installer again.`);
      process.exit(run.status ?? 1);
    }
  }
  const bytes = readFileSync(canarySetupExe);
  const shown = relative(resolve(desktopRoot, "..", "..", "..", ".."), canarySetupExe).replaceAll("\\", "/");
  console.log(readyMessage(shown, bytes.length, createHash("sha256").update(bytes).digest("hex")));
}
