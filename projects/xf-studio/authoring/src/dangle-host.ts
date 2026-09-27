/**
 * Dangle specs for the character record (hair-physics-plan.md §3.1): each drawn part whose mesh is skinned to a dangle component (the
 * planner's `dangle`, from the part's own `.app`/`.ent`) gets that component's rig and graph read by archive precedence, like every other
 * resource, compiled into a spec (dangle-spec.ts) and stored content-addressed beside the records. A CCXL pack that ships a byte-identical
 * copy of a vanilla set therefore shares one stored spec. Nothing here names a hairstyle, item or mod.
 *
 * Compiled specs are cached by content (`dangleSpecKey`): the SHA-256 of the rig's and graph's extracted bytes (the resolver's
 * `extractedSha256`, the same whichever reader answered), their depot labels and the compiler's identity. The rig and graph are still
 * loaded through the resource graph every time, so a preparation's reads (choice manifests) and the native answer ledger stay complete;
 * both roots are read natively (NATIVE-64), which takes milliseconds, and without the native reader the resolver's JSON cache answers
 * them. What the cache saves is the compile and check. A mod update that changes either file's bytes has another key.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileDangleSpec, DANGLE_COMPILER, DANGLE_LIMITS, DANGLE_SPEC, DangleSpecError, parseDangleSpec, RANGES } from "./dangle-spec";
import { writeFileAtomic } from "./derived-cache";
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

/** Everything besides the files that decides a compiled spec: the format, the compiler's revision, its limits and ranges. */
const COMPILER_IDENTITY = JSON.stringify([DANGLE_SPEC, DANGLE_COMPILER, DANGLE_LIMITS, RANGES]);
const CACHE_SCHEMA = "xfs/dangle-spec-cache-1";
const CACHE_DIR = "dangle-specs";

/**
 * The cache key of a compiled spec, or null when a file's content identity is unknown (then nothing is cached). The depot labels are
 * part of it because the spec records them.
 */
export function dangleSpecKey(rig: { sha256: string | null; label: string }, graph: { sha256: string | null; label: string } | null): string | null {
  if (!rig.sha256 || (graph && !graph.sha256)) return null;
  return createHash("sha256").update(JSON.stringify([COMPILER_IDENTITY, rig.sha256, rig.label, graph?.sha256 ?? null, graph?.label ?? ""])).digest("hex");
}

/** A compiled spec's outcome: the stored record, or the refusal (logged each time; the part's strands then follow the head). */
type Compiled = { stored: { file: string; sha256: string }; notes: string[] } | { refused: string };

function cachedOutcome(storeRoot: string, key: string): Compiled | null {
  try {
    const value = JSON.parse(readFileSync(join(storeRoot, CACHE_DIR, `${key}.json`), "utf8"));
    if (value?.schema !== CACHE_SCHEMA) return null;
    if (typeof value.refused === "string") return { refused: value.refused };
    const { file, sha256 } = value.stored ?? {};
    // The record itself must still be there (a cleared store), and named by its own hash.
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256) || file !== `${sha256}.json` || !existsSync(join(storeRoot, "records", file))) return null;
    if (!Array.isArray(value.notes) || !value.notes.every((line: unknown) => typeof line === "string")) return null;
    return { stored: { file, sha256 }, notes: value.notes.slice(0, DANGLE_LIMITS.notes) };
  } catch { return null; }
}

function keepOutcome(storeRoot: string, key: string, outcome: Compiled, log: (line: string) => void): void {
  try {
    mkdirSync(join(storeRoot, CACHE_DIR), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(storeRoot, CACHE_DIR, `${key}.json`), JSON.stringify({ schema: CACHE_SCHEMA, ...outcome }));
  } catch (error) { log(`A compiled dangle spec couldn't be cached: ${(error as Error).message}`); } // Compiled again next time.
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
  // A graph that couldn't be read compiles as no graph (rigid chains with a note), so it keys as none.
  const key = dangleSpecKey({ sha256: rig.provenance.extractedSha256, label: paths.rig },
    animGraph ? { sha256: animGraph.provenance.extractedSha256, label: paths.graph } : null);
  let outcome = key ? cachedOutcome(storeRoot, key) : null;
  if (!outcome) {
    try {
      const spec = compileDangleSpec(rig.root, animGraph?.root ?? null, paths);
      // Only what the browser reads back whole is stored (PREV-139): a refusal is logged here with its reason, not met later in the browser.
      parseDangleSpec(spec);
      outcome = { stored: storeRecordJson(storeRoot, spec), notes: spec.notes };
    } catch (error) {
      if (!(error instanceof DangleSpecError)) throw error;
      outcome = { refused: error.message };
    }
    if (key) keepOutcome(storeRoot, key, outcome, log);
  }
  if ("refused" in outcome) {
    log(`${dangle.component} dangle: ${outcome.refused}`);
    return { entry: null, notes: [`Its ${dangle.component} rig couldn't be interpreted, so its strands follow the head.`] };
  }
  return { entry: { component: dangle.component.slice(0, 255), rig: paths.rig, graph: paths.graph || paths.rig, ...outcome.stored }, notes: outcome.notes };
}
