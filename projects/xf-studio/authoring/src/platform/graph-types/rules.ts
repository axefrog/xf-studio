/**
 * The graph's structural conflict rules (profiles and graph design §4.1): references and layers, for every node type.
 * They are pure functions of what they read; routes are graph rewrites applied by `graph.fix`, and none deletes
 * anything. Feature rules (V, profile, mod, deployment) arrive with their slices.
 */
import { defineRule, kindAt, pathKey } from "strata";
import type { FixRoute, NodeRef, RuleContext, RuleDef } from "strata";

const OWNER = "platform";
/** At most this many "point at another node" routes; more candidates wait for a "More…" affordance (G4). */
const ROUTES = 6;

/** Routes pointing a reference at other live nodes of the target's type. */
function repoint(context: RuleContext, subject: NodeRef, path: readonly string[], target: NodeRef): FixRoute[] {
  return context.nodes(target.type).filter(ref => ref.id !== target.id && !context.trashed(ref)).slice(0, ROUTES).map(ref => ({
    id: `point-${ref.id}`, label: "Point it at another", consequence: "The reference points at the node you choose.",
    patch: [{ op: "set" as const, node: subject, path, value: ref }],
  }));
}
const removeRoute = (subject: NodeRef, path: readonly string[]): FixRoute => ({
  id: "remove", label: "Remove the reference", consequence: "Nothing is referenced here any more.", patch: [{ op: "reset", node: subject, path }],
});

/** R1: a reference points at a node in the trash. */
export const R1 = defineRule({ id: "R1", owner: OWNER, subject: "*", severity: "warning", blocks: ["edit-through-reference"],
  evaluate: (subject, context) => context.references(subject).filter(item => context.exists(item.target) && context.trashed(item.target)).map(item => ({
    key: pathKey(item.path), subjects: [subject, item.target], sentence: "This refers to something in the trash.",
    routes: [{ id: "restore", label: "Restore it", consequence: "It comes back from the trash.", recommended: true, patch: [{ op: "restore", node: item.target }] },
      ...repoint(context, subject, item.path, item.target), removeRoute(subject, item.path)],
  })) });

/** R2: a reference that derivations follow points at a node that no longer exists. */
export const R2 = defineRule({ id: "R2", owner: OWNER, subject: "*", severity: "blocking", blocks: ["derive"],
  evaluate: (subject, context) => context.references(subject).filter(item => item.follows && !context.exists(item.target)).map(item => ({
    key: pathKey(item.path), sentence: "This refers to something that no longer exists.",
    routes: [...repoint(context, subject, item.path, item.target), removeRoute(subject, item.path)],
  })) });

/** R3: derivations would walk a circle of references. */
export const R3 = defineRule({ id: "R3", owner: OWNER, subject: "*", severity: "blocking", blocks: ["derive"], evaluate: (subject, context) => {
  const cycle = context.followCycle(subject);
  if (!cycle || !cycle.some(edge => edge.from.id === subject.id)) return [];
  const subjects = [...new Map(cycle.map(edge => [edge.from.id, edge.from])).values()];
  return [{ subjects, sentence: "These refer to each other in a circle, so what they show can't be worked out.",
    routes: cycle.map((edge, index) => ({ id: `cut-${index}`, label: "Remove this reference", consequence: "The circle is broken here.",
      patch: [{ op: "reset" as const, node: edge.from, path: edge.path }] })) }];
} });

/** L1: a fork's base or a feed's source is in the trash (it still resolves). */
export const L1 = defineRule({ id: "L1", owner: OWNER, subject: "*", severity: "warning", evaluate: (subject, context) =>
  context.layers(subject).filter(layer => context.exists(layer.from) && context.trashed(layer.from)).map(layer => ({
    key: layer.from.id, subjects: [subject, layer.from], sentence: layer.role === "base" ? "This is based on something in the trash." : "This takes values from something in the trash.",
    routes: [
      { id: "restore", label: "Restore it", consequence: "It comes back from the trash.", recommended: true as const, patch: [{ op: "restore" as const, node: layer.from }] },
      { id: "detach", label: "Keep the values here", consequence: "This keeps what it shows now and stops following.", patch: [{ op: "detach" as const, node: subject }] },
      ...(layer.role === "base" ? context.nodes(subject.type).filter(ref => ref.id !== subject.id && ref.id !== layer.from.id && !context.trashed(ref))
        .slice(0, ROUTES).map(ref => ({ id: `rebase-${ref.id}`, label: "Base it on another", consequence: "It follows the node you choose instead.",
          patch: [{ op: "rebase" as const, node: subject, base: ref }] })) : []),
    ],
  })) });

/** L2: a feed names a path its type no longer has (after a type migration). */
export const L2 = defineRule({ id: "L2", owner: OWNER, subject: "*", severity: "notice", evaluate: (subject, context) => {
  const def = context.typeOf(subject.type);
  if (!def) return [];
  return context.layers(subject).filter(layer => layer.role === "feed" && layer.paths !== "*" && layer.paths.some(path => !kindAt(def, path))).map(layer => {
    const kept = (layer.paths as readonly (readonly string[])[]).filter(path => kindAt(def, path));
    const others = context.layers(subject).filter(item => item !== layer);
    return { key: layer.from.id, sentence: "This takes a value that no longer exists from another node.",
      routes: [{ id: "drop-paths", label: "Stop taking it", consequence: "The missing values are dropped from what this takes.",
        patch: [{ op: "layers" as const, node: subject, layers: kept.length ? [...others, { ...layer, paths: kept }] : others }] }] };
  });
} });

export const STRUCTURAL_RULES: readonly RuleDef[] = [R1, R2, R3, L1, L2];
