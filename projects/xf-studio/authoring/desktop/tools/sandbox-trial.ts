import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { canarySetupZip } from "../release";

// Prepares an asset-free first-run trial for Windows Sandbox: a fresh, disposable Windows
// session with no Studio data, no game, no Bun and no developer paths. The sandbox gets the
// setup ZIP read-only and one writable results folder; networking is off, so the first run
// also proves the app starts offline. Nothing is installed on the host.
//
//   bun tools/sandbox-trial.ts [setup.zip]   then open artifacts/sandbox-trial/XFStudio-first-run.wsb
//
// Windows Sandbox is an optional Windows feature; enabling it is a system change for the machine
// owner, not something this script does.

const desktop = resolve(import.meta.dir, "..");
const zip = resolve(process.argv[2] ?? canarySetupZip);
if (!existsSync(zip)) throw Error("Build the installer first (bun run build:canary) or pass a setup ZIP path.");
const root = resolve(desktop, "artifacts", "sandbox-trial");
const input = resolve(root, "input"), results = resolve(root, "results");
rmSync(root, { recursive: true, force: true });
mkdirSync(input, { recursive: true }); mkdirSync(results, { recursive: true });
copyFileSync(zip, resolve(input, basename(zip)));
const digest = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(resolve(input, "SHA256SUMS.txt"), `${digest}  ${basename(zip)}\n`);
writeFileSync(resolve(input, "first-run.ps1"), readFileSync(resolve(import.meta.dir, "sandbox-first-run.ps1")));

const sandboxHome = "C:\\Users\\WDAGUtilityAccount\\Desktop";
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
writeFileSync(resolve(root, "XFStudio-first-run.wsb"), `<Configuration>
  <Networking>Disable</Networking>
  <VGpu>Enable</VGpu>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>${sandboxHome}\\xfs-input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${xml(results)}</HostFolder><SandboxFolder>${sandboxHome}\\xfs-results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${sandboxHome}\\xfs-input\\first-run.ps1</Command>
  </LogonCommand>
</Configuration>
`);
console.log(`Prepared ${basename(zip)} (SHA-256 ${digest}).`);
console.log("Open artifacts/sandbox-trial/XFStudio-first-run.wsb; the report and screenshots land in artifacts/sandbox-trial/results/.");
