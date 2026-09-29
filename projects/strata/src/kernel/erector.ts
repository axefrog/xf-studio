/**
 * The erector (SPEC §10.3): a driver that consumes a graph model node and erects the live nodes it describes, keeping
 * them in step as the model changes. Models name operators from a registry, so they stay data. It delivers a node
 * whose latest entry maps each model ID to its live node.
 */
import { canonical } from "../json";
import type { Json } from "../json";
import { KNode, LATEST } from "./kernel";
import type { Demand, DemandSpec, Driver, Environment, Input, RunContext } from "./kernel";
import type { OperatorApi, Operators } from "./operators";

export type NodeRefData = { readonly $node: string };
export type NodeModel = {
  readonly id: string; readonly kind: "seed" | "combinator" | "effect" | "driver";
  readonly op?: string; readonly inputs?: readonly (string | NodeRefData)[]; readonly params?: Json; readonly initial?: Json;
  readonly demand?: DemandSpec | string;
};
/** The model format's version (SPEC §10.2); a model naming another is refused. */
export const GRAPH_MODEL_SCHEMA = "xf-strata/graph-model/1";
export type GraphModel = { readonly schema?: typeof GRAPH_MODEL_SCHEMA; readonly nodes: readonly NodeModel[] };

type Live = { model: NodeModel; node: KNode };

/** An erector for a model node: start it (`driver.start(signal)`) to erect; `nodes` is the delivered node. */
export function erector(env: Environment, model: KNode<GraphModel>, operators: Operators, options: { readonly prefix?: string; readonly name?: string } = {}):
  { readonly driver: Driver; readonly nodes: KNode<Readonly<Record<string, NodeRefData>>>; live(id: string): KNode | undefined } {
  const prefix = options.prefix ?? "";
  const live = new Map<string, Live>();
  const nodes = env.seed<Readonly<Record<string, NodeRefData>>>({ name: `${options.name ?? "erector"} nodes`, initial: {} });
  const shape = (item: NodeModel) => canonical([item.kind, item.op ?? null, item.params ?? null, item.kind === "seed" ? item.initial ?? null : null]);

  const erect = (run: RunContext, graph: GraphModel) => {
    if (graph?.schema !== undefined && graph.schema !== GRAPH_MODEL_SCHEMA) {
      env.observe(env.errors, { message: `This model is in format ${String(graph.schema)}, which this engine doesn't read.`, code: "schema" });
      return;
    }
    const apiFor = (id: string): OperatorApi => ({ id, env, run, node: modelId => live.get(modelId)?.node });
    const wanted = new Map((graph?.nodes ?? []).map(item => [item.id, item]));
    // Released: IDs gone, or whose kind, operator or parameters changed.
    for (const [id, item] of [...live]) {
      const next = wanted.get(id);
      if (next && shape(next) === shape(item.model)) continue;
      env.removeNow(item.node);
      live.delete(id);
    }
    const resolve = (ref: string | NodeRefData): KNode | undefined => typeof ref === "string" ? live.get(ref)?.node : env.node(ref.$node);
    const inputsOf = (item: NodeModel): Input[] => {
      const demand: Demand = typeof item.demand === "string" ? (resolve(item.demand) as KNode<DemandSpec> | undefined) ?? LATEST : item.demand ?? LATEST;
      return (item.inputs ?? []).map(resolve).filter((node): node is KNode => !!node).map(node => ({ node, demand }));
    };
    // Created, in model order; seeds and drivers first so every input exists.
    const order = [...wanted.values()].sort((a, b) => rank(a.kind) - rank(b.kind));
    for (const item of order) {
      if (live.has(item.id)) continue;
      const id = `${prefix}${item.id}`;
      // Every node, built-in kinds included, comes from the catalogue: there is no other way in (SPEC §10.4).
      const operator = operators[item.op ?? (item.kind === "seed" ? "seed" : "")];
      if (!operator || operator.kind !== item.kind) { env.observe(env.errors, { message: `No ${item.kind} operator named ${item.op}.`, code: "operator" }); continue; }
      const api = apiFor(item.id);
      let node: KNode;
      if (operator.kind === "seed") {
        const spec = operator.create(item.params, api);
        node = env.seed({ id, name: item.id, ...(item.initial !== undefined ? { initial: item.initial } : {}), ...(spec.activate ? { activate: spec.activate } : {}) });
      } else if (operator.kind === "driver") node = env.driver(operator.create(item.params, api), id);
      else if (operator.kind === "combinator") node = env.combinator({ id, name: item.id, inputs: [], compute: operator.create(item.params, api) });
      else node = run.effect({ id, name: item.id, inputs: [], run: operator.create(item.params, api) });
      live.set(item.id, { model: item, node });
    }
    // Wiring: every combinator and effect takes the inputs its model names.
    for (const item of order) {
      const current = live.get(item.id);
      if (!current || (item.kind !== "combinator" && item.kind !== "effect")) continue;
      const next = inputsOf(item);
      const same = next.length === current.node.inputs.length &&
        next.every((input, i) => typeof input !== "object" || !("node" in input) ? false :
          input.node === current.node.inputs[i].node && canonical(input.demand instanceof KNode ? input.demand.id : input.demand) ===
            canonical(current.node.inputs[i].demand instanceof KNode ? (current.node.inputs[i].demand as KNode).id : current.node.inputs[i].demand));
      current.model = item;
      if (!same) env.setInputsNow(current.node, next);
    }
    const delivered: Record<string, NodeRefData> = {};
    for (const [id, item] of live) delivered[id] = { $node: item.node.id };
    env.observe(nodes, delivered);
  };

  const driver = env.driver({
    name: options.name ?? "erector",
    start(run) {
      run.effect({ name: `${options.name ?? "erector"} model`, inputs: [model], run: context => {
        const graph = context.inputs[0].value as GraphModel | undefined;
        env.change(() => { if (!run.signal.aborted) erect(run, graph ?? { nodes: [] }); });
      } });
      run.signal.addEventListener("abort", () => env.change(() => {
        for (const item of live.values()) if (item.node.kind !== "effect") env.removeNow(item.node);
        live.clear();
      }));
    },
  });
  return { driver, nodes, live: id => live.get(id)?.node };
}

const rank = (kind: NodeModel["kind"]) => kind === "seed" ? 0 : kind === "driver" ? 1 : kind === "combinator" ? 2 : 3;
