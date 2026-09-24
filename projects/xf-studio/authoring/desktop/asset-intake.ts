import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

// Generated output digests from authoring/evidence/asset-manifest.json. They
// identify one known prepared preview set, not the owner's source or licence.
type CoreAssetSpec = Readonly<{ name: string; bytes: number; sha256: string }>;
const core: readonly CoreAssetSpec[] = [
  { name: "head.glb", bytes: 12299820, sha256: "72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8" },
  { name: "head-color.png", bytes: 3948529, sha256: "5f50adb99a385882ec162d1c03a29d1bd4e88011e43f06bc5c1161d99e06005a" },
  { name: "eye-color.png", bytes: 4699839, sha256: "92ecdf42807fc58554d259a3fa04914c2b8c34d0616e4c04791ae6c7344b3249" },
  { name: "head-normal.png", bytes: 5836287, sha256: "416bbfc2db339058a371229310978852e9ec73c8a0cda0ae464522537a1b2e1f" },
  { name: "head-roughness.png", bytes: 2473778, sha256: "7b6353b22e82c250c4f598669e92a14e5f682007ca50525306cdf29b3f6b08c3" },
] as const;

export type CoreAssetInspection = {
  schema: "xfs/desktop-core-assets-1";
  files: { name: string; status: "matched" | "missing" | "invalid" }[];
  ready: boolean;
  provenance: "unverified";
};

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inspectCoreAssets(folder: string, expectedFiles: readonly CoreAssetSpec[] = core): Promise<CoreAssetInspection> {
  let root: string | undefined;
  try {
    if (!lstatSync(folder).isDirectory()) throw Error("Not a directory");
    root = realpathSync(folder);
    if (root !== resolve(folder)) throw Error("Directory link");
  } catch { /* Report each missing input without exposing host filesystem details. */ }
  const files: CoreAssetInspection["files"] = [];
  for (const expected of expectedFiles) {
    const path = resolve(folder, expected.name);
    let status: "matched" | "missing" | "invalid" = "missing";
    if (root) {
      try {
        const info = lstatSync(path);
        if (info.isFile() && !info.isSymbolicLink() && realpathSync(path).startsWith(root + sep) &&
          info.size === expected.bytes && await digest(path) === expected.sha256) status = "matched";
        else status = "invalid";
      } catch { /* Missing or unreadable input. */ }
    }
    files.push({ name: expected.name, status });
  }
  return { schema: "xfs/desktop-core-assets-1", files,
    ready: files.every(file => file.status === "matched"), provenance: "unverified" };
}

export async function importCoreAssets(folder: string, dataRoot: string,
  expectedFiles: readonly CoreAssetSpec[] = core): Promise<CoreAssetInspection> {
  const destination = resolve(dataRoot, "preview-assets");
  // This first slice only installs into a fresh destination. It cannot replace
  // an existing personal tree or discard optional preview assets.
  if (existsSync(destination)) throw Error("Preview assets already exist. This intake does not replace them.");
  const checked = await inspectCoreAssets(folder, expectedFiles);
  if (!checked.ready) return checked;
  mkdirSync(dataRoot, { recursive: true });
  const staging = mkdtempSync(resolve(dataRoot, ".preview-assets-"));
  try {
    for (const expected of expectedFiles) await copyFile(resolve(folder, expected.name), resolve(staging, expected.name));
    const copied = await inspectCoreAssets(staging, expectedFiles);
    if (!copied.ready) throw Error("Copied preview files changed during intake.");
    if (existsSync(destination)) throw Error("Preview assets appeared during intake.");
    renameSync(staging, destination);
    return copied;
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
}

export async function coreAssetsReady(dataRoot: string): Promise<boolean> {
  return (await inspectCoreAssets(resolve(dataRoot, "preview-assets"))).ready;
}

export async function desktopAssetIntakeRequest(request: Request, dataRoot: string): Promise<Response> {
  if (request.method !== "POST" || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return Response.json({ error: "Expected a JSON intake request." }, { status: 400 });
  let value: unknown;
  try { value = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "action,folder" ||
    !["inspect", "import"].includes(String((value as any).action)) ||
    typeof (value as any).folder !== "string" || (value as any).folder.length > 1024 ||
    !(value as any).folder)
    return Response.json({ error: "Invalid intake request." }, { status: 400 });
  const { action, folder } = value as { action: "inspect" | "import"; folder: string };
  if (!isAbsolute(folder))
    return Response.json({ error: "Choose an absolute folder path." }, { status: 400 });
  try {
    const report = action === "inspect" ? await inspectCoreAssets(folder) : await importCoreAssets(folder, dataRoot);
    return Response.json(report, { status: report.ready ? 200 : 422,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Asset intake failed." }, { status: 409 });
  }
}
