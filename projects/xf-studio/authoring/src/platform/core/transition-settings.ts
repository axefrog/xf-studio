/**
 * Animated transitions' settings (research/animation/expression-editor-design.md §5.5): per source of held values (the held expression
 * today, poses later), whether a change animates, over how long and along which curve. The `transitions` family's one action,
 * `transition.set`, changes them; they are view state of the subject's motion, kept in the workspace beside the blink and the idle
 * (`preview.transitions`), never in a look, Undo or an export. DOM-free.
 *
 * The default is off, and when turned on, 1 s along Linear: photo mode's face graph blends from one expression to the next linearly over
 * 1 s (knowledge/facial-expressions.md §3), so the first thing a person sees is the change as the game shows it.
 */
import { refusal, type Capability } from "../api/capability";
import { isEasing, type EasingId } from "../api/easing";

export type TransitionSource = "expression";
export const TRANSITION_SOURCES: readonly TransitionSource[] = ["expression"];
export type TransitionSetting = { readonly enabled: boolean; readonly seconds: number; readonly easing: EasingId };
export type StoredTransitions = Partial<Record<TransitionSource, TransitionSetting>>;
/** The duration's range and step (seconds); 0 is a cut. */
export const TRANSITION_SECONDS = { min: 0, max: 3, step: 0.05 } as const;
export const DEFAULT_TRANSITION: TransitionSetting = Object.freeze({ enabled: false, seconds: 1, easing: "linear" });

export type TransitionAction = { kind: "transition.set"; source: TransitionSource; enabled?: boolean; seconds?: number; easing?: EasingId };

const isSource = (value: unknown): value is TransitionSource => (TRANSITION_SOURCES as readonly unknown[]).includes(value);
const validSeconds = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) &&
  value >= TRANSITION_SECONDS.min && value <= TRANSITION_SECONDS.max;
/** A duration as stored: on the step, within the range. */
const round = (seconds: number) => Math.round(Math.round(Math.min(TRANSITION_SECONDS.max, Math.max(TRANSITION_SECONDS.min, seconds)) /
  TRANSITION_SECONDS.step) * TRANSITION_SECONDS.step * 1000) / 1000;

/** A stored `preview.transitions` read back: each known source with a complete, valid setting; undefined when none. */
export function parseTransitions(value: unknown): StoredTransitions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: StoredTransitions = {};
  for (const [source, setting] of Object.entries(value as Record<string, unknown>)) {
    if (!isSource(source) || !setting || typeof setting !== "object") continue;
    const { enabled, seconds, easing } = setting as Record<string, unknown>;
    if (typeof enabled === "boolean" && validSeconds(seconds) && isEasing(easing)) out[source] = { enabled, seconds: round(seconds), easing };
  }
  return Object.keys(out).length ? out : undefined;
}
const sameSetting = (a: TransitionSetting, b: TransitionSetting) => a.enabled === b.enabled && a.seconds === b.seconds && a.easing === b.easing;

export class TransitionSettings {
  private value: Record<TransitionSource, TransitionSetting>;
  private readonly listeners = new Set<() => void>();
  constructor(stored?: StoredTransitions) {
    this.value = Object.fromEntries(TRANSITION_SOURCES.map(source => [source, { ...DEFAULT_TRANSITION, ...stored?.[source] }])) as Record<TransitionSource, TransitionSetting>;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** One source's setting (a detached copy). */
  get(source: TransitionSource): TransitionSetting { return { ...this.value[source] }; }
  /** What the workspace keeps: only the sources whose setting differs from the default (undefined when none does). */
  stored(): StoredTransitions | undefined {
    const out: StoredTransitions = {};
    for (const source of TRANSITION_SOURCES) if (!sameSetting(this.value[source], DEFAULT_TRANSITION)) out[source] = { ...this.value[source] };
    return Object.keys(out).length ? out : undefined;
  }
  capability(action: TransitionAction): Capability {
    if (!isSource(action.source)) return refusal("invalid_value", "Only expressions animate their changes in this version.");
    if (action.enabled !== undefined && typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
    if (action.seconds !== undefined && !validSeconds(action.seconds))
      return refusal("invalid_value", `A transition lasts from ${TRANSITION_SECONDS.min} to ${TRANSITION_SECONDS.max} seconds.`);
    if (action.easing !== undefined && !isEasing(action.easing)) return refusal("invalid_value", "That isn't one of the curves.");
    if (action.enabled === undefined && action.seconds === undefined && action.easing === undefined) return refusal("invalid_value", "Nothing to change.");
    return { available: true };
  }
  /** Apply a change (the capability must allow it; this throws otherwise); returns whether anything changed. */
  dispatch(action: TransitionAction): boolean {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    const previous = this.value[action.source];
    const next: TransitionSetting = { enabled: action.enabled ?? previous.enabled, seconds: action.seconds === undefined ? previous.seconds : round(action.seconds),
      easing: action.easing ?? previous.easing };
    if (sameSetting(previous, next)) return false;
    this.value = { ...this.value, [action.source]: next };
    for (const listener of this.listeners) listener();
    return true;
  }
}
