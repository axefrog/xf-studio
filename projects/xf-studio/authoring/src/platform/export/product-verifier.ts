/**
 * The product verifier (feature-module platform §6 "Pipeline", step 3): the packed archive, copied into an
 * empty private folder, hashed and unbundled there, must hold exactly the union of its features' generated
 * files (paths, lengths and SHA-256), and the `.archive.xl` beside it must be exactly the declaration merged
 * from their fragments. Each feature's own verifier then checks its subset of what this unbundled.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { ExportRefusal, type GeneratedFile, type ToolResult, type UnpackedView, type VerifierTools } from "../api/export";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ExportRefusal("package_verification_failed", `Independent verifier failed: ${message}`);
}

/** Every regular file below `root` as a generated file; a link anywhere is refused, never followed. */
export function listGeneratedFiles(root: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), info = lstatSync(path);
      if (info.isSymbolicLink()) throw new ExportRefusal("package_build_failed", `Generated tree contains a linked path: ${path}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) files.push({ path: relative(root, path).split(sep).join("/"), bytes: info.size, sha256: sha256(readFileSync(path)) });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

const same = (a: readonly GeneratedFile[], b: readonly GeneratedFile[]) => {
  const key = (files: readonly GeneratedFile[]) => JSON.stringify([...files].map(f => [f.path, f.bytes, f.sha256])
    .sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return key(a) === key(b);
};

/**
 * Verify one product's packed archive and declaration and unbundle it for the feature verifiers. `work` must be
 * empty or absent; `archiveSha256` is what the build recorded right after packing.
 */
export function verifyProductArchive(options: { readonly archive: string; readonly xl: string; readonly archiveSha256: string;
  readonly files: readonly GeneratedFile[]; readonly declaration: string; readonly features: number;
  readonly tools: VerifierTools; readonly work: string }): UnpackedView {
  const { work, tools } = options;
  ensure(tools && typeof tools.unbundle === "function", "the verifier needs its WolvenKit tools");
  ensure(!existsSync(work) || readdirSync(work).length === 0, `work directory is not empty: ${work}`);
  const copies = join(work, "archive"), unpacked = join(work, "unpacked"), logs = join(work, "logs");
  for (const dir of [copies, unpacked, logs]) mkdirSync(dir, { recursive: true });
  // Hash exactly the bytes that are unbundled and parsed.
  const archive = join(copies, basename(options.archive));
  copyFileSync(options.archive, archive);
  const data = readFileSync(archive), archiveSha256 = sha256(data);
  ensure(archiveSha256 === options.archiveSha256, "the packed archive differs from the build record");
  const xl = readFileSync(options.xl), text = xl.toString("utf8");
  ensure(text === options.declaration, "the ArchiveXL declaration is not exactly the one merged from the features' fragments");
  const run: ToolResult = tools.unbundle(archive, unpacked);
  writeFileSync(join(logs, "unbundle.log"), run.stdout + run.stderr, "utf8");
  ensure(run.exitCode === 0 && !/\bError\s*\]|Unhandled exception/.test(run.stdout + run.stderr),
    `WolvenKit unbundle failed: ${(run.stdout + run.stderr).slice(-2000)}`);
  let files: GeneratedFile[];
  try { files = listGeneratedFiles(unpacked); }
  catch (error) { return ensure(false, (error as Error).message) as never; }
  ensure(files.length === options.files.length, `unpacked ${files.length} files; expected ${options.files.length}`);
  ensure(same(files, options.files), "the unpacked members differ from the features' generated resources");
  return { root: unpacked, files, archiveSha256, archiveBytes: data.length, xl: text, xlSha256: sha256(xl), features: options.features };
}
