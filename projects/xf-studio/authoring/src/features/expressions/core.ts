/**
 * The expressions feature's pure action behaviour (research/animation/expression-editor-design.md §4): capability and apply over the
 * part. Everything is decided from control names (the mirror map, pair keys, groups are name rules, engines/facial-rig/vocabulary.ts),
 * so the actions need no vocabulary: the drawer offers only the controls the head has, and a name the head lacks is kept verbatim.
 */
import { refusal, type ActionDescriptor, type Capability, type FeatureResult, type FeatureState, type HistoryLabel } from "../../platform/api";
import { controlGroup, isDirectionPair, mirrorName, pairKey, type ControlGroupId, CONTROL_GROUPS, controlSide } from "../../engines/facial-rig/vocabulary";
import { CONTROL_NAME, normaliseVector, sameVector, storedWeight, vectorIssue, withControl, type ControlVector } from "../../engines/facial-rig/vector";
import { MAX_LABEL, originIssue, type ExpressionEditor, type ExpressionOrigin, type ExpressionPart } from "./part";

export type ExpressionAction =
  | { kind: "expression.setControl"; name: string; value: number }
  | { kind: "expression.linkPair"; pair: string; linked: boolean }
  | { kind: "expression.mirror"; from: "left" | "right" }
  | { kind: "expression.reset"; scope: "all" | "group" | "control"; target?: string }
  | { kind: "expression.startFrom"; origin: ExpressionOrigin; controls: ControlVector }
  | { kind: "expression.setLabel"; label: string };
export type ExpressionScope = "workspace";
export type ExpressionEffect = { kind: "content" } | { kind: "none" };
export type ExpressionState = FeatureState<ExpressionPart, ExpressionEditor>;
export type ExpressionResult = FeatureResult<ExpressionPart, ExpressionEditor, ExpressionEffect>;

const input = <T extends ActionDescriptor["payload"][string]>(schema: Omit<T, "from">) => ({ ...schema, from: "input" as const });
export const EXPRESSION_DESCRIPTORS: { readonly [K in ExpressionAction["kind"]]: ActionDescriptor<ExpressionScope> } = Object.freeze({
  "expression.setControl": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { name: input({ type: "string", required: true, minLength: 1, maxLength: 96 }), value: input({ type: "number", required: true, min: 0, max: 1 }) } },
  "expression.linkPair": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { pair: input({ type: "string", required: true, minLength: 1, maxLength: 96 }), linked: input({ type: "boolean", required: true }) } },
  "expression.mirror": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { from: input({ type: "enum", required: true, values: ["left", "right"] }) } },
  "expression.reset": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { scope: input({ type: "enum", required: true, values: ["all", "group", "control"] }),
      target: input({ type: "string", required: false, maxLength: 96 }) } },
  "expression.startFrom": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { origin: input({ type: "object", required: true }), controls: input({ type: "object", required: true }) } },
  "expression.setLabel": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { label: input({ type: "string", required: true, maxLength: MAX_LABEL }) } },
});

/** Whether a pair edits both sides: its stored link, else linked for a mirror pair and unlinked for a direction pair. */
export function pairLinked(part: ExpressionPart, name: string): boolean {
  const pair = pairKey(name);
  if (!pair) return false;
  return part.links[pair] ?? !isDirectionPair(name);
}

const GROUP_IDS = new Set<string>(CONTROL_GROUPS.map(group => group.id));

