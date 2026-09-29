/**
 * Generates `projects/xf-studio/models/INDEX.md` from the model files: counts per kind, the engine gaps the models record
 * (`x-friction`) by capability, and per legacy module the models that replace it. Never edit INDEX.md by hand;
 * `bun tools/models-index.ts` (in `projects/xf-studio/authoring`) rewrites it, and `tests/models.test.ts` fails when it is stale.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MODELS_DIR = fileURLToPath(new URL("../../models/", import.meta.url));
export const KINDS = ["type", "source", "sink", "operator", "driver", "process", "runtime", "request", "action", "panel", "flow"] as const;
export type Kind = typeof KINDS[number];
export type Model = { readonly kind: Kind; readonly id: string; readonly owner: string; readonly summary: string;
  readonly status: "current" | "target" | "both"; readonly replaces?: readonly string[]; readonly [member: string]: unknown };
export type Friction = { readonly gap: string; readonly capability: string; readonly closes: string };

/**
 * The engine capabilities a model's `x-friction` may name, in plain words: what the engine (or its standard library) would
 * have to offer for the model to be implemented without a workaround.
 */
export const CAPABILITIES: Readonly<Record<string, string>> = {
  "reasons-for-work": "Requests that record who asked, why and for what goal, with consent carried as a reason and invalidated when its subject changes, and supersession scoped to the requester.",
  "fault-owners": "Failures as values that name who must act, suspend the work that depends on them, and select a declared fallback approach.",
  "deadlines": "Work bound to a deadline, with its own abort reason and the remaining time carried to a retry.",
  "pause-and-resume": "Pausing running background work while the person's own work runs, and resuming it afterwards.",
  "streamed-results": "Work that yields a stream of results (by reference, one at a time) beside its state.",
  "keep-after-use": "Demand that lingers for a set time after its last consumer, and results kept for a later claim with an eviction rule.",
  "per-key-nodes": "Nodes made per key on first demand and collected when no longer demanded, and recomputation throttled to at most once per interval.",
  "host-objects-per-node": "Host objects kept per tuple of nodes, counted by demand, released whole on failure, recreated after loss, with readiness published and plain synchronous queries.",
  "worker-pools": "Pools of workers or child processes: lanes sized from free memory, latest-wins queues per key, priority, cancellation into the worker, crash and idle policies.",
  "frame-timing": "Frame-coalesced demand and input, a per-frame budget ordered by focus, state integrated over frame time for exact replay, and effects aligned to frames.",
  "scheduling-rules": "Scheduling as data: one run in flight with the newest queued, quiet periods, cooperative slicing, limits per kind of work and leases between drivers.",
  "derived-outputs": "Outputs fed by derived values (not only committed entries): debounced, writing only what changed, within a size budget, with refusals observed.",
  "binary-by-reference": "Large binary data carried by content reference with a residence (page, worker, GPU, host cache, host disk) and a lifetime tied to demand and references.",
  "uncommitted-edits": "Uncommitted edits layered over a node's value, seen by its consumers at frame rate, then collapsed into one commit or dropped without trace.",
  "undo-groups": "Undo over named sets of nodes and fields, steps spanning several commits, redo cleared by any other commit in the set, bounded depth, and undo that reaches outside systems.",
  "ordered-maps": "Ordered keyed maps whose moves keep identity, with changes reported per key.",
  "unknown-data-kept": "Nodes, fields and entries from a newer build kept verbatim, read-only, never folded, and written back unchanged.",
  "original-times": "Imported entries that keep their original time apart from when they were appended.",
  "once-only-effects": "Outside effects with an idempotency key whose outcome is recorded before and after, so a crash or replay never runs them twice.",
  "cross-process-work": "Work that runs in another process (host, worker, game) observed here, resumed after the other side restarts, cancelled by asking; and derived values computed there without glitches here.",
  "live-sync": "Changes pushed between the host, the page and other windows, and nodes shared between the host's graph and the page's.",
  "separate-libraries": "Several graphs side by side on one host (the real library and the verification copy), chosen per window, with forks across them.",
  "durable-pending": "Changes not yet acknowledged by the store kept safe across a crash of the page and of the host.",
  "stamped-files": "Validity over large sets of file stamps, checked on demand with a freshness window, and caches keyed by stamp sets.",
  "paced-requests": "Request sources with pacing, bursts, retries after refusal and reconnection, and an age on every observation.",
  "short-lived-ui": "Cheap per-window state for menus, popovers, hover and tooltips: never stored, no history, collected with its element.",
  "environment-changes": "Environment facts (pixel ratio, colour scheme, free memory, GPU limits, context loss) as sources whose changes re-demand.",
};

/** The files the catalogue keeps beside its kind folders and `schema/`. */
export const CATALOGUE_FILES: readonly string[] = ["README.md", "INDEX.md", "OPEN-QUESTIONS.md", "coverage-exclusions.json"];

