/**
 * The expressions feature's pure action behaviour (research/animation/expression-editor-design.md §4): capability and apply over the
 * part. Everything is decided from control names (the mirror map, pair keys, groups, counterparts and opposites are name rules,
 * engines/facial-rig/vocabulary.ts and symmetry.ts, which the host's solver checks against the rig), so the actions need no vocabulary:
 * the drawer offers only the controls and axes the head has, and a name the head lacks is kept verbatim.
 *
 * Symmetry is one concept: a left/right pair is linked (a symmetric edit sets its counterpart: the mirror image for skin, the same look
 * direction for gaze) or separate; Symmetric on a group or the face links every pair in it (`expression.setLinks`); Mirror copies one
 * side onto the other by the same rule; Flip swaps the face for its mirror image.
 */
import { refusal, type ActionDescriptor, type Capability, type FeatureResult, type FeatureState, type HistoryLabel } from "../../platform/api";
import { controlGroup, mirrorName, type ControlGroupId, CONTROL_GROUPS, controlSide } from "../../engines/facial-rig/vocabulary";
import { counterpartName, linkedByDefault, linkKey, oppositeCandidates, writeAxis } from "../../engines/facial-rig/symmetry";
import { CONTROL_NAME, interpolateWeight, normaliseVector, sameVector, storedWeight, vectorIssue, withControl, type ControlVector } from "../../engines/facial-rig/vector";
import { linksIssue, MAX_LABEL, originIssue, type ExpressionEditor, type ExpressionOrigin, type ExpressionPart } from "./part";

export type ExpressionAction =
  | { kind: "expression.setControl"; name: string; value: number }
  | { kind: "expression.setAxis"; negative: string; positive: string; value: number }
  | { kind: "expression.linkPair"; pair: string; linked: boolean }
  | { kind: "expression.setLinks"; links: Readonly<Record<string, boolean>> }
  | { kind: "expression.mirror"; from: "left" | "right" | "flip" }
  | { kind: "expression.reset"; scope: "all" | "group" | "control"; target?: string }
  | { kind: "expression.startFrom"; origin: ExpressionOrigin; controls: ControlVector; links?: Readonly<Record<string, boolean>> }
  | { kind: "expression.setLabel"; label: string }
  /**
   * Adjust all › Intensity: every control in `base` (the non-zero weights when the drag began) moved together by `amount` (−1 to 1,
   * eased by the view): toward full above 0, toward rest below (vector.ts `interpolateWeight`). Absolute, so each edit of one drag's
   * transaction replaces the last; controls outside `base` are left as they are.
   */
  | { kind: "expression.intensity"; base: ControlVector; amount: number };
export type ExpressionScope = "workspace";
export type ExpressionEffect = { kind: "content" } | { kind: "none" };
export type ExpressionState = FeatureState<ExpressionPart, ExpressionEditor>;
export type ExpressionResult = FeatureResult<ExpressionPart, ExpressionEditor, ExpressionEffect>;

const input = <T extends ActionDescriptor["payload"][string]>(schema: Omit<T, "from">) => ({ ...schema, from: "input" as const });
export const EXPRESSION_DESCRIPTORS: { readonly [K in ExpressionAction["kind"]]: ActionDescriptor<ExpressionScope> } = Object.freeze({
  "expression.setControl": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { name: input({ type: "string", required: true, minLength: 1, maxLength: 96 }), value: input({ type: "number", required: true, min: 0, max: 1 }) } },
  "expression.setAxis": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { negative: input({ type: "string", required: true, minLength: 1, maxLength: 96 }), positive: input({ type: "string", required: true, minLength: 1, maxLength: 96 }),
      value: input({ type: "number", required: true, min: -1, max: 1 }) } },
  "expression.linkPair": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { pair: input({ type: "string", required: true, minLength: 1, maxLength: 96 }), linked: input({ type: "boolean", required: true }) } },
  "expression.setLinks": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { links: input({ type: "object", required: true }) } },
  "expression.mirror": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { from: input({ type: "enum", required: true, values: ["left", "right", "flip"] }) } },
  "expression.reset": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { scope: input({ type: "enum", required: true, values: ["all", "group", "control"] }),
      target: input({ type: "string", required: false, maxLength: 96 }) } },
  "expression.startFrom": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { origin: input({ type: "object", required: true }), controls: input({ type: "object", required: true }),
      links: input({ type: "object", required: false }) } },
  "expression.setLabel": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { label: input({ type: "string", required: true, maxLength: MAX_LABEL }) } },
  "expression.intensity": { scope: ["workspace"], effect: "content", undo: "part",
    payload: { base: input({ type: "object", required: true }), amount: input({ type: "number", required: true, min: -1, max: 1 }) } },
});

