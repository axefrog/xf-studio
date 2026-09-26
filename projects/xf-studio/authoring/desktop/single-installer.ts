import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import config from "./electrobun.config";
import { INNO_SETUP } from "./inno-setup";
import { appVersion, canarySetupExe, canarySetupZip, desktopRoot, electrobunChannel } from "./release";

export { INNO_SETUP };

// Wraps Electrobun's setup ZIP into one self-contained setup executable with Inno Setup.
//
// Electrobun 2.0.1's setup program reads its payload from a hidden `.installer` folder beside it
// and fails without it, so the release used to be a ZIP that users had to extract first. The
// wrapper (installer/xf-studio-setup.iss) carries the same unmodified setup program and payload,
// unpacks them to a private temporary folder and runs Electrobun's setup, so installation,
// shortcuts, the uninstaller and data locations are exactly Electrobun's. verify-canary.ts then
// proves the executable carries those verified files byte for byte.
//
// Inno Setup is pinned to one official release, downloaded from its GitHub release and accepted
// only with the pinned SHA-256, then unpacked in Inno Setup's own portable mode (no registry,
// no uninstaller, no Start menu entries) into XFS_INNO_SETUP_HOME, or an ignored folder here.

export const setupProgramName = `${config.app.name}-Setup-${electrobunChannel}.exe`;
export const payloadMembers = [setupProgramName, `.installer/${config.app.name}-Setup-${electrobunChannel}.metadata.json`,
  `.installer/${config.app.name}-Setup-${electrobunChannel}.tar.zst`] as const;
const script = resolve(desktopRoot, "installer", "xf-studio-setup.iss");
const workRoot = resolve(desktopRoot, "artifacts", "single-installer");

export const innoSetupHome = (env = process.env) =>
  resolve(env.XFS_INNO_SETUP_HOME || resolve(desktopRoot, "installer-tools", `innosetup-${INNO_SETUP.version}`));

/**
 * Where each pre-release channel's builds start in a Windows file version's fourth part: every pre-release gets its own file version,
 * in release order, and the release itself the highest (REL-06). Each part is at most 65535.
 */
const PRERELEASE_BASE: Readonly<Record<string, number>> = Object.freeze({ alpha: 1000, beta: 2000, rc: 3000 });
const RELEASE_BUILD = 65535;
/**
 * Numeric Windows file version for a SemVer app version: 0.1.0-alpha.1 → 0.1.0.1001, 0.1.0-beta.2 → 0.1.0.2002, 0.1.0-rc.1 →
 * 0.1.0.3001, 0.1.0 → 0.1.0.65535. A pre-release this can't number distinctly (another label, or a number over 999) is refused.
 */
export const quadVersion = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match || [match[1], match[2], match[3]].some(part => Number(part) > 65535)) throw Error(`Cannot derive a Windows file version from "${version}".`);
  const prerelease = match[4];
  if (prerelease === undefined) return `${match[1]}.${match[2]}.${match[3]}.${RELEASE_BUILD}`;
  const channel = /^(alpha|beta|rc)\.(\d{1,3})$/.exec(prerelease);
  if (!channel || Number(channel[2]) < 1)
    throw Error(`Cannot derive a distinct Windows file version from "${version}": use alpha.N, beta.N or rc.N with N from 1 to 999.`);
  return `${match[1]}.${match[2]}.${match[3]}.${PRERELEASE_BASE[channel[1]!]! + Number(channel[2])}`;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The pinned compiler, downloaded and unpacked once; returns the path to ISCC.exe. */
