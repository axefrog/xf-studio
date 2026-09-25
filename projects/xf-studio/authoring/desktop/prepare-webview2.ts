import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Microsoft's Evergreen WebView2 Runtime bootstrapper, packaged unmodified with the app so
// XF Studio can offer "Install it now" on a PC without the runtime. Microsoft's distribution
// guidance permits this ("download the bootstrapper and package it with your WebView2 app",
// learn.microsoft.com/microsoft-edge/webview2/concepts/distribution). It is fetched from
// Microsoft at build time, never committed, and accepted only with a valid Authenticode
// signature from Microsoft Corporation.
export const WEBVIEW2_BOOTSTRAPPER_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
export const WEBVIEW2_BOOTSTRAPPER = "MicrosoftEdgeWebview2Setup.exe";
export const webView2Folder = resolve(import.meta.dir, "webview2");

export type BootstrapperFacts = { file: string; bytes: number; sha256: string; version: string; signer: string };

/** Authenticode check through Windows PowerShell; throws unless Microsoft signed the file. */
export function verifyMicrosoftSignature(path: string): { signer: string; version: string } {
  const script = `$s = Get-AuthenticodeSignature -LiteralPath $env:XFS_VERIFY_PATH; ` +
    `[pscustomobject]@{ status = "$($s.Status)"; signer = $s.SignerCertificate.Subject; ` +
    `version = (Get-Item -LiteralPath $env:XFS_VERIFY_PATH).VersionInfo.FileVersion } | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
    // Windows PowerShell must not inherit PowerShell 7's module path, or its Security module fails to load.
    { encoding: "utf8", env: { ...process.env, PSModulePath: undefined, XFS_VERIFY_PATH: path }, windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw Error(`Cannot check the WebView2 bootstrapper signature: ${result.stderr || result.error?.message}`);
  const facts = JSON.parse(result.stdout);
  if (facts.status !== "Valid" || !/(^|, )O=Microsoft Corporation(,|$)/.test(facts.signer ?? ""))
    throw Error(`The WebView2 bootstrapper is not validly signed by Microsoft (${facts.status}; ${facts.signer}).`);
  return { signer: facts.signer, version: facts.version };
}

export function bootstrapperFacts(path = resolve(webView2Folder, WEBVIEW2_BOOTSTRAPPER)): BootstrapperFacts {
  const bytes = readFileSync(path);
  return { file: WEBVIEW2_BOOTSTRAPPER, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    ...verifyMicrosoftSignature(path) };
}

if (import.meta.main) {
  mkdirSync(webView2Folder, { recursive: true });
  const target = resolve(webView2Folder, WEBVIEW2_BOOTSTRAPPER);
  // Reuse a verified copy for a day; CI starts empty and always fetches the current one.
  const fresh = existsSync(target) && Date.now() - Bun.file(target).lastModified < 24 * 3600_000;
  if (!fresh) {
    const response = await fetch(WEBVIEW2_BOOTSTRAPPER_URL, { redirect: "follow" });
    if (!response.ok) throw Error(`Could not download the WebView2 bootstrapper from Microsoft (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 500_000 || bytes.length > 10_000_000) throw Error(`Unexpected WebView2 bootstrapper size: ${bytes.length}.`);
    const partial = target + ".partial";
    writeFileSync(partial, bytes);
    try { verifyMicrosoftSignature(partial); } catch (error) { rmSync(partial, { force: true }); throw error; }
    renameSync(partial, target);
  }
  const facts = bootstrapperFacts(target);
  writeFileSync(resolve(webView2Folder, "bootstrapper.json"), JSON.stringify(facts, null, 2) + "\n");
  console.log(`WebView2 bootstrapper ${facts.version}, ${facts.bytes} bytes, SHA-256 ${facts.sha256}; signed by Microsoft Corporation.`);
}
