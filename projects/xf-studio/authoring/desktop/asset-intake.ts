import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";

// One recorded prepared output set. A hash match does not establish ownership.
const core = [
  { name: "head.glb", knownSha256: "72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8" },
  { name: "head-color.png", knownSha256: "5f50adb99a385882ec162d1c03a29d1bd4e88011e43f06bc5c1161d99e06005a" },
  { name: "eye-color.png", knownSha256: "92ecdf42807fc58554d259a3fa04914c2b8c34d0616e4c04791ae6c7344b3249" },
  { name: "head-normal.png", knownSha256: "416bbfc2db339058a371229310978852e9ec73c8a0cda0ae464522537a1b2e1f" },
  { name: "head-roughness.png", knownSha256: "7b6353b22e82c250c4f598669e92a14e5f682007ca50525306cdf29b3f6b08c3" },
] as const;

export type CoreAssetInspection = {
  schema: "xfs/desktop-core-assets-1";
  files: { name: string; status: "ready" | "missing" | "invalid"; matchesKnownOutput: boolean | null }[];
  ready: boolean;
  provenance: "unverified";
};

function validGlb(bytes: Buffer): boolean {
  if (bytes.length < 128 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length) return false;
  let offset = 12, json: any, binLength = 0;
  try {
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
      offset += 8;
      if (length % 4 || offset + length > bytes.length) return false;
      if (type === 0x4e4f534a && json === undefined) json = JSON.parse(bytes.toString("utf8", offset, offset + length));
      if (type === 0x004e4942) binLength += length;
      offset += length;
    }
    if (offset !== bytes.length || json?.asset?.version !== "2.0" || !Array.isArray(json.meshes) ||
      !Array.isArray(json.buffers) || !Number.isInteger(json.buffers[0]?.byteLength) ||
      json.buffers[0].byteLength > binLength || !binLength) return false;
    for (const name of ["head", "makeup_plate", "eyes"]) {
      const mesh = json.meshes.find((entry: any) => entry?.name === name);
      if (!mesh || !Array.isArray(mesh.primitives) || !mesh.primitives.some((entry: any) =>
        Number.isInteger(entry?.attributes?.POSITION))) return false;
    }
    return true;
  } catch { return false; }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngCrc(bytes: Buffer, begin: number, end: number): number {
  let value = 0xffffffff;
  for (let index = begin; index < end; index++) value = crcTable[(value ^ bytes[index]!) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validPng(bytes: Buffer): boolean {
  if (bytes.length < 70 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8, width = 0, height = 0, channels = 0, seenIhdr = false, seenEnd = false;
  const data: Buffer[] = [];
  try {
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
      const end = offset + 12 + length;
      if (end > bytes.length || pngCrc(bytes, offset + 4, offset + 8 + length) !== bytes.readUInt32BE(offset + 8 + length)) return false;
      if (type === "IHDR") {
        if (seenIhdr || offset !== 8 || length !== 13) return false;
        seenIhdr = true;
        width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
        channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[offset + 17]!] ?? 0;
        if (!channels || bytes[offset + 16] !== 8 || bytes[offset + 18] !== 0 ||
          bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0 ||
          width < 256 || width > 4096 || width !== height || (width & (width - 1)) !== 0) return false;
      } else if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
      else if (type === "IEND") { if (length || end !== bytes.length) return false; seenEnd = true; }
      offset = end;
      if (seenEnd) break;
    }
    if (!seenIhdr || !seenEnd || !data.length) return false;
    const rowBytes = width * channels + 1, expected = rowBytes * height;
    const decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
    if (decoded.length !== expected) return false;
    for (let row = 0; row < height; row++) if (decoded[row * rowBytes]! > 4) return false;
    return true;
  } catch { return false; }
}

export async function inspectCoreAssets(folder: string, includeKnownHashes = true): Promise<CoreAssetInspection> {
  let root: string | undefined;
  try {
    if (!lstatSync(folder).isDirectory()) throw Error("Not a directory");
    root = realpathSync(folder);
    if (root !== resolve(folder)) throw Error("Directory link");
  } catch { /* Report missing inputs without revealing host filesystem details. */ }
  const files: CoreAssetInspection["files"] = [];
  for (const expected of core) {
    const path = resolve(folder, expected.name);
    let status: "ready" | "missing" | "invalid" = "missing";
    let matchesKnownOutput: boolean | null = null;
    if (root) {
      try {
        const info = lstatSync(path);
        const limit = expected.name.endsWith(".glb") ? 128 * 1024 * 1024 : 80 * 1024 * 1024;
        if (info.isFile() && !info.isSymbolicLink() && realpathSync(path).startsWith(root + sep) &&
          info.size >= 70 && info.size <= limit) {
          const bytes = await readFile(path);
          if (bytes.length === info.size && (expected.name.endsWith(".glb") ? validGlb(bytes) : validPng(bytes))) {
            status = "ready";
            if (includeKnownHashes) matchesKnownOutput = createHash("sha256").update(bytes).digest("hex") === expected.knownSha256;
          } else status = "invalid";
        } else status = "invalid";
      } catch { /* Missing or unreadable input. */ }
    }
    files.push({ name: expected.name, status, matchesKnownOutput });
  }
  return { schema: "xfs/desktop-core-assets-1", files,
    ready: files.every(file => file.status === "ready"), provenance: "unverified" };
}

export async function importCoreAssets(folder: string, dataRoot: string): Promise<CoreAssetInspection> {
  const destination = resolve(dataRoot, "preview-assets");
  // Never replace an existing personal tree or discard optional preview assets.
  if (existsSync(destination)) throw Error("Preview assets already exist. This intake does not replace them.");
  const checked = await inspectCoreAssets(folder);
  if (!checked.ready) return checked;
  mkdirSync(dataRoot, { recursive: true });
  const staging = mkdtempSync(resolve(dataRoot, ".preview-assets-"));
  try {
    for (const expected of core) await copyFile(resolve(folder, expected.name), resolve(staging, expected.name));
    const copied = await inspectCoreAssets(staging);
    if (!copied.ready) throw Error("Copied preview files changed during intake.");
    if (existsSync(destination)) throw Error("Preview assets appeared during intake.");
    renameSync(staging, destination);
    return copied;
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
}

export function createCoreAssetReadiness(dataRoot: string): () => Promise<boolean> {
  const folder = resolve(dataRoot, "preview-assets");
  let previous = "", ready = false;
  return async () => {
    const fingerprint = core.map(({ name }) => {
      try {
        const stat = lstatSync(resolve(folder, name));
        return `${name}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
      } catch { return `${name}:missing`; }
    }).join("|");
    if (fingerprint !== previous) {
      ready = (await inspectCoreAssets(folder, false)).ready;
      previous = fingerprint;
    }
    return ready;
  };
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
