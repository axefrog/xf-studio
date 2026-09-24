// The verifier's own record of generated archive resources. Pure; independent of
// the builder's pre-pack gate (archive-inventory.ts), whose recorded artifacts it
// must reproduce exactly from the physical tree.

export interface ResourceFile { readonly path: string; readonly bytes: number; readonly sha256: string }
export interface ResourceRecord extends ResourceFile { readonly depotPathHash64: string }

const PART = /^[a-z0-9_][a-z0-9_.-]*$/;
const RESOURCE_TYPES = new Set(["app", "inkcharcustomization", "mesh", "morphtarget", "xbm"]);

/** True when a relative path is canonical: lowercase archive-safe segments, generated resource type, no hash override. */
export function canonicalResourcePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/"), name = parts[parts.length - 1];
  if (!parts.every(part => part !== "." && part !== ".." && PART.test(part) && !part.endsWith("."))) return false;
  if (/^[0-9]+\./.test(parts[0])) return false;
  const dot = name.lastIndexOf(".");
  return dot > 0 && RESOURCE_TYPES.has(name.slice(dot + 1));
}

/** WolvenKit's archive key: FNV-1a 64 over the UTF-8 backslash path, as a decimal string. */
export function archiveKey(path: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(path.split("/").join("\\"), "utf8")) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString();
}

export interface PlanResources {
  readonly mesh: string; readonly morph: string; readonly app: string; readonly customization: string;
  readonly presets: readonly { readonly textures: Record<"diffuse" | "roughness" | "metalness", string> }[];
}

export function plannedResources(plan: PlanResources): string[] {
  const paths = [plan.mesh, plan.morph, plan.app, plan.customization,
    ...plan.presets.flatMap(p => [p.textures.diffuse, p.textures.roughness, p.textures.metalness])];
  if (new Set(paths).size !== paths.length) throw new Error("Plan lists a depot path twice");
  const bad = paths.filter(path => !canonicalResourcePath(path));
  if (bad.length) throw new Error(`Plan has noncanonical depot paths: ${bad.join(", ")}`);
  return paths;
}

/** Records for a physical tree, sorted by code point; refuses noncanonical files, hash collisions and plan mismatches. */
export function resourceRecords(files: readonly ResourceFile[], plan: PlanResources): ResourceRecord[] {
  const planned = new Set(plannedResources(plan)), keys = new Map<string, string>();
  const records = files.map(file => {
    if (!canonicalResourcePath(file.path)) throw new Error(`Noncanonical generated resource: ${file.path}`);
    const key = archiveKey(file.path);
    if (keys.has(key)) throw new Error(`Archive key collision: ${keys.get(key)} and ${file.path}`);
    keys.set(key, file.path);
    return { path: file.path, bytes: file.bytes, sha256: file.sha256, depotPathHash64: key };
  });
  const present = new Set(records.map(r => r.path));
  const missing = [...planned].filter(p => !present.has(p)), extra = [...present].filter(p => !planned.has(p));
  if (missing.length || extra.length) throw new Error(`Generated resources differ from the plan; missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`);
  return records.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