export function expressionCapability(state: ExpressionState, action: ExpressionAction): Capability {
  switch (action.kind) {
    case "expression.setControl":
      if (typeof action.name !== "string" || !CONTROL_NAME.test(action.name)) return refusal("invalid_value", "That isn't a face control.");
      if (typeof action.value !== "number" || !Number.isFinite(action.value) || action.value < 0 || action.value > 1)
        return refusal("invalid_value", "A control's weight is from 0 to 1.");
      return { available: true };
    case "expression.linkPair":
      return typeof action.pair === "string" && CONTROL_NAME.test(action.pair) && typeof action.linked === "boolean"
        ? { available: true } : refusal("invalid_value", "That isn't a left and right pair.");
    case "expression.mirror":
      return action.from === "left" || action.from === "right" ? { available: true } : refusal("invalid_value", "Mirror from the left or the right.");
    case "expression.reset":
      if (action.scope === "all") return { available: true };
      if (action.scope === "group") return typeof action.target === "string" && GROUP_IDS.has(action.target)
        ? { available: true } : refusal("invalid_value", "That isn't a group of face controls.");
      if (action.scope === "control") return typeof action.target === "string" && CONTROL_NAME.test(action.target)
        ? { available: true } : refusal("invalid_value", "That isn't a face control.");
      return refusal("invalid_value", "Reset everything, a group or one control.");
    case "expression.startFrom": {
      const bad = originIssue(action.origin) ?? vectorIssue(action.controls);
      return bad ? refusal("invalid_value", bad) : { available: true };
    }
    case "expression.setLabel":
      return typeof action.label === "string" && action.label.length <= MAX_LABEL
        ? { available: true } : refusal("invalid_value", `A label is at most ${MAX_LABEL} characters.`);
  }
}

const unchanged = (state: ExpressionState): ExpressionResult => ({ part: state.part, editor: state.editor, changed: false, effect: { kind: "none" } });
const changedTo = (state: ExpressionState, part: ExpressionPart): ExpressionResult =>
  sameVector(part.controls, state.part.controls) && JSON.stringify(part) === JSON.stringify(state.part)
    ? unchanged(state) : { part, editor: state.editor, changed: true, effect: { kind: "content" } };

/** Apply an action (the capability must allow it; this throws otherwise). Never mutates `state`. */
export function applyExpression(state: ExpressionState, action: ExpressionAction): ExpressionResult {
  const allowed = expressionCapability(state, action);
  if (!allowed.available) throw Error(allowed.reason);
  const part = state.part;
  switch (action.kind) {
    case "expression.setControl": {
      let controls = withControl(part.controls, action.name, action.value);
      const partner = mirrorName(action.name);
      if (partner !== action.name && pairLinked(part, action.name)) controls = withControl(controls, partner, action.value);
      return changedTo(state, { ...part, controls });
    }
    case "expression.linkPair": {
      const links = { ...part.links, [action.pair]: action.linked };
      return changedTo(state, { ...part, links: Object.fromEntries(Object.keys(links).sort().map(key => [key, links[key]!])) });
    }
    case "expression.mirror": {
      let controls = part.controls;
      // Every mirror pair: the named side's weight onto its partner (absent is 0). Direction pairs are opposites, not mirror images.
      const names = new Set([...Object.keys(part.controls), ...Object.keys(part.controls).map(mirrorName)]);
      for (const name of names) {
        if (controlSide(name) !== action.from || isDirectionPair(name) || mirrorName(name) === name) continue;
        controls = withControl(controls, mirrorName(name), part.controls[name] ?? 0);
      }
      return changedTo(state, { ...part, controls });
    }
    case "expression.reset": {
      const keep = (name: string) => action.scope === "all" ? false
        : action.scope === "group" ? controlGroup(name) !== (action.target as ControlGroupId)
        : name !== action.target && !(pairLinked(part, action.target!) && name === mirrorName(action.target!));
      const controls = Object.fromEntries(Object.entries(part.controls).filter(([name]) => keep(name)));
      return changedTo(state, { ...part, controls });
    }
    case "expression.startFrom":
      return changedTo(state, { ...part, controls: normaliseVector(action.controls), origin: structuredClone(action.origin) });
    case "expression.setLabel": {
      const label = action.label.trim();
      const { label: _previous, ...rest } = part;
      return changedTo(state, label ? { ...rest, label } : rest);
    }
  }
}

/** What an action's Undo step is called. */
export function expressionLabel(action: ExpressionAction): HistoryLabel {
  const label = action.kind === "expression.setControl" ? "Face control"
    : action.kind === "expression.linkPair" ? (action.linked ? "Link sides" : "Unlink sides")
    : action.kind === "expression.mirror" ? `Mirror ${action.from} to ${action.from === "left" ? "right" : "left"}`
    : action.kind === "expression.reset" ? (action.scope === "all" ? "Reset expression" : action.scope === "group" ? "Reset group" : "Reset control")
    : action.kind === "expression.startFrom" ? "Start expression from"
    : "Expression label";
  return { label, actionKind: action.kind };
}

export { storedWeight };
