import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { canarySetupZip } from "../release";

// Prepares an asset-free first-run trial for Windows Sandbox: a fresh, disposable Windows
// session with no Studio data, no game, no Bun and no developer paths. The sandbox gets the
// setup ZIP read-only and one writable results folder; networking is off, so the first run
// also proves the app starts offline. Nothing is installed on the host.
//
//   bun tools/sandbox-trial.ts [setup.zip] [--network | --install-webview2 | --host-webview2] [--keep-open]
//   powershell -File tools/sandbox-launch.ps1   (starts it at a fixed 1600x1000 and waits)
//   then open artifacts/sandbox-trial/XFStudio-first-run.wsb
//
// The run is unattended: quiet install, automatic dismissal of any final installer window,
// and the sandbox shuts itself down when results are written (unless --keep-open).
// Windows Sandbox has no WebView2 Runtime. By default that shows the missing-runtime
// experience; --host-webview2 maps this machine's installed runtime read-only into the
// sandbox as a fixed-version runtime (this did not start WebView2 under Electrobun 2.0.1).
// --network turns networking on and pre-installs nothing, so the app's own "Install it now"
// prompt must get a user from setup to the editor. --install-webview2 turns networking on and runs Microsoft's signed Evergreen bootstrapper
// inside the sandbox first, which is what a user without the runtime would do.
//
// Windows Sandbox is an optional Windows feature; enabling it is a system change for the machine
// owner, not something this script does.

const desktop = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const zip = resolve(args.find(arg => !arg.startsWith("--")) ?? canarySetupZip);
const keepOpen = args.includes("--keep-open");
const installWebView2 = args.includes("--install-webview2");
// Networking on without pre-installing anything: the app's own consent prompt installs WebView2.
const network = installWebView2 || args.includes("--network");
let hostWebView2: string | undefined;
if (args.includes("--host-webview2")) {
  const base = resolve(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "EdgeWebView", "Application");
  const newest = (a: string, b: string) => a.split(".").map(Number).reduce((order, part, index) => order || part - Number(b.split(".")[index]), 0);
  const version = existsSync(base) ? readdirSync(base).filter(name => /^\d+(\.\d+){3}$/.test(name)).sort(newest).at(-1) : undefined;
  if (!version) throw Error("No installed WebView2 Runtime was found on this machine to map into the sandbox.");
  hostWebView2 = resolve(base, version);
}
if (!existsSync(zip)) throw Error("Build the installer first (bun run build:canary) or pass a setup ZIP path.");
const root = resolve(desktop, "artifacts", "sandbox-trial");
const input = resolve(root, "input"), results = resolve(root, "results");
rmSync(root, { recursive: true, force: true });
mkdirSync(input, { recursive: true }); mkdirSync(results, { recursive: true });
copyFileSync(zip, resolve(input, basename(zip)));
const digest = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(resolve(input, "SHA256SUMS.txt"), `${digest}  ${basename(zip)}\n`);
writeFileSync(resolve(input, "first-run.ps1"), readFileSync(resolve(import.meta.dir, "sandbox-first-run.ps1")));
writeFileSync(resolve(input, "sandbox-ui.ps1"), readFileSync(resolve(import.meta.dir, "sandbox-ui.ps1")));
// The committed, asset-free fixture collection that Check runs on.
copyFileSync(resolve(desktop, "../../../../experiments/005-preset-collection/editor-collection.json"), resolve(input, "fixture-collection.json"));
// Networking stays off unless the trial installs Microsoft's WebView2 Runtime inside the sandbox.
if (installWebView2) writeFileSync(resolve(input, "install-webview2.txt"), "Install the Evergreen WebView2 Runtime first.\n");

const sandboxHome = "C:\\Users\\WDAGUtilityAccount\\Desktop";
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
writeFileSync(resolve(root, "XFStudio-first-run.wsb"), `<Configuration>
  <Networking>${network ? "Enable" : "Disable"}</Networking>
  <VGpu>Enable</VGpu>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>${sandboxHome}\\xfs-input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${xml(results)}</HostFolder><SandboxFolder>${sandboxHome}\\xfs-results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>${hostWebView2 ? `
    <MappedFolder><HostFolder>${xml(hostWebView2)}</HostFolder><SandboxFolder>${sandboxHome}\\xfs-webview2</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>` : ""}
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${sandboxHome}\\xfs-input\\first-run.ps1${keepOpen ? "" : " -AutoClose"}</Command>
  </LogonCommand>
</Configuration>
`);
console.log(`Prepared ${basename(zip)} (SHA-256 ${digest}).`);
console.log(`WebView2: ${network && !installWebView2 ? "not installed; networking on so the app's own prompt can install it" : installWebView2 ? "installed from Microsoft inside the sandbox (networking on)" : hostWebView2 ? `host runtime ${hostWebView2} mapped read-only` : "none (the sandbox default)"}; ${keepOpen ? "stays open" : "shuts down when done"}.`);
console.log("Open artifacts/sandbox-trial/XFStudio-first-run.wsb; report.json, diagnostics-log.jsonl and screenshots land in artifacts/sandbox-trial/results/.");
