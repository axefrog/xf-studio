/**
 * Synthetic node types and rules for the engine's own tests and simulation: every field kind (values, keyed maps of
 * values and of maps, references that follow and that share, reference lists, entry references, identity fields that
 * are unique), a constant, an upcaster, a derivation, and rules for missing and trashed references, reference cycles
 * and trashed layer sources.
 */
import { defineRule, defineType } from "../define";
import type { RuleDef, TypeDef } from "../define";
import { pathKey } from "../paths";
import type { NodeRef } from "../types";

export const ITEM = "item";
export const GROUP = "group";

export const itemType: TypeDef = defineType({
  type: ITEM, owner: "synthetic", schema: "2",
  fields: {
    title: { kind: "value" },
    tags: { kind: "map", of: { kind: "value" } },
    meta: { kind: "map", of: { kind: "map", of: { kind: "value" } } },
    link: { kind: "ref", to: ITEM, clone: "follow", follows: true },
    others: { kind: "refs", to: [ITEM, GROUP], clone: "share" },
    pin: { kind: "entry" },
    code: { kind: "value", inherit: false, unique: true },
  },
  defaults: () => ({ title: "untitled", tags: { base: 1 } }),
  identity: ({ random }) => ({ code: `c-${random.uuid().slice(0, 8)}` }),
  constants: [{ name: "starter", label: "Starter", fields: { title: "starter", tags: { a: 1, b: 2 } } }],
  // Schema 1 called the title `name`.
  upcasters: [{ from: "1", to: "2", set: (path, value) => path[0] === "name" ? { path: ["title", ...path.slice(1)], value } : { path, value },
    state: state => ({ ...state, own: Object.fromEntries(Object.entries(state.own).map(([key, value]) => {
      const path = JSON.parse(key) as string[];
      return [path[0] === "name" ? pathKey(["title", ...path.slice(1)]) : key, value];
    })) }) }],
  derive: {
    summary: context => {
      const title = context.resolve(context.node, ["title"]);
      const link = context.resolve(context.node, ["link"]) as NodeRef | null | undefined;
      return link && context.exists(link) ? `${String(title)} > ${String(context.derived(link, "summary"))}` : String(title);
    },
  },
});

export const groupType: TypeDef = defineType({
  type: GROUP, owner: "synthetic", schema: "1",
  fields: { label: { kind: "value" }, members: { kind: "map", of: { kind: "ref", to: ITEM, clone: "share", follows: true } } },
});

export const SYNTHETIC_TYPES: readonly TypeDef[] = [itemType, groupType];

export const SYNTHETIC_RULES: readonly RuleDef[] = [
  defineRule({ id: "missing-ref", owner: "synthetic", subject: "*", severity: "warning", evaluate: (subject, context) =>
    context.references(subject).filter(item => !context.exists(item.target)).map(item => ({
      key: pathKey(item.path), sentence: `A reference points at something that no longer exists.`,
      routes: [{ id: "remove", label: "Remove the reference", consequence: "The reference is cleared.",
        patch: [{ op: "reset", node: subject, path: item.path }] }],
    })) }),
  defineRule({ id: "trashed-ref", owner: "synthetic", subject: "*", severity: "warning", evaluate: (subject, context) =>
    context.references(subject).filter(item => context.exists(item.target) && context.trashed(item.target)).map(item => ({
      key: pathKey(item.path), sentence: "A reference points at something in the trash.",
      routes: [{ id: "restore", label: "Restore it", consequence: "It comes back from the trash.", patch: [{ op: "restore", node: item.target }] }],
    })) }),
  defineRule({ id: "follow-cycle", owner: "synthetic", subject: "*", severity: "blocking", blocks: ["item.edit"], evaluate: (subject, context) => {
    const cycle = context.followCycle(subject);
    if (!cycle || !cycle.some(edge => edge.from.id === subject.id)) return [];
    const subjects = [...new Map(cycle.map(edge => [edge.from.id, edge.from])).values()];
    return [{ subjects, sentence: "These follow each other in a circle.",
      routes: cycle.map((edge, index) => ({ id: `cut-${index}`, label: "Remove this link", consequence: "The circle is broken here.",
        patch: [{ op: "reset" as const, node: edge.from, path: edge.path }] })) }];
  } }),
  defineRule({ id: "source-trashed", owner: "synthetic", subject: "*", severity: "warning", evaluate: (subject, context) =>
    context.layers(subject).filter(layer => !context.exists(layer.from) || context.trashed(layer.from)).map(layer => ({
      key: layer.from.id, sentence: "This takes values from something in the trash or gone.",
      routes: [{ id: "detach", label: "Detach", consequence: "It keeps its current values and stops following.", patch: [{ op: "detach", node: subject }] }],
    })) }),
];
