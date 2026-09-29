/**
 * Kernel behaviours stated as data: a graph model, a script and what must come out. Run by `runKernelVector` from
 * `strata/testing` (tests/data-cases.test.ts).
 */
import type { KernelVector } from "strata/testing";

const base = { nodes: [{ id: "a", kind: "seed", initial: 1 }, { id: "log", kind: "effect", op: "record", inputs: ["a"] }] };
const invalid = (nodes: unknown) => ({ model: { nodes } });

export const KERNEL_CASES: KernelVector[] = [
  {
    name: "every-kind-of-invalid-model-is-refused-whole",
    kind: "kernel",
    description: "Models that aren't objects, whose nodes aren't a list, or with a node that isn't an object, has no ID or an empty one, an ID beginning with $, an unknown kind, an operator that isn't a name, inputs that aren't model IDs or node references, a demand that is neither a spec nor a model ID, or a first entry that isn't plain data: each is refused with code model, and the graph erected before goes on working.",
    graph: base as never,
    script: [
      { model: "not a model" }, { model: null }, { model: { nodes: "none" } },
      invalid([7]), invalid([{ kind: "seed" }]), invalid([{ id: "", kind: "seed" }]), invalid([{ id: "$x", kind: "seed" }]),
      invalid([{ id: "x", kind: "process" }]), invalid([{ id: "x", kind: "seed", op: 3 }]),
      invalid([{ id: "x", kind: "combinator", op: "identity", inputs: "a" }]), invalid([{ id: "x", kind: "combinator", op: "identity", inputs: [1] }]),
      invalid([{ id: "x", kind: "combinator", op: "identity", inputs: [{ node: "a" }] }]),
      invalid([{ id: "x", kind: "combinator", op: "identity", inputs: ["a"], demand: 5 }]),
      invalid([{ id: "x", kind: "combinator", op: "identity", inputs: ["a"], demand: [] }]),
      invalid([{ id: "x", kind: "seed", initial: "\ud800" }]), invalid([null]), invalid([{ id: "x", kind: 5 }]),
      invalid([{ id: "x", kind: "combinator", op: "identity", inputs: [null] }]), invalid([{ id: "x", kind: "combinator", op: "identity", inputs: ["a"], demand: null }]),
      { observe: { a: 2 } },
    ] as never,
    expect: { errorCodes: Array(19).fill("model"), logs: { log: [[1], [2]] } },
  },
  {
    name: "a-node-whose-operator-is-missing-or-of-another-kind-is-left-out",
    kind: "kernel",
    description: "A model naming an operator the catalogue lacks, or one of another kind, erects everything else and reports each such node with code operator. A demand naming a model ID that has no node reads as latest.",
    graph: { nodes: [
      { id: "a", kind: "seed", initial: 1 },
      { id: "nope", kind: "combinator", op: "no-such-operator", inputs: ["a"] },
      { id: "wrong", kind: "combinator", op: "record", inputs: ["a"] },
      { id: "b", kind: "combinator", op: "sum", inputs: ["a"], demand: "missing", params: { add: 1 } },
      { id: "log", kind: "effect", op: "record", inputs: ["b"] },
    ] } as never,
    script: [{ observe: { a: 2 } }],
    expect: { errorCodes: ["operator", "operator"], logs: { log: [[2], [3]] }, active: { nope: false, wrong: false } },
  },
  {
    name: "a-spec-node-that-isnt-a-valid-spec-reads-as-latest",
    kind: "kernel",
    description: "A window demanded through a spec node holding something that isn't a spec reads the latest entry; once the node holds a rolling spec, the window grows with the entries appended from then on; a range with an end keeps to it; a query the producer doesn't know reads as latest.",
    graph: { nodes: [
      { id: "s", kind: "seed", initial: 1 },
      { id: "spec", kind: "seed", initial: "not a spec" },
      { id: "win", kind: "combinator", op: "collect", inputs: ["s"], demand: "spec" },
      { id: "log", kind: "effect", op: "record", inputs: ["win"] },
    ] } as never,
    script: [
      { observe: { s: 2 } },
      { observe: { spec: { rolling: { entries: 2 } } } },
      { observe: { s: 3 } }, { observe: { s: 4 } },
      { observe: { spec: { range: { from: 3, to: 3 } } } },
      { observe: { spec: { query: { anything: true } } } },
      { observe: { spec: { rolling: { entries: "two" } } } },
    ] as never,
    expect: { logs: { log: [[[1]], [[2]], [[2, 3]], [[3, 4]], [[3]], [[4]]] }, streams: { win: [[1], [2], [2, 3], [3, 4], [3], [4]] } },
  },
  {
    name: "a-child-that-finished-first-keeps-its-result-when-its-parent-ends",
    kind: "kernel",
    description: "Process p (100 ms) has a child q (30 ms) and a child r that runs longer. At 100 ms p is done: r is aborted with the reason { parent: done }, and q, already done, is left as it was.",
    graph: { nodes: [{ id: "drv", kind: "driver", op: "work", params: { processes: [{ id: "p", ms: 100, result: "p", children: [{ id: "q", ms: 30, result: "q" }, { id: "r", ms: 500, result: "r" }] }] } }] } as never,
    script: [{ start: "drv", as: "run" }, { advance: 150 }] as never,
    expect: { processes: {
      q: [{ status: "running" }, { status: "done", result: "q" }],
      r: [{ status: "running" }, { status: "aborted", reason: { parent: "done" } }],
      p: [{ status: "running" }, { status: "done", result: "p" }],
    }, tree: [{ actor: "drv", status: "running" }] },
  },
  {
    name: "a-seed-observed-twice-in-one-transaction-appends-both",
    kind: "kernel",
    description: "Two observations of one seed in a transaction are one cycle in which the seed appends two entries; a fold over its fresh entries sees both, and the consumers compute once.",
    graph: { nodes: [
      { id: "s", kind: "seed", initial: 1 },
      { id: "total", kind: "combinator", op: "scan-sum", inputs: ["s"] },
      { id: "log", kind: "effect", op: "record", inputs: ["total"] },
    ] } as never,
    script: [{ observe: { s: 2 } }, { observe: [["s", 3], ["s", 4]] }] as never,
    expect: { streams: { s: [1, 2, 3, 4], total: [1, 3, 10] }, computes: { total: 3, log: 3 } },
  },
  {
    name: "a-model-that-isnt-a-model-keeps-what-was-erected",
    kind: "kernel",
    description: "Null, a number or a list in place of the model is refused with code model; what was erected stays and goes on working.",
    graph: base as never,
    script: [{ model: null }, { model: 5 }, { model: [] }, { observe: { a: 2 } }] as never,
    expect: { errorCodes: ["model", "model", "model"], logs: { log: [[1], [2]] } },
  },
];
