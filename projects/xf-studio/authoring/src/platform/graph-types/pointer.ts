/**
 * Pointers (profiles and graph design §2.6): what a panel shows is a wiring, not a service's state. A pointer holds
 * either a fixed reference or a follow path from another pointer: `focus.v` follows `focus.view → scene → v`. Panels
 * bind to pointers (G4); G1 registers the type and resolves follow paths.
 */
import { defineType } from "strata";
import type { GraphView, NodeRef, TypeDef } from "strata";

export const POINTER = "pointer";

export const pointerType: TypeDef = defineType({
  type: POINTER, owner: "platform", schema: "1",
  fields: {
    /** A fixed target: any node. */
    target: { kind: "ref", to: "*", clone: "share" },
    /** Or: follow another pointer, then walk these reference fields from where it points. */
    from: { kind: "ref", to: POINTER, clone: "share", follows: true },
    path: { kind: "value" },
  },
});

/** Where a pointer points: its fixed target, or its follow path walked from the pointer it follows; null when unset or broken. */
export function resolvePointer(graph: Pick<GraphView, "resolve" | "exists">, pointer: NodeRef, depth = 0): NodeRef | null {
  if (depth > 16 || !graph.exists(pointer)) return null;
  const target = graph.resolve(pointer, ["target"]) as NodeRef | null | undefined;
  if (target) return graph.exists(target) ? target : null;
  const from = graph.resolve(pointer, ["from"]) as NodeRef | null | undefined;
  if (!from) return null;
  let at = resolvePointer(graph, from, depth + 1);
  const path = graph.resolve(pointer, ["path"]);
  for (const field of Array.isArray(path) ? path as string[] : []) {
    if (!at) return null;
    const next = graph.resolve(at, [field]) as NodeRef | null | undefined;
    at = next && typeof next === "object" && graph.exists(next) ? next : null;
  }
  return at;
}
