/**
 * Binding resolution and captures (profiles design §3.1–3.5): pure functions over plain data. Nothing here reads a service, holds state or
 * decides an action: the input layer resolves a panel's target with them, names that target in the action it dispatches, and freezes it
 * in a capture while a gesture, menu or picker is open. Owners validate what an action names when it arrives.
 *
 * - **A panel type declares its context** (`PanelContext`): what it shows and edits (`profile`, `view`, `scene`, `subject` with its
 *   kinds, `look`) and the scene kinds it can resolve from (`scenes`). Resolution yields a partial context, `Target`
 *   (`{ view?, scene?, sceneGen?, subject?, look? }`); each action declares what it needs (`requires`).
 * - **Policies are data.** `follow-focus` (the default) resolves to the eligible view in the panel's own tab with the highest focus number;
 *   without one, nothing (the panel's empty state): never another tab, never a "current" subject. `pinned` resolves to the named view,
 *   scene, subject or look; a pin whose target is gone dangles, keeps the pin and says what is missing. It never retargets silently.
 * - **Eligibility.** A view is eligible when it exists, is in the panel's tab, shows a scene of a kind the context accepts, shows a subject
 *   of an accepted kind (a subject context), and passes the constraint rules.
 * - **Constraint rules** are data (`{ id, applies, check }`), evaluated at bind time here and again by owners at dispatch. No rule caps
 *   counts.
 * - **Captures** freeze the whole chain a resolution reached, with `sceneGen` and the revision of each library document it edits. A capture
 *   is current while its view still shows that scene, the scene's `gen` is unchanged, its subject and look still exist and its
 *   documents' revisions are unchanged; otherwise it is refused with `missing_target`, saying what changed. A capture never acts on a
 *   replacement.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import type { ViewId } from "../../platform/api/view-graph";
import { type PanelContext, type SubjectRef, sameSubject } from "../../platform/api/subjects";
import { CHARACTER_KIND } from "../../platform/api/characters";
import type { LookRef } from "../../library/collection-documents";
import type { PanelBinding, TabId } from "./profile-session";

export type { PanelContext } from "../../platform/api/subjects";
/** A partial context: the chain a resolution reached. */
export type Target = { readonly view?: ViewId; readonly scene?: string; readonly sceneGen?: number; readonly subject?: SubjectRef;
  readonly look?: LookRef };
/** What an action needs from the context it acts in. */
export type Requirement = "view" | "scene" | "subject" | "look";
/** A constraint rule (§3.5): where it applies, and whether a target passes. */
export type ConstraintRule = { readonly id: string; applies(context: PanelContext): boolean; check(target: Target): Capability };

/** The session as resolution reads it: plain data, plus whether a subject or a look still exists. */
export type BindingWorld = {
  /** Each view's tab and the scene it shows. */
  readonly views: Readonly<Record<ViewId, { readonly tab: TabId; readonly scene: string }>>;
  /** Each scene's kind, what it shows and its `gen` (raised whenever its subject or look changes). */
  readonly scenes: Readonly<Record<string, { readonly kind: string; readonly subject?: SubjectRef; readonly look?: LookRef; readonly gen: number }>>;
  /** Each view's focus number (higher: more recent; platform/core/focus.ts). */
  readonly focus: Readonly<Record<ViewId, number>>;
  /** Whether a subject still exists (not deleted). */
  subject(ref: SubjectRef): boolean;
  /** Whether a look still exists and is live (not removed). */
  look(ref: LookRef): boolean;
};

export type Resolution =
  /** `named`: the panel header names its target (§3.3): pinned, more than one candidate, or no view in the tab shows it. */
  | { readonly state: "resolved"; readonly target: Target; readonly candidates: number; readonly named: boolean }
  /** No candidate: the panel shows its empty state (Choose…, phase 2). */
  | { readonly state: "empty"; readonly reason: string }
  /** A pin whose target is gone: the pin is kept, and the panel says what is missing (Follow focus, Choose…, Restore). */
  | { readonly state: "dangling"; readonly missing: Requirement; readonly reason: string };

const sameLook = (a: LookRef, b: LookRef) => a.collection === b.collection && a.look === b.look;
const subjectName = (ref: SubjectRef | undefined) => ref?.kind === CHARACTER_KIND ? "V" : "subject";

/** The chain a view shows: the view, its scene and `gen`, and the scene's subject and look (each only while it exists). */
export function chainOfView(world: BindingWorld, view: ViewId): Target | undefined {
  const record = world.views[view], scene = record && world.scenes[record.scene];
  if (!record || !scene) return undefined;
  return { view, ...chainOfScene(world, record.scene) };
}
function chainOfScene(world: BindingWorld, id: string): Target | undefined {
  const scene = world.scenes[id];
  if (!scene) return undefined;
  return { scene: id, sceneGen: scene.gen, ...(scene.subject && world.subject(scene.subject) ? { subject: scene.subject } : {}),
    ...(scene.look && world.look(scene.look) ? { look: scene.look } : {}) };
}

