/**
 * XF Strata's minimal example: two node types, a fork, a feed, a conflict rule, a subscription, a small declared
 * subsystem erected by the kernel, and a seeded simulation run. Run it with `bun examples/minimal`.
 */
import { Aborter, createGraph, defineRule, defineType, erector, standardOperators, catalogue, createEnvironment } from "strata";
import type { GraphModel, NodeRef } from "strata";
import { Scheduler, seededRandom, simClock, simulate, settle } from "strata/testing";
import type { Scenario } from "strata/testing";

// Two node types: a palette with a keyed map of colours, and a swatch that references a palette.
const palette = defineType({
  type: "palette", owner: "example", schema: "1",
  fields: { name: { kind: "value" }, colours: { kind: "map", of: { kind: "value" } } },
  defaults: () => ({ colours: { ink: "#000000" } }),
});
const swatch = defineType({
  type: "swatch", owner: "example", schema: "1",
  fields: { palette: { kind: "ref", to: "palette", clone: "share", follows: true }, colour: { kind: "value" } },
});
// A rule: a swatch whose colour its palette doesn't have.
const unknownColour = defineRule({ id: "unknown-colour", owner: "example", subject: "swatch", severity: "warning", evaluate(subject, graph) {
  const target = graph.resolve(subject, ["palette"]) as NodeRef | null;
  const colour = graph.resolve(subject, ["colour"]) as string | undefined;
  const colours = target ? graph.resolve(target, ["colours"]) as Record<string, string> : {};
  return colour && !(colour in colours) ? [{ sentence: `The palette has no colour called ${colour}.` }] : [];
} });

const scheduler = new Scheduler();
const sources = { clock: simClock(scheduler), random: seededRandom("example") };
const graph = createGraph({ types: [palette, swatch], rules: [unknownColour], sources });

// A base palette, a fork that overrides one colour, and a feed taking one colour from a third palette.
const made = graph.commit([
  { op: "create", type: "palette", as: "base", name: "Base", fields: { colours: { red: "#ff0000", blue: "#0000ff" } } },
  { op: "create", type: "palette", as: "fork", from: { fork: { created: "base" } }, fields: { colours: { red: "#cc0000" } } },
  { op: "create", type: "palette", as: "extra", fields: { colours: { gold: "#ffd700", teal: "#008080" } } },
  { op: "create", type: "swatch", as: "swatch", fields: { palette: { created: "fork" }, colour: "gold" } },
]);
if (!made.ok) throw new Error(made.message);
const { base, fork, extra, swatch: sample } = made.created;
console.log("fork colours:", JSON.stringify(graph.resolve(fork, ["colours"])));
console.log("conflicts:", graph.conflicts().map(conflict => conflict.sentence));

const life = new Aborter();
graph.subscribe(fork, change => console.log("fork changed:", change.paths.map(path => path.join("."))), { signal: life.signal });
graph.commit([{ op: "feed", node: fork, from: extra, paths: [["colours", "gold"]] }]);
graph.commit([{ op: "set", node: base, path: ["colours", "blue"], value: "#0000aa" }]);
console.log("fork colours:", JSON.stringify(graph.resolve(fork, ["colours"])), "; blue comes from", graph.origin(fork, ["colours", "blue"]).via);
console.log("conflicts:", graph.conflicts().map(conflict => conflict.sentence));
life.abort();

// The kernel: a subsystem declared as data, erected, then fed an observation (a diamond computes its join once).
const env = createEnvironment({ clock: sources.clock });
const model = env.seed<GraphModel>({ initial: { nodes: [
  { id: "a", kind: "seed", initial: 1 },
  { id: "b", kind: "combinator", op: "sum", inputs: ["a"], params: { add: 1 } },
  { id: "c", kind: "combinator", op: "product", inputs: ["a", "a"] },
  { id: "d", kind: "combinator", op: "sum", inputs: ["b", "c"] },
  { id: "show", kind: "effect", op: "print", inputs: ["d"] },
] } });
const operators = catalogue(standardOperators, { print: { kind: "effect", create: () => context => console.log("d =", context.inputs[0].value) } });
const erected = erector(env, model, operators);
const kernelLife = new Aborter();
const run = erected.driver.start(kernelLife.signal);
env.observe(erected.live("a")!, 3);
console.log("the erector's run:", run.status(), "; d computed", erected.live("d")!.computes, "times");

// A seeded simulation run: random renames and colour edits, the resolution checked after every step.
type World = { graph: typeof graph; palettes: NodeRef[] };
const scenario: Scenario<World> = {
  name: "example",
  setup(seed) {
    const g = createGraph({ types: [palette, swatch], sources: { clock: simClock(new Scheduler()), random: seededRandom(seed) } });
    const result = g.commit([{ op: "create", type: "palette", as: "p", fields: { colours: { a: "#111111" } } }]);
    return { graph: g, palettes: result.ok ? [result.created.p] : [] };
  },
  actions: [
    { name: "fork", run(world, [n]) { const result = world.graph.commit([{ op: "create", type: "palette", as: "f", from: { fork: world.palettes[n % world.palettes.length] } }]); if (result.ok) world.palettes.push(result.created.f); } },
    { name: "colour", run(world, [n, m]) { world.graph.commit([{ op: "set", node: world.palettes[n % world.palettes.length], path: ["colours", `c${m % 3}`], value: `#${(m % 999).toString().padStart(6, "0")}` }]); } },
  ],
  deliver() {}, advance() {},
  check: world => world.palettes.every(ref => typeof world.graph.resolve(ref, ["colours"]) === "object") ? [] : ["resolution: a palette lost its colours"],
};
const result = await simulate(scenario, { seed: 42, steps: 100 });
await settle();
console.log("simulation:", result.ok ? "every step held" : result.failure.problems);
