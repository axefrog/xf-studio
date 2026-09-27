/**
 * Dangle specs for the character record (hair-physics-plan.md §3.1): each drawn part whose mesh is skinned to a dangle component (the
 * planner's `dangle`, from the part's own `.app`/`.ent`) gets that component's rig and graph read by archive precedence, like every other
 * resource, compiled into a spec (dangle-spec.ts) and stored content-addressed beside the records. A CCXL pack that ships a byte-identical
 * copy of a vanilla set therefore shares one stored spec. Nothing here names a hairstyle, item or mod.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileDangleSpec, DangleSpecError } from "./dangle-spec";
import { refLabel } from "./depot-path";
import type { PlannedComponent } from "./character-detail-plan";
import type { RenderDangle } from "./render-detail";
import type { ResourceGraph } from "./resource-graph";

/** Store a JSON document by content in `<store>/records/` (the asset route serves it by name). */
export function storeRecordJson(storeRoot: string, value: unknown): { file: string; sha256: string } {
  const bytes = new TextEncoder().encode(JSON.stringify(value)), sha256 = createHash("sha256").update(bytes).digest("hex"), file = `${sha256}.json`;
  const target = join(storeRoot, "records", file);
  if (!existsSync(target)) {
    mkdirSync(join(storeRoot, "records"), { recursive: true, mode: 0o700 });
    const staging = `${target}.${process.pid}.tmp`;
    writeFileSync(staging, bytes, { mode: 0o600 });
    renameSync(staging, target);
  }
  return { file, sha256 };
}

/**
 * The record entry for one part's dangle component, and plain notes when it can't be simulated (the chains then follow their rig
 * parents rigidly). Null when not even its rig can be read: the part's joints then follow V's skeleton as before.
 */
export async function serveDangle(graph: ResourceGraph, dangle: NonNullable<PlannedComponent["dangle"]>, storeRoot: string, log: (line: string) => void):
  Promise<{ entry: RenderDangle | null; notes: string[] }> {
  const [rig, animGraph] = await Promise.all([graph.load(dangle.rig.ref, "rig"), dangle.graph ? graph.load(dangle.graph.ref, "animgraph") : Promise.resolve(null)]);
  const paths = { rig: refLabel(dangle.rig.ref), graph: dangle.graph ? refLabel(dangle.graph.ref) : "" };
  if (!rig) return { entry: null, notes: [`Its ${dangle.component} rig couldn't be read, so its strands follow the head.`] };
  try {
    const spec = compileDangleSpec(rig.root, animGraph?.root ?? null, paths);
    const stored = storeRecordJson(storeRoot, spec);
    return { entry: { component: dangle.component.slice(0, 255), rig: paths.rig, graph: paths.graph || paths.rig, ...stored }, notes: spec.notes };
  } catch (error) {
    if (!(error instanceof DangleSpecError)) throw error;
    log(`${dangle.component} dangle: ${error.message}`);
    return { entry: null, notes: [`Its ${dangle.component} rig couldn't be interpreted, so its strands follow the head.`] };
  }
}