/** Whether a view can serve a panel of this context in this tab (§3.3 eligibility). */
function eligible(world: BindingWorld, view: ViewId, tab: TabId, context: PanelContext, rules: readonly ConstraintRule[]): Target | undefined {
  const record = world.views[view];
  if (!record || record.tab !== tab) return undefined;
  const scene = world.scenes[record.scene];
  if (!scene || ("scenes" in context && context.scenes && !context.scenes.includes(scene.kind))) return undefined;
  const target = chainOfView(world, view);
  if (!target) return undefined;
  if (context.kind === "subject" && !(target.subject && context.subjects.includes(target.subject.kind))) return undefined;
  return passes(context, target, rules) ? target : undefined;
}
const passes = (context: PanelContext, target: Target, rules: readonly ConstraintRule[]) =>
  rules.every(rule => !rule.applies(context) || rule.check(target).available);

/**
 * A panel's target (§3.2–3.4): its binding (absent: follow focus) resolved in its tab. A `profile` panel has no binding and resolves to
 * nothing in particular.
 */
export function resolveBinding(world: BindingWorld, request: { readonly tab: TabId; readonly binding?: PanelBinding; readonly context: PanelContext;
  readonly rules?: readonly ConstraintRule[] }): Resolution {
  const { tab, context } = request, rules = request.rules ?? [];
  if (context.kind === "profile") return { state: "resolved", target: {}, candidates: 0, named: false };
  const binding = request.binding ?? { policy: "follow-focus" as const };
  if (binding.policy === "follow-focus") {
    const candidates = Object.keys(world.views).flatMap(view => { const target = eligible(world, view, tab, context, rules); return target ? [target] : []; });
    let best: Target | undefined, at = 0;
    for (const target of candidates) { const seq = world.focus[target.view!] ?? 0; if (seq > at) { at = seq; best = target; } }
    if (!best) return { state: "empty", reason: candidates.length ? "Click a 3D view to work on what it shows." : "No 3D view in this tab shows anything to work on here." };
    return { state: "resolved", target: best, candidates: candidates.length, named: candidates.length > 1 };
  }
  const pin = binding.target;
  let target: Target | undefined, missing: Requirement, reason: string;
  if ("view" in pin) { target = chainOfView(world, pin.view); missing = "view"; reason = "The 3D view this panel was pinned to was closed."; }
  else if ("scene" in pin) { target = chainOfScene(world, pin.scene); missing = "scene"; reason = "The scene this panel was pinned to is gone."; }
  else if ("subject" in pin) {
    target = world.subject(pin.subject) ? { subject: pin.subject } : undefined;
    missing = "subject"; reason = `The ${subjectName(pin.subject)} this panel was pinned to was deleted.`;
  } else { target = world.look(pin.look) ? { look: pin.look } : undefined; missing = "look"; reason = "The look this panel was pinned to was removed."; }
  if (!target) return { state: "dangling", missing, reason };
  if (!passes(context, target, rules)) return { state: "empty", reason: "What this panel is pinned to can't be shown here." };
  return { state: "resolved", target, candidates: 1, named: true };
}

const NEEDS: Record<Requirement, string> = {
  view: "Open a 3D view to use this.",
  scene: "Choose a 3D view that shows a V first.",
  subject: "Choose a V first.",
  look: "Choose a look first.",
};
/** Whether a target meets an action's requirements (§3.1): the first one missing, refused with `missing_target`. */
export function requirementsMet(target: Target, requires: readonly Requirement[]): Capability {
  for (const need of requires) if (target[need] === undefined) return refusal("missing_target", NEEDS[need]);
  return { available: true };
}

/** A frozen target (§3.3): the chain a resolution reached, and the revision of each library document it edits (by document key). */
export type CaptureData = { readonly target: Target; readonly revisions: Readonly<Record<string, number>> };

/**
 * Whether a capture still names what it named when it was taken: the view still references its scene, the scene's `gen` is unchanged, the
 * subject and look still exist, and the documents' revisions are unchanged (`revision`: a document's revision now, by key).
 */
export function captureCurrent(world: BindingWorld, capture: CaptureData, revision: (key: string) => number | undefined): Capability {
  const { target } = capture;
  if (target.view !== undefined) {
    const record = world.views[target.view];
    if (!record) return refusal("missing_target", "That 3D view was closed.");
    if (target.scene !== undefined && record.scene !== target.scene) return refusal("missing_target", "This view now shows another scene.");
  }
  if (target.scene !== undefined) {
    const scene = world.scenes[target.scene];
    if (!scene) return refusal("missing_target", "That scene is gone.");
    if (target.sceneGen !== undefined && scene.gen !== target.sceneGen) {
      if (!same(scene.subject, target.subject, sameSubject)) return refusal("missing_target", `This view now shows another ${subjectName(target.subject ?? scene.subject)}.`);
      if (!same(scene.look, target.look, sameLook)) return refusal("missing_target", "This view now shows another look.");
      return refusal("missing_target", "What this view shows changed.");
    }
  }
  if (target.subject && !world.subject(target.subject)) return refusal("missing_target", `That ${subjectName(target.subject)} was deleted.`);
  if (target.look && !world.look(target.look)) return refusal("missing_target", "That look was removed.");
  for (const [key, at] of Object.entries(capture.revisions))
    if (revision(key) !== at) return refusal("missing_target", "This changed in another window. Try again.");
  return { available: true };
}
const same = <T>(a: T | undefined, b: T | undefined, equal: (a: T, b: T) => boolean) => a === undefined ? b === undefined : b !== undefined && equal(a, b);
