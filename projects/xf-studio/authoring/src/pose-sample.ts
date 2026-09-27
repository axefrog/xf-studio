/**
 * One photo-mode pose sampled on its rig (`xfs/pose-sample-1`, pose-catalogue-host.ts `sample`): the record the host answers and the
 * scene plays (pose-clip.ts). Types only, so the scene host reaches it without the catalogue's readers.
 */
export interface PoseSample {
  readonly schema: "xfs/pose-sample-1";
  readonly id: string;
  readonly clip: { readonly name: string; readonly set: string; readonly frames: number; readonly duration: number };
  /** Seconds into the clip (the record's `animationTime`, clamped to the clip). */
  readonly time: number;
  readonly rig: string;
  /** Game space (Z up), local to each joint's parent; a joint the clip doesn't key keeps the rig's reference, which is listed too. */
  readonly joints: readonly { readonly bone: string; readonly parent: string | null; readonly translation: readonly number[]; readonly rotation: readonly number[];
    readonly scale: readonly number[]; readonly keyed: boolean }[];
  readonly tracks: Readonly<Record<string, number>>;
  /**
   * A clip that moves (its entry's `moves` badge): every frame from 0 to the clip's length at its own rate, for the joint channels whose
   * keys change (game space, local to the parent; flat arrays of 3 or 4 values per frame). Every other channel holds its value in `joints`.
   * Absent for a held pose.
   */
  readonly motion?: PoseMotion;
}
export interface PoseMotion {
  /** Frames per second, and how many frames (the first at 0 s, the last at the clip's length). */
  readonly rate: number;
  readonly frames: number;
  readonly channels: readonly { readonly bone: string; readonly channel: "translation" | "rotation" | "scale"; readonly values: readonly number[] }[];
}
