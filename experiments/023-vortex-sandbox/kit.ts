// Prepares the Vortex deployment run for Windows Sandbox (see README.md). Nothing is installed on the host:
// the sandbox gets the official Vortex installer and the Cyberpunk extension release read-only, plus one
// writable results folder, and is discarded when it closes. Networking is on because Vortex's installer may
// fetch its .NET prerequisite; the sandbox's own nxm:// registration never reaches the host.
//
//   bun experiments/023-vortex-sandbox/kit.ts
//   then open experiments/023-vortex-sandbox/generated/vortex-run.wsb (the sandbox shuts down when done)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const tools = resolve(process.env.XF_TOOLS_DIR ?? "D:/Dev/tools");
const setup = resolve(tools, "vortex", "2.7.1", "vortex-setup-2.7.1.exe");
const extension = resolve(tools, "vortex-cyberpunk2077-ext", "0.12.1", "cyberpunk2077-0.12.1.7z");
const expected: Record<string, string> = {
  [setup]: "87c6b92b302490dfc76b23143d4a3702ce66d20cc3f514537702f951137472d5",
  [extension]: "fe4b2f6738fe156db40ba22a1248adfaa146c2755056437129814e51a0057f15",
};
for (const [file, digest] of Object.entries(expected)) {
  if (!existsSync(file)) throw Error(`Missing ${file}; see D:/Dev/tools/README.md for its source.`);
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== digest) throw Error(`${file} has SHA-256 ${actual}, expected ${digest}.`);
}
const root = resolve(import.meta.dir, "generated");
const input = resolve(root, "input"), results = resolve(root, "results");
rmSync(input, { recursive: true, force: true }); rmSync(results, { recursive: true, force: true });
mkdirSync(resolve(input, "cyberpunk2077-ext"), { recursive: true }); mkdirSync(results, { recursive: true });
execFileSync(process.env.SEVEN_ZIP ?? "C:/Program Files/7-Zip/7z.exe", ["x", extension, `-o${resolve(input, "cyberpunk2077-ext")}`, "-y"], { stdio: "ignore" });
copyFileSync(resolve(import.meta.dir, "run.ps1"), resolve(input, "run.ps1"));
const home = "C:\\Users\\WDAGUtilityAccount\\Desktop";
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const keepOpen = process.argv.includes("--keep-open");
writeFileSync(resolve(root, "vortex-run.wsb"), `<Configuration>
  <Networking>Enable</Networking>
  <VGpu>Enable</VGpu>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>${home}\\xfs-input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${xml(resolve(tools, "vortex", "2.7.1"))}</HostFolder><SandboxFolder>${home}\\xfs-vortex</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${xml(results)}</HostFolder><SandboxFolder>${home}\\xfs-results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${home}\\xfs-input\\run.ps1${keepOpen ? "" : " -AutoClose"}</Command>
  </LogonCommand>
</Configuration>
`);
console.log(`Prepared ${resolve(root, "vortex-run.wsb")}; results land in ${results}.`);
