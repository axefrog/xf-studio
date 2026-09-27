/**
 * The facial preview's shared contract (research/animation/expression-editor-design.md §4, §5): what the host answers about the
 * player's face rig, the external solver and the installed photo-mode expressions, and what a solve request and answer hold. Types
 * and constants only; the host (src/facial-host.ts), the browser device and the preview service import it, and a feature view reads
 * the service's snapshot (`FacialPreviewSnapshot`) through its view context.
 */

export const FACIAL_STATE_SCHEMA = "xfs/facial-state-1";
export const FACIAL_ENDPOINT = "/api/facial";
export const FACIAL_SOLVE_ENDPOINT = "/api/facial/solve";
export const FACIAL_EXPRESSIONS_ENDPOINT = "/api/facial/expressions";

export type FacialControlGroup = "brows" | "lids" | "gaze" | "nose" | "cheeks" | "mouth" | "jaw" | "neck" | "ears" | "advanced" | "other";
/** One main-pose control of the rig, as the drawer lists it (engines/facial-rig/vocabulary.ts `ControlInfo`). */
export type FacialControl = { readonly name: string; readonly track: number; readonly group: FacialControlGroup; readonly label: string;
  readonly text: string; readonly side: "left" | "right" | null; readonly partner: string | null; readonly pair: string | null;
  readonly direction: boolean; readonly note?: string;
  /** It moves nothing on this face (the host's solver found no joint motion and no wrinkle output): the drawer doesn't offer it. */
  readonly inert?: boolean;
  /** Its symmetry (engines/facial-rig/symmetry.ts): the link key it is stored under, the counterpart a linked edit also sets, and
   * whether it starts linked; absent for a centre control or a lateral direction pair. */
  readonly link?: FacialLink };
export type FacialLink = { readonly key: string; readonly counterpart: string; readonly byDefault: boolean };
export type FacialRigJoint = { readonly name: string; readonly parent: number; readonly t: readonly number[]; readonly r: readonly number[];
  readonly s: readonly number[] };

/** A preparation step's state: not set up (a plain reason and what to do), preparing, ready or failed (a plain reason). */
export type FacialPhase = "unconfigured" | "preparing" | "ready" | "failed";
export type FacialHostState = {
  readonly schema: typeof FACIAL_STATE_SCHEMA;
  /** The player's face skeleton and facial setup, read from the winning game files on the launch route. */
  readonly rig: { readonly phase: FacialPhase; readonly reason?: string; readonly skeleton?: string; readonly setup?: string;
    readonly tracks?: readonly string[]; readonly reference?: readonly number[]; readonly main?: { readonly start: number; readonly count: number };
    readonly controls?: readonly FacialControl[]; readonly groups?: readonly { readonly id: FacialControlGroup; readonly label: string }[];
    readonly joints?: readonly FacialRigJoint[];
    /** Controls that move nothing on this face, once the solver has checked (absent: not known, so every control is offered). */
    readonly inert?: readonly string[];
    /** Opposing pairs the solver confirmed (engines/facial-rig/relations.ts), each one two-way control; absent: not checked yet. */
    readonly axes?: readonly FacialAxisPair[];
    /** Whether each horizontal gaze control's counterpart turns the other eye the same world way (null: nothing to check). */
    readonly gazeSameWay?: boolean | null };
  /** The external solver kept warm (the pinned, unmodified IO Suite modules run as their own program). */
  readonly solver: { readonly phase: "missing" | "starting" | "ready" | "failed"; readonly reason?: string; readonly compileMs?: number };
  /** The game's normal blink, which composes with a held expression before the solve (the game adds blink tracks first). */
  readonly blink: { readonly available: boolean; readonly closedTime?: number; readonly duration?: number; readonly rate?: number };
  /** The installed photo-mode expressions (start points). */
  readonly expressions: { readonly phase: FacialPhase; readonly reason?: string; readonly count?: number };
  /** The built-in starting points (the natural samples), available whether or not the game files are read. */
  readonly samples: readonly FacialSample[];
};

/** A confirmed opposing pair (engines/facial-rig/symmetry.ts `AxisPair`): negative toward V's left, down or back (or inward). */
export type FacialAxisPair = { readonly negative: string; readonly positive: string; readonly direction: "lateral" | "vertical" | "depth";
  readonly frame: "world" | "outward" };
