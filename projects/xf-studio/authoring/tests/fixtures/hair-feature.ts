/**
 * A synthetic second feature module for platform tests (feature-module platform §9): a hair part of
 * strands with a colour, a per-look editor (the selected strand) and three actions. It registers
 * through the same `FeatureModule` shape as eye makeup and is composed beside it only in tests.
 */
import { STUDIO_OWNERS } from "../../src/compose/studio-registry";
import { EYE_MAKEUP } from "../../src/features/eye-makeup";
import type { DocumentModel } from "../../src/collection-workspace";
import { featureActionTable, featureId, refusal, type ActionDescriptor, type EditorCodec, type FeatureModule,
  type PartCodec } from "../../src/platform/api";
import { PartRegistry } from "../../src/platform/core/document";
import { Registry } from "../../src/platform/core/registry";
import type { StudioComposition } from "../../src/trusted-authoring-core";

export type Hair = { colour: string; strands: number[] };
export type HairEditor = { strand: number };
export type HairAction = { kind: "hair.setColour"; colour: string } | { kind: "hair.addStrand"; length: number } |
  { kind: "hair.selectStrand"; index: number };

export const HAIR_ID = featureId("hair");
export const hairCodec: PartCodec<Hair> = {
  current: "xfs/hair-part-1", accepts: ["xfs/hair-part-1"],
  parse: envelope => {
    const body = envelope.body as Hair;
    if (!body || typeof body.colour !== "string" || !Array.isArray(body.strands)) throw Error("Damaged hair.");
    return { colour: body.colour, strands: [...body.strands] };
  },
  serialize: part => ({ schema: "xfs/hair-part-1", body: part }),
  empty: () => ({ colour: "#000000", strands: [] }), starter: () => ({ colour: "#000000", strands: [1] }),
  summary: part => ({ strands: part.strands.length }), maxBytes: 100_000,
  chunks: part => [{ colour: part.colour, strands: part.strands.length }, ...part.strands],
  join: chunks => ({ colour: (chunks[0] as { colour: string }).colour, strands: chunks.slice(1) as number[] }),
};
const hairEditor: EditorCodec<HairEditor, Hair> = {
  empty: () => ({ strand: 0 }),
  parse: (value, part) => {
    const strand = (value as Partial<HairEditor> | undefined)?.strand;
    return { strand: Number.isInteger(strand) && strand! >= 0 && strand! < part.strands.length ? strand! : 0 };
  },
  serialize: value => ({ strand: value.strand }),
};
const input = (type: "string" | "number" | "integer") => ({ type, required: true, from: "input" as const });
const DESCRIPTORS: { readonly [K in HairAction["kind"]]: ActionDescriptor<"workspace"> } = {
  "hair.setColour": { scope: ["workspace"], effect: "content", undo: "part", payload: { colour: input("string") } },
  "hair.addStrand": { scope: ["workspace"], effect: "content", undo: "part", payload: { length: { ...input("number"), min: 0, max: 10 } } },
  "hair.selectStrand": { scope: ["workspace"], effect: "selection", undo: "none", payload: { index: input("integer") } },
};

export const HAIR: FeatureModule<HairAction, "workspace", typeof HAIR_ID, Hair, HairEditor> = Object.freeze({
  owner: "feature", id: HAIR_ID, api: 1, label: "Hair", stage: "dev",
  part: hairCodec, editor: hairEditor as EditorCodec<unknown, Hair>,
  actions: featureActionTable<Hair, HairEditor, HairAction, "workspace", { kind: string }>(DESCRIPTORS,
    { "hair.setColour": true, "hair.addStrand": true, "hair.selectStrand": true }, {
      capability: (state, action) => action.kind === "hair.setColour" && !/^#[0-9a-f]{6}$/i.test(action.colour)
        ? refusal("invalid_value", "Pick a colour.")
        : action.kind === "hair.selectStrand" && !state.part.strands[action.index] ? refusal("missing_target", "That strand no longer exists.")
        : { available: true },
      apply: (state, action) => {
        const { part, editor } = state;
        if (action.kind === "hair.setColour") return { part: { ...part, colour: action.colour }, editor,
          changed: part.colour !== action.colour, effect: { kind: "content" } };
        if (action.kind === "hair.addStrand") return { part: { ...part, strands: [...part.strands, action.length] },
          editor: { strand: part.strands.length }, changed: true, effect: { kind: "content" } };
        return { part, editor: { strand: action.index }, changed: editor.strand !== action.index, effect: { kind: "selection" } };
      },
      label: action => ({ label: action.kind === "hair.setColour" ? "Hair colour" : action.kind === "hair.addStrand" ? "Add strand" : "Select strand",
        actionKind: action.kind }),
    }),
});

/** The Studio's composition with the synthetic hair feature registered beside eye makeup (hair is not in `StudioOwnerActions`). */
export function withHair(): StudioComposition & { documents: DocumentModel } {
  const owners = [...STUDIO_OWNERS, HAIR];
  const parts = new PartRegistry([EYE_MAKEUP, HAIR]);
  return { registry: new Registry(owners), documents: Object.freeze({ parts, live: "eye-makeup" }) };
}
