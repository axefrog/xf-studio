/**
 * The shown V as the Poses module sees it (features/poses/actions.ts `PoseStage`): her body gender (the character context), the visual
 * tags of what she wears in the view (the character details), her motion service (the body source) and the whole-body view, as the
 * composition root hands them over once the 3D view is ready and takes them back when it goes. Wiring only: it decides nothing.
 */
import type { Capability, ViewId } from "../platform/api";
import type { PoseSample } from "./pose-sample";
import type { MotionActions } from "./motion-actions";
import type { CharacterDetailActions } from "../character/character-detail-actions";
import type { CharacterContextActions } from "../character/character-context-actions";

export type PoseStageHead = {
  /** The view the head draws: the one its motion actions name (profiles design §3.6). */
  view: ViewId;
  motion: MotionActions;
  details: Pick<CharacterDetailActions, "snapshot" | "subscribe">;
  context: Pick<CharacterContextActions, "shownBody" | "subscribe">;
};
/** The whole-body view of the view a head draws (`camera.body`, naming that view). */
export type PoseStageFraming = { capability(view: ViewId): Capability; frame(view: ViewId): Capability };
type Placement = { readonly offset: readonly [number, number, number]; readonly rotation: readonly [number, number, number] };
/** The motion service in the Poses module's terms (features/poses/actions.ts `PoseMotionPort`, matched by shape). */
export type PoseStageMotion = {
  snapshot(): { readonly idle: boolean; readonly pose: { readonly id: string; readonly label: string; readonly moves: boolean } | null; readonly poseLoading: boolean };
  poseCapability(): Capability;
  holdPose(pose: { readonly id: string; readonly label: string; readonly moves: boolean }, sample: Promise<{ readonly schema: string }>, placement?: Placement): Promise<boolean>;
  pendingPose(): { id: string; label: string } | null;
  dropPendingPose(): void;
  bodyCapability(idle: boolean): Capability;
  setBody(idle: boolean): void;
};

/** The Poses module's stage (features/poses/actions.ts `PoseStage`, matched by shape). */
export class PoseStageHub {
  private head: PoseStageHead | null = null;
  private releases: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private tags: readonly string[] = [];
  private port: PoseStageMotion | null = null;
  constructor(private readonly framing: PoseStageFraming) {}
  /** The loaded V's services, or null when the 3D view goes. */
  attach(head: PoseStageHead | null) {
    for (const release of this.releases.splice(0)) release();
    this.head = head;
    this.port = head ? motionPort(head.motion, head.view) : null;
    this.tags = head?.details.snapshot().garmentTags ?? [];
    if (head) {
      const changed = () => this.notify();
      this.releases.push(head.motion.subscribe(changed) as () => void, head.context.subscribe(changed) as () => void,
        head.details.subscribe(() => { const next = head.details.snapshot().garmentTags; if (next.join("\n") !== this.tags.join("\n")) { this.tags = next; this.notify(); } }) as () => void);
    }
    this.notify();
  }
  private notify() { for (const listener of this.listeners) listener(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  bodyGender() { return this.head ? this.head.context.shownBody() : null; }
  wornTags() { return this.tags; }
  motion() { return this.port; }
  view() { return this.head?.view ?? null; }
  frameCapability() { return this.head ? this.framing.capability(this.head.view) : { available: false, code: "not_ready" as const, reason: "V can be framed once the 3D view is ready." }; }
  frame() { const allowed = this.frameCapability(); return allowed.available && this.head ? this.framing.frame(this.head.view) : allowed; }
}

/** The motion service in the Poses module's terms: a sampled pose passes through (its schema checked), Still and the idle are its actions. */
function motionPort(motion: MotionActions, view: ViewId): PoseStageMotion {
  return {
    snapshot: () => motion.snapshot(),
    poseCapability: () => motion.poseCapability(),
    holdPose: (pose, sample, placement) => motion.holdPose(pose, sample.then(value => {
      if ((value as { schema?: string } | null)?.schema !== "xfs/pose-sample-1") throw Error("That pose came back in a form XF Studio doesn't read. Reload the page.");
      return value as unknown as PoseSample;
    }), placement && { offset: [...placement.offset] as [number, number, number], rotation: [...placement.rotation] as [number, number, number] }),
    pendingPose: () => motion.pendingPose(),
    dropPendingPose: () => motion.dropPendingPose(),
    bodyCapability: idle => motion.capability({ kind: "motion.setIdle", enabled: idle, view }),
    setBody: idle => motion.dispatch({ kind: "motion.setIdle", enabled: idle, view }),
  };
}