export async function ensureInnoSetup(home = innoSetupHome()): Promise<string> {
  const iscc = resolve(home, "compiler", "ISCC.exe");
  const marker = resolve(home, "compiler", "xfs-inno-setup.json");
  try {
    const recorded = JSON.parse(readFileSync(marker, "utf8"));
    if (recorded.version === INNO_SETUP.version && recorded.sha256 === INNO_SETUP.sha256 && existsSync(iscc)) return iscc;
  } catch { /* not unpacked yet */ }
  mkdirSync(home, { recursive: true });
  const installer = resolve(home, `innosetup-${INNO_SETUP.version}.exe`);
  let bytes = existsSync(installer) ? readFileSync(installer) : null;
  if (!bytes || sha256(bytes) !== INNO_SETUP.sha256) {
    const response = await fetch(INNO_SETUP.url, { redirect: "follow" });
    if (!response.ok) throw Error(`Could not download Inno Setup ${INNO_SETUP.version} (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== INNO_SETUP.bytes || sha256(bytes) !== INNO_SETUP.sha256)
      throw Error(`The Inno Setup ${INNO_SETUP.version} download does not match its pinned SHA-256; refusing it.`);
    writeFileSync(installer + ".partial", bytes);
    renameSync(installer + ".partial", installer);
  }
  const compiler = resolve(home, "compiler");
  rmSync(compiler, { recursive: true, force: true });
  // Inno Setup's own portable mode: files only, for the current user, nothing registered.
  const run = spawnSync(installer, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/PORTABLE=1",
    "/NOICONS", `/DIR=${compiler}`], { stdio: "inherit", timeout: 300_000, windowsHide: true });
  if (run.error || run.status !== 0 || !existsSync(iscc))
    throw Error(`Could not unpack Inno Setup ${INNO_SETUP.version}: ${run.error?.message ?? `exit ${run.status}`}.`);
  writeFileSync(marker, JSON.stringify({ version: INNO_SETUP.version, sha256: INNO_SETUP.sha256, source: INNO_SETUP.url }, null, 2) + "\n");
  return iscc;
}

/** Inno Setup 6.7.x writes this setup-data marker; it names the data format (6.7.0), not the patch release. */
export const INNO_DATA_MARKER = "Inno Setup Setup Data (6.7.0)";
/** The data format the marker names, for messages (REL-06). */
export const INNO_DATA_FORMAT = "6.7.0";
/**
 * Bytes the single setup may carry besides the verified payload: Inno Setup's loader, its setup runtime, the wizard's images and
 * the compiled script, stored uncompressed (`WRAPPER_MEASURED`: a local build with 6.7.3 and this script, 26 September 2026; about
 * 2.05 MB while Setup's data was compressed). The budget leaves about 58 KB for the script's text and version to grow, not room for
 * another file (REL-04).
 */
export const WRAPPER_MEASURED = 5_241_942;
export const WRAPPER_BUDGET = 5_300_000;
/**
 * Strings of the compiled script that must read as plain text in the wrapper, proving Setup's own data is stored uncompressed
 * (InternalCompressLevel=none), so the content scan reads text rather than compressed bytes (REL-04).
 */
export const WRAPPER_PLAIN_TEXT = ["dev.axefrog.xf-studio.setup", "Ready to install XF Studio"] as const;
export type PayloadMember = Readonly<{ name: string; bytes: Uint8Array }>;

/**
 * Prove the single setup carries each verified payload file exactly once, byte for byte, and
 * nothing else beyond Inno Setup's own wrapper. Returns the wrapper bytes for the content scan.
 */
export function singleInstallerWrapper(exe: Buffer, members: readonly PayloadMember[]): Buffer {
  if (exe.subarray(0, 2).toString("latin1") !== "MZ") throw Error("The single setup is not a Windows executable.");
  if (!exe.includes(INNO_DATA_MARKER))
    throw Error(`The single setup was not built with Inno Setup ${INNO_SETUP.version} (its ${INNO_DATA_FORMAT} setup-data marker is missing).`);
  const regions = members.map(member => {
    const at = exe.indexOf(member.bytes);
    if (at < 0) throw Error(`The single setup does not carry the verified ${member.name} byte for byte.`);
    if (exe.indexOf(member.bytes, at + 1) >= 0) throw Error(`The single setup carries ${member.name} more than once.`);
    return [at, at + member.bytes.length] as const;
  }).sort((a, b) => a[0] - b[0]);
  const gaps: Buffer[] = [];
  let cursor = 0;
  for (const [start, end] of regions) {
    if (start < cursor) throw Error("The single setup's payload files overlap.");
    gaps.push(exe.subarray(cursor, start));
    cursor = end;
  }
  gaps.push(exe.subarray(cursor));
  const wrapper = Buffer.concat(gaps);
  if (wrapper.length > WRAPPER_BUDGET)
    throw Error(`The single setup carries ${wrapper.length} bytes besides the verified payload; at most ${WRAPPER_BUDGET} are expected.`);
  // The content scan reads the wrapper as text: its setup data must be stored uncompressed, or the scan proves nothing (REL-04).
  const texts = wrapperTexts(wrapper);
  const unreadable = WRAPPER_PLAIN_TEXT.filter(text => !texts.some(view => view.includes(text)));
  if (unreadable.length)
    throw Error(`The single setup's own data isn't stored as plain text (${unreadable.map(text => `"${text}"`).join(", ")} not found), so its content scan would read compressed bytes; build it with InternalCompressLevel=none.`);
  return wrapper;
}

/** The wrapper as text for the content scan: Latin-1 plus both UTF-16 alignments, as Windows programs store strings. */
export const wrapperTexts = (wrapper: Buffer) =>
  [wrapper.toString("latin1"), wrapper.toString("utf16le"), wrapper.subarray(1).toString("utf16le")];

/** Windows' bundled bsdtar reads ZIP; a GNU tar earlier on PATH cannot. */
const tarCommand = () => {
  const system = process.env.SystemRoot ? resolve(process.env.SystemRoot, "System32", "tar.exe") : "";
  return system && existsSync(system) ? system : "tar";
};

/** Build artifacts/<channel>-win-x64-XFStudio-Setup-<channel>.exe from the Electrobun setup ZIP. */
export async function buildSingleInstaller(options: { setupZip?: string; output?: string; home?: string } = {}): Promise<string> {
  const setupZip = options.setupZip ?? canarySetupZip;
  const output = options.output ?? canarySetupExe;
  if (!existsSync(setupZip)) throw Error(`Build the Electrobun setup first; ${setupZip} is missing.`);
  const iscc = await ensureInnoSetup(options.home);
  const payload = resolve(workRoot, "payload");
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });
  const unzip = spawnSync(tarCommand(), ["-xf", setupZip, "-C", payload], { encoding: "utf8" });
  if (unzip.error || unzip.status !== 0) throw Error(`Cannot unpack ${setupZip}: ${unzip.error?.message ?? unzip.stderr}`);
  for (const member of payloadMembers)
    if (!existsSync(resolve(payload, member))) throw Error(`The Electrobun setup ZIP has no ${member}.`);
  const version = appVersion().version;
  const outDir = resolve(workRoot, "out");
  const name = "setup";
  // Paths relative to the script keep build-machine folders out of the compiled installer.
  const rel = (path: string) => relative(resolve(script, ".."), path);
  const args = [`/DAppVersion=${version}`, `/DAppVersionQuad=${quadVersion(version)}`, `/DPayload=${rel(payload)}`,
    `/DSetupProgram=${setupProgramName}`, `/DOutputDir=${rel(outDir)}`, `/DOutputName=${name}`, "/Q", script];
  const compile = spawnSync(iscc, args, { encoding: "utf8", cwd: resolve(script, ".."), timeout: 600_000, windowsHide: true });
  if (compile.error || compile.status !== 0)
    throw Error(`Inno Setup could not build the single installer:\n${compile.error?.message ?? compile.stdout + compile.stderr}`);
  rmSync(output, { force: true });
  renameSync(resolve(outDir, `${name}.exe`), output);
  rmSync(workRoot, { recursive: true, force: true });
  return output;
}

if (import.meta.main) {
  const output = await buildSingleInstaller();
  const bytes = readFileSync(output);
  console.log(`Built single-file setup ${relative(desktopRoot, output)} with Inno Setup ${INNO_SETUP.version}: ${bytes.length} bytes, SHA-256 ${sha256(bytes)}.`);
}
