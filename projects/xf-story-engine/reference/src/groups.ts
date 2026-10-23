// Groups and membership (spec 12): membership edges, frame inheritance from group concerns, orders and
// leader decisions.
//
// A member's frame of drive family X may take as a parent each active concern frame of family X of each
// group the member belongs to with strength >= theta_member, at edge weight = strength. Concerns without
// a family attach to the member's situation frame. A group's concern and goal frames change only through
// a leader's decision (spec 10.3).

import type { ContextFrame, FrameInterests, FrameParent, FrameSpec, FrameStatus, Goal } from './frames.ts';
import type { Kernel } from './kernel.ts';
import type { Edge, GameTime, Id } from './types.ts';

export type Decision =
  | { op: 'open'; spec: Omit<FrameSpec, 'actor' | 'cause'> }
  | { op: 'status'; frame: Id; status: FrameStatus }
  | { op: 'weight'; frame: Id; weight: number }
  | { op: 'interests'; frame: Id; own: Partial<FrameInterests> };

export interface DecisionRecord {
  leader: Id;
  group: Id;
  decision: Decision;
  frame: Id;
  time: GameTime;
}

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Groups {
  readonly decisionLog: DecisionRecord[] = [];
  private syncing = false;
  /** The game time up to which membership validity crossings have been handled (SPEC-NOTES 56). */
  private crossedUntil: GameTime;

  constructor(private readonly k: Kernel) {
    this.crossedUntil = k.now;
  }

  // ---- membership ----

  /** The membership edges of a member that are in force at `t`. */
  memberships(member: Id, t: GameTime = this.k.now): Edge[] {
    return this.k.store
      .edgesFrom(member)
      .filter((e) => e.type === 'core:member-of' && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to))
      .sort((a, b) => cmpId(a.id, b.id));
  }

  membersOf(group: Id, t: GameTime = this.k.now): Edge[] {
    return this.k.store
      .edgesTo(group)
      .filter((e) => e.type === 'core:member-of' && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to))
      .sort((a, b) => cmpId(a.id, b.id));
  }

  /** The strength of a membership; an edge that does not state one counts as full strength (SPEC-NOTES 32). */
  strengthOf(e: Edge): number {
    const s = e.attrs.strength;
    return typeof s === 'number' ? s : 1;
  }

  isLeader(person: Id, group: Id): boolean {
    return this.memberships(person).some((e) => e.to === group && e.attrs.role === 'leader');
  }

  // ---- hooks from the kernel and the frame store ----

  /** A membership edge was added, ended or changed: re-sync inheritance and recheck the member's goals (spec 10.8). */
  onEdgeChange(edge: Edge): void {
    if (edge.type !== 'core:member-of') return;
    this.k.frames.worklist.push({ t: 'inherit', actor: edge.from });
    this.k.frames.worklist.push({ t: 'dilemma-actor', actor: edge.from });
  }

  /**
   * The clock reached `t`. A membership edge whose validity starts or ends in (the last time handled, `t`]
   * changes which group concerns its member inherits, so the member re-syncs and its goals are checked
   * again, in the frame worklist, before pull and dispatch consume the result. The engine calls this at
   * every boundary it processes and when an advance ends, so the crossings handled do not depend on how
   * ticks fell (SPEC-NOTES 56).
   */
  crossTo(t: GameTime): void {
    if (!(t > this.crossedUntil)) return;
    const from = this.crossedUntil;
    this.crossedUntil = t;
    const crosses = (x: GameTime | undefined): boolean => x !== undefined && x > from && x <= t;
    const members = new Set<Id>();
    for (const e of this.k.store.allEdges()) {
      if (e.type === 'core:member-of' && (crosses(e.valid.from) || crosses(e.valid.to))) members.add(e.from);
    }
    for (const m of [...members].sort(cmpId)) {
      this.k.frames.worklist.push({ t: 'inherit', actor: m });
      this.k.frames.worklist.push({ t: 'dilemma-actor', actor: m });
    }
  }

  /**
   * A load restores the clock to the time of the save and puts frames back as they were saved. A
   * membership may have crossed its validity since the frames were last synced (a save can be made
   * between a clock change and the next tick, and an expired membership is not saved), so every actor
   * with a frame or a membership is queued to re-sync. The load runs that work at once, with the clock at
   * `t`, so the memberships it reads are the ones in force when the save was made; crossings after `t`
   * are then handled boundary by boundary by `crossTo`.
   */
  restoreAt(t: GameTime): void {
    this.crossedUntil = t;
    const actors = new Set<Id>();
    for (const f of this.k.frames.all()) actors.add(f.actor);
    for (const e of this.k.store.allEdges()) if (e.type === 'core:member-of') actors.add(e.from);
    for (const a of [...actors].sort(cmpId)) this.k.frames.worklist.push({ t: 'inherit', actor: a });
  }

  /** A frame changed: a group concern change re-syncs its members; a member frame change re-syncs itself. */
  onFrameChange(frame: ContextFrame): void {
    if (this.syncing) return;
    if (this.k.frames.isGroupActor(frame.actor)) {
      if (frame.level !== 'concern') return;
      for (const e of this.membersOf(frame.actor)) this.k.frames.worklist.push({ t: 'inherit', actor: e.from });
    } else if (frame.level === 'drive' || frame.level === 'concern' || frame.level === 'situation') {
      this.k.frames.worklist.push({ t: 'inherit', actor: frame.actor });
    }
  }

  private familyOf(drive: string | undefined): string | undefined {
    return drive === undefined ? undefined : this.k.schema.driveFamily.get(drive);
  }

  /** Recompute the membership parents of an actor's frames. Returns the work units used. */
  syncMember(actor: Id): number {
    const fr = this.k.frames;
    if (fr.isGroupActor(actor)) return 1;
    let cost = 1;
    const theta = this.k.config.thetaMember;
    const mine = fr.framesOf(actor).filter((f) => fr.eligible(f));
    const desired = new Map<Id, FrameParent[]>();
    const want = (child: Id, p: FrameParent): void => {
      const list = desired.get(child) ?? [];
      if (!list.some((x) => x.frame === p.frame)) list.push(p);
      desired.set(child, list);
    };
    for (const m of this.memberships(actor)) {
      const strength = this.strengthOf(m);
      if (strength < theta) continue;
      const gh = this.k.store.header(m.to);
      if (!gh || !this.k.schema.hasFacet(gh.kind, 'group')) continue;
      for (const gf of fr.framesOf(m.to)) {
        cost++;
        if (gf.level !== 'concern' || gf.status !== 'active') continue;
        const family = this.familyOf(gf.payload.drive);
        for (const mf of mine) {
          if (family !== undefined) {
            if ((mf.level === 'drive' || mf.level === 'concern') && this.familyOf(mf.payload.drive) === family) {
              want(mf.id, { frame: gf.id, weight: strength, via: 'membership' });
            }
          } else if (mf.level === 'situation') {
            want(mf.id, { frame: gf.id, weight: strength, via: 'membership' });
          }
        }
      }
    }
    this.syncing = true;
    try {
      for (const mf of fr.framesOf(actor)) {
        const current = mf.parents.filter((p) => p.via === 'membership');
        const next = (desired.get(mf.id) ?? []).filter((p) => !fr.isAncestorOrSelf(mf.id, p.frame));
        const same =
          current.length === next.length &&
          current.every((c) => next.some((n) => n.frame === c.frame && n.weight === c.weight));
        if (same) continue;
        const keep = mf.parents.filter((p) => p.via !== 'membership');
        fr.setParents(mf.id, [...keep, ...next], mf.cause);
        cost++;
      }
    } finally {
      this.syncing = false;
    }
    return cost;
  }

  // ---- orders (spec 12) ----

  /**
   * A group orders a member: a goal frame on the member whose parent is the group's goal frame, at edge
   * weight `pressure` (S1 computes it). The new goal frame's origin is the group's goal (SPEC-NOTES 24).
   */
  issueOrder(opts: { groupFrame: Id; member: Id; goal: Goal; pressure: number; cause: Id }): ContextFrame {
    const fr = this.k.frames;
    const gf = fr.frame(opts.groupFrame);
    if (!gf || gf.level !== 'goal' || !fr.eligible(gf)) throw new Error('an order follows an active goal frame of the group');
    if (!this.memberships(opts.member).some((e) => e.to === gf.actor)) throw new Error('only a member can be ordered');
    if (!(opts.pressure > 0)) throw new Error('pressure is positive');
    return fr.open({
      actor: opts.member, level: 'goal', origin: gf.id, payload: { goal: opts.goal }, weight: 1,
      parents: [{ frame: gf.id, weight: opts.pressure }], cause: opts.cause,
    });
  }

  // ---- decisions (spec 10.3, 12) ----

  /** A leader changes a group's frames. The only way a group's concerns and goals change. */
  decide(leader: Id, group: Id, decision: Decision): ContextFrame {
    if (!this.isLeader(leader, group)) throw new Error('only a leader of the group decides for it');
    const fr = this.k.frames;
    fr.viaDecision = true;
    let frame: ContextFrame;
    try {
      switch (decision.op) {
        case 'open':
          frame = fr.open({ ...decision.spec, actor: group, cause: leader });
          break;
        case 'status':
          this.ownFrame(decision.frame, group);
          frame = fr.setStatus(decision.frame, decision.status, leader);
          break;
        case 'weight':
          this.ownFrame(decision.frame, group);
          frame = fr.setWeight(decision.frame, decision.weight, leader);
          break;
        case 'interests':
          this.ownFrame(decision.frame, group);
          frame = fr.setInterests(decision.frame, decision.own, leader);
          break;
      }
    } finally {
      fr.viaDecision = false;
    }
    this.decisionLog.push({ leader, group, decision, frame: frame.id, time: this.k.now });
    return frame;
  }

  private ownFrame(frame: Id, group: Id): void {
    const f = this.k.frames.frame(frame);
    if (!f || f.actor !== group) throw new Error('not a frame of the group');
  }

  clear(): void {
    this.decisionLog.length = 0;
  }
}