/**
 * Whether an edit of `name` also sets its counterpart (symmetry.ts `counterpartName`): the pair's stored link, else linked for every
 * pair that has a counterpart (skin pairs and gaze); centre controls and lateral direction pairs have none.
 */
export function pairLinked(part: ExpressionPart, name: string): boolean {
  const key = linkKey(name);
  if (!key) return false;
  return part.links[key] ?? linkedByDefault(name);
}
/** Every name a mirror copy must visit: the vector's names with their mirror images and counterparts, to a fixed point. */
function symmetryClosure(controls: ControlVector): Set<string> {
  const names = new Set(Object.keys(controls));
  for (let grew = true; grew;) {
    grew = false;
    for (const name of [...names]) for (const other of [mirrorName(name), counterpartName(name)]) if (other && !names.has(other)) { names.add(other); grew = true; }
  }
  return names;
}

const GROUP_IDS = new Set<string>(CONTROL_GROUPS.map(group => group.id));

export function expressionCapability(state: ExpressionState, action: ExpressionAction): Capability {
  switch (action.kind) {
    case "expression.setControl":
      if (typeof action.name !== "string" || !CONTROL_NAME.test(action.name)) return refusal("invalid_value", "That isn't a face control.");
      if (typeof action.value !== "number" || !Number.isFinite(action.value) || action.value < 0 || action.value > 1)
        return refusal("invalid_value", "A control's weight is from 0 to 1.");
      return { available: true };
    case "expression.setAxis":
      if (typeof action.negative !== "string" || !CONTROL_NAME.test(action.negative) || typeof action.positive !== "string" || !oppositeCandidates(action.negative).includes(action.positive))
        return refusal("invalid_value", "Those two controls don't move the same thing both ways.");
      return typeof action.value === "number" && Number.isFinite(action.value) && action.value >= -1 && action.value <= 1
        ? { available: true } : refusal("invalid_value", "A two-way control's value is from −1 to 1.");
    case "expression.linkPair":
      return typeof action.pair === "string" && CONTROL_NAME.test(action.pair) && typeof action.linked === "boolean"
        ? { available: true } : refusal("invalid_value", "That isn't a left and right pair.");
    case "expression.setLinks": {
      const bad = linksIssue(action.links);
      return bad ? refusal("invalid_value", bad) : { available: true };
    }
    case "expression.mirror":
      return action.from === "left" || action.from === "right" || action.from === "flip" ? { available: true } : refusal("invalid_value", "Mirror from the left or the right, or flip the face.");
    case "expression.reset":
      if (action.scope === "all") return { available: true };
      if (action.scope === "group") return typeof action.target === "string" && GROUP_IDS.has(action.target)
        ? { available: true } : refusal("invalid_value", "That isn't a group of face controls.");
      if (action.scope === "control") return typeof action.target === "string" && CONTROL_NAME.test(action.target)
        ? { available: true } : refusal("invalid_value", "That isn't a face control.");
      return refusal("invalid_value", "Reset everything, a group or one control.");
    case "expression.startFrom": {
      const bad = originIssue(action.origin) ?? vectorIssue(action.controls) ?? (action.links === undefined ? undefined : linksIssue(action.links));
      return bad ? refusal("invalid_value", bad) : { available: true };
    }
    case "expression.setLabel":
      return typeof action.label === "string" && action.label.length <= MAX_LABEL
        ? { available: true } : refusal("invalid_value", `A label is at most ${MAX_LABEL} characters.`);
    case "expression.intensity": {
      const bad = vectorIssue(action.base);
      if (bad) return refusal("invalid_value", bad);
      return typeof action.amount === "number" && Number.isFinite(action.amount) && action.amount >= -1 && action.amount <= 1
        ? { available: true } : refusal("invalid_value", "The intensity change is from −1 to 1.");
    }
  }
}