/**
 * What doesn't belong in the catalogue (paths relative to it): a folder that isn't a kind or `schema`, a file that isn't one of
 * `CATALOGUE_FILES`, anything in a kind folder but `<id>.json` files, and anything in `schema/` but `<name>.schema.json` files.
 * A misspelled folder or a stray file would otherwise be skipped without a word.
 */
export function catalogueStrays(dir = MODELS_DIR): string[] {
  const strays: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ((KINDS as readonly string[]).includes(entry.name) || entry.name === "schema")) {
      const suffix = entry.name === "schema" ? ".schema.json" : ".json";
      for (const inner of readdirSync(join(dir, entry.name), { withFileTypes: true }))
        if (!inner.isFile() || !inner.name.endsWith(suffix)) strays.push(`${entry.name}/${inner.name}`);
    } else if (!entry.isFile() || !CATALOGUE_FILES.includes(entry.name)) strays.push(entry.name);
  }
  return strays.sort();
}

/** Every model file, read and parsed, with where it came from. Refuses a catalogue with anything in it that isn't a model or one of its files. */
export function loadModels(dir = MODELS_DIR): { file: string; model: Model }[] {
  const strays = catalogueStrays(dir);
  if (strays.length) throw Error(`The model catalogue has files or folders it doesn't know: ${strays.join(", ")}`);
  const out: { file: string; model: Model }[] = [];
  for (const kind of KINDS) {
    let names: string[] = [];
    try { names = readdirSync(join(dir, kind)).filter(name => name.endsWith(".json")).sort(); } catch { continue; }
    for (const name of names) out.push({ file: `${kind}/${name}`, model: JSON.parse(readFileSync(join(dir, kind, name), "utf8")) as Model });
  }
  return out;
}

const frictionOf = (model: Model): Friction[] => Array.isArray(model["x-friction"]) ? model["x-friction"] as Friction[] : [];

/** INDEX.md's text for these models. */
export function renderIndex(models: readonly Model[]): string {
  const lines: string[] = [
    "# Model catalogue index",
    "",
    "Generated by `bun tools/models-index.ts` (in `projects/xf-studio/authoring`) from the model files; don't edit it by hand. The format is in [README.md](README.md).",
    "",
    "## Counts",
    "",
    "| Kind | Models | current | both | target | with `x-friction` |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  const total = { n: 0, current: 0, both: 0, target: 0, friction: 0 };
  for (const kind of KINDS) {
    const of = models.filter(model => model.kind === kind);
    const count = (status: string) => of.filter(model => model.status === status).length;
    const friction = of.filter(model => frictionOf(model).length).length;
    lines.push(`| \`${kind}\` | ${of.length} | ${count("current")} | ${count("both")} | ${count("target")} | ${friction} |`);
    total.n += of.length; total.current += count("current"); total.both += count("both"); total.target += count("target"); total.friction += friction;
  }
  lines.push(`| **all** | **${total.n}** | ${total.current} | ${total.both} | ${total.target} | ${total.friction} |`, "");

  lines.push("## Engine gaps", "", "What the models need that the engine doesn't offer yet, by capability: how many models record the gap, and what the capability would have to do.", "",
    "| Capability | Models | What it would have to do |", "|---|---:|---|");
  const byCapability = new Map<string, Set<string>>();
  for (const model of models) for (const item of frictionOf(model)) {
    const set = byCapability.get(item.capability) ?? new Set<string>();
    set.add(`${model.kind}:${model.id}`);
    byCapability.set(item.capability, set);
  }
  const ranked = Object.keys(CAPABILITIES).map(key => [key, byCapability.get(key)?.size ?? 0] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [key, count] of ranked) lines.push(`| \`${key}\` | ${count} | ${CAPABILITIES[key]} |`);
  lines.push("");

  lines.push("## Legacy modules and the models that replace them", "",
    "Paths under `projects/xf-studio/authoring/src/`. Modules the ratchets list but no model replaces are in [coverage-exclusions.json](coverage-exclusions.json).", "",
    "| Module | Replaced by |", "|---|---|");
  const byModule = new Map<string, string[]>();
  for (const model of models) for (const module of model.replaces ?? []) {
    const list = byModule.get(module) ?? [];
    list.push(`${model.kind}:${model.id}`);
    byModule.set(module, list);
  }
  for (const module of [...byModule.keys()].sort()) lines.push(`| \`${module}\` | ${byModule.get(module)!.sort().map(ref => `\`${ref}\``).join(", ")} |`);
  lines.push("");
  return lines.join("\n");
}

if (import.meta.main) {
  const text = renderIndex(loadModels().map(entry => entry.model));
  writeFileSync(join(MODELS_DIR, "INDEX.md"), text);
  console.log(`INDEX.md: ${text.split("\n").length} lines`);
}