/** A two-way control for the drawer (symmetry.ts `FacialAxis`). */
export type FacialAxisControl = FacialAxisPair & { readonly key: string; readonly label: string; readonly ends: readonly [string, string];
  readonly side: "left" | "right" | null; readonly gaze: boolean;
  /** Proposed by the control names alone (the solver hasn't confirmed its pairs yet); the solver's own list replaces it once it runs. */
  readonly proposed?: true;
  /** Its symmetry: the link keys of its two ends, its counterpart axis (by key) and whether it starts linked; absent for a centre axis. */
  readonly link?: { readonly keys: readonly string[]; readonly counterpart: string; readonly byDefault: boolean } };

/** A built-in starting point: an expression XF Studio ships (src/expression-samples.ts), started from with its own links. */
export type FacialSample = {
  /** `xf-sample:<file>`: the preset id its origin records. */
  readonly id: string;
  readonly name: string;
  /** Its action units in a few words ("AU6 cheek raiser, AU12 lip corner puller"). */
  readonly summary: string;
  readonly controls: Readonly<Record<string, number>>;
  readonly links: Readonly<Record<string, boolean>>;
};

/** An installed photo-mode expression, found the way the game finds it (the winning expression table, clips by name). */
export type FacialStartPoint = {
  /** `<row index>:<clip name>`: unique in the table. */
  readonly id: string;
  readonly row: number;
  readonly clip: string;
  /** A readable name from the clip name ("facial_happy" → "Happy"). */
  readonly label: string;
  /** The animation set that holds the clip, and who provides it (the archive's mod, or the base game). */
  readonly set: string;
  readonly provider: string;
  readonly controls: Readonly<Record<string, number>>;
  /** Plain notes (bone keys dropped, an animated clip read at its first frame, a type read as additive). */
  readonly notes?: readonly string[];
};
export type FacialStartPoints = {
  readonly phase: FacialPhase; readonly reason?: string; readonly table?: { readonly provider: string; readonly rows: number };
  readonly items: readonly FacialStartPoint[];
  /** Rows whose clip no attached set holds (they fall back to neutral in game), by clip name. */
  readonly missing?: readonly string[];
};

/** How blink composes into a solve: a held closure (0 open, 1 the clip's closed frame), or the whole clip at its own timing. */
export type FacialBlink = { readonly closure: number } | { readonly play: true };
/**
 * `client`: the asking page's own id (letters, digits and dashes, at most 64): each page's newer request replaces only its own waiting one,
 * and pages take turns (CORE-104). Absent: one shared page.
 */
export type FacialSolveRequest = { readonly controls: Readonly<Record<string, number>>; readonly blink?: FacialBlink; readonly client?: string };
/** A solve's answer: `frames` poses in rig order (one, or the blink clip at `rate` Hz), base64 float32 rotation and translation deltas. */
export type FacialSolveAnswer = { readonly ok: true; readonly frames: number; readonly rate?: number; readonly q: string; readonly t: string;
  /** Solver time (ms) and the controls the rig lacks (skipped). */
  readonly ms: number; readonly skipped: readonly string[] } |
  { readonly ok: false; readonly code: "superseded" | "unavailable" | "invalid" | "failed"; readonly message: string };

/** What the preview service publishes for a view (the drawer's readiness line and the start-point picker). */
export type FacialPreviewSnapshot = {
  /** `ready`: the head shows the solved expression; `updating`: a solve is slow to come back; `idle`: nothing is held. */
  readonly phase: "unavailable" | "preparing" | "ready" | "updating" | "idle" | "failed";
  /** Plain words for the drawer when the preview can't show the face, with the one next step. */
  readonly reason?: string;
  readonly next?: "game-setup" | "guide" | "stop-idle" | "retry";
  readonly controls?: readonly FacialControl[];
  /** The drawer's groups, in order, with their labels. */
  readonly groups?: readonly { readonly id: FacialControlGroup; readonly label: string }[];
  readonly startPoints: FacialStartPoints;
  /** The built-in starting points (empty until the host answers). */
  readonly samples: readonly FacialSample[];
  /** Two-way controls over the confirmed opposing pairs, and whether linked gaze keeps both eyes looking the same way. */
  readonly axes?: readonly FacialAxisControl[];
  readonly gazeSameWay?: boolean | null;
  /** Round-trip time of recent solves (median and slowest of the last 20), for the drawer's footnote and evidence. */
  readonly latency?: { readonly median: number; readonly max: number; readonly solver: number; readonly count: number };
};