const sortedLinks = (links: Readonly<Record<string, boolean>>) => Object.fromEntries(Object.keys(links).sort().map(key => [key, links[key]!]));
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
      const partner = counterpartName(action.name);
      if (partner && pairLinked(part, action.name)) controls = withControl(controls, partner, action.value);
      return changedTo(state, { ...part, controls });
    }
    case "expression.setAxis": {
      // Both ends at once (one Undo step); a linked axis sets its counterpart axis to the same value (the same look direction for gaze).
      let controls = writeAxis(part.controls, action, action.value);
      const negative = counterpartName(action.negative), positive = counterpartName(action.positive);
      if (negative && positive && pairLinked(part, action.negative)) controls = writeAxis(controls, { negative, positive }, action.value);
      return changedTo(state, { ...part, controls });
    }
    case "expression.linkPair":
      return changedTo(state, { ...part, links: sortedLinks({ ...part.links, [action.pair]: action.linked }) });
    case "expression.setLinks":
      return changedTo(state, { ...part, links: sortedLinks({ ...part.links, ...action.links }) });
    case "expression.mirror": {
      if (action.from === "flip") {
        // The mirror image: every control onto its mirror (jaw shift left becomes right; a look to V's left becomes one to her right).
        const flipped: Record<string, number> = {};
        for (const [name, value] of Object.entries(part.controls)) flipped[mirrorName(name)] = value;
        return changedTo(state, { ...part, controls: normaliseVector(flipped) });
      }
      let controls = part.controls;
      // The named side's weight onto its counterpart (absent is 0): mirror images for skin, the same look direction for gaze.
      for (const name of symmetryClosure(part.controls)) {
        const partner = counterpartName(name);
        if (controlSide(name) !== action.from || !partner) continue;
        controls = withControl(controls, partner, part.controls[name] ?? 0);
      }
      return changedTo(state, { ...part, controls });
    }
    case "expression.reset": {
      const keep = (name: string) => action.scope === "all" ? false
        : action.scope === "group" ? controlGroup(name) !== (action.target as ControlGroupId)
        : name !== action.target && !(pairLinked(part, action.target!) && name === counterpartName(action.target!));
      const controls = Object.fromEntries(Object.entries(part.controls).filter(([name]) => keep(name)));
      return changedTo(state, { ...part, controls });
    }
    case "expression.startFrom":
      // A saved expression or sample brings its own links (its authored asymmetry survives the next edit); rest and installed ones keep them.
      return changedTo(state, { ...part, controls: normaliseVector(action.controls), origin: structuredClone(action.origin),
        ...(action.links ? { links: Object.fromEntries(Object.keys(action.links).sort().map(key => [key, action.links![key]!])) } : {}) });
    case "expression.intensity": {
      let controls = part.controls;
      for (const [name, weight] of Object.entries(action.base)) if (weight > 0) controls = withControl(controls, name, interpolateWeight(weight, action.amount));
      return changedTo(state, { ...part, controls });
    }
    case "expression.setLabel": {
      const label = action.label.trim();
      const { label: _previous, ...rest } = part;
      return changedTo(state, label ? { ...rest, label } : rest);
    }
  }
}

/** What an action's Undo step is called. */
export function expressionLabel(action: ExpressionAction): HistoryLabel {
  const label = action.kind === "expression.setControl" || action.kind === "expression.setAxis" ? "Face control"
    : action.kind === "expression.linkPair" ? (action.linked ? "Link sides" : "Unlink sides")
    : action.kind === "expression.setLinks" ? "Symmetry"
    : action.kind === "expression.mirror" ? (action.from === "flip" ? "Flip face" : `Mirror ${action.from} to ${action.from === "left" ? "right" : "left"}`)
    : action.kind === "expression.reset" ? (action.scope === "all" ? "Reset expression" : action.scope === "group" ? "Reset group" : "Reset control")
    : action.kind === "expression.startFrom" ? "Start expression from"
    : action.kind === "expression.intensity" ? "Adjust intensity"
    : "Expression label";
  return { label, actionKind: action.kind };
}

export { storedWeight };
