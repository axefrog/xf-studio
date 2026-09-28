/**
 * XF Studio's facial solver: the game's face controls (the rig's float tracks) to a local rotation and translation delta per face joint and
 * the setup's wrinkle weights. Pure: parsed game data and numbers in, typed arrays out; no Three, DOM, worker, file or network access.
 *
 * Written from the clean-room specification (research/animation/facial-solver-spec.md) and the game's own facial setup and rig; no code of
 * the Cyberpunk IO Suite is in it, and its solver was used only as a black box to check the numbers (tests/facial-solver-oracle.test.ts).
 * Section numbers below are the specification's. Where the specification left a choice open, the decision and its evidence are in the
 * specification's implementation notes; every behaviour the game may do differently is a named compile option (`FacialCompat`, §7).
 *
 * The solve allocates nothing: `compileFacialRig` flattens the setup into typed arrays once (§8.3), `createFacialPose` makes the result and
 * scratch buffers, and `solveFace` writes every value of its output.
 */

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* Types                                                                                                                                  */

/** The §7 alternatives. Each defaults to the IO Suite's reading (the only oracle); an in-game test flips one at a time. */
export interface FacialCompat {
  /** E1: `faceEnvelope` is not read (`ignore`), or it scales every mapped control at the envelope stage (`gate`). */
  readonly faceEnvelope: "ignore" | "gate";
  /** E2: `muzzleLips` acts only through the speech limits (`limits`), or also mutes envelope type 1 like the other muzzles (`envelope`). */
  readonly lipsMuzzle: "limits" | "envelope";
  /** I1: influences run twice (2), or the second pass runs only when a lipsync pose adds to a control of the part. */
  readonly influencePasses: 2 | "second-only-if-lipsync";
  /** B1: the first in-between segment fades in with the first gap's multiplier (`firstGap`) or with 1 / τ₀ (`threshold`). */
  readonly firstInbetweenSegment: "firstGap" | "threshold";
  /** C1: a corrective entry's flag is a minimum LOD (`minLod`), or is not read (`ignore`). */
  readonly correctiveFlag: "minLod" | "ignore";
  /** S1: scale poses are ignored (`ignore`), or applied as 1 + Σ w · value per axis (`apply`, a hypothesis; adds `scales` to the pose). */
  readonly scalePoses: "ignore" | "apply";
}
export const IO_SUITE_COMPAT: FacialCompat = Object.freeze({ faceEnvelope: "ignore", lipsMuzzle: "limits", influencePasses: 2,
  firstInbetweenSegment: "firstGap", correctiveFlag: "minLod", scalePoses: "ignore" });

export interface FacialCompileOptions { readonly compat?: Partial<FacialCompat> }
export interface FacialSolveOptions {
  /** Solve LOD λ (0, full detail, in the Studio). */
  readonly lod?: number;
  /** LOD fade φ (0 in the Studio). */
  readonly lodFade?: number;
  /** Receives each part's intermediate values (debugging against the oracle; the only path that allocates). */
  readonly trace?: FacialTrace;
}
/** One part's intermediate values, in solve order (tongue, eyes, face). `tracks` are copies of the whole working buffer after each stage. */
export interface FacialTracePart {
  readonly part: FacialPartName;
  readonly tracks: { readonly stage: FacialStage; readonly values: Float32Array }[];
  inbetweens?: Float32Array;
  correctivesBefore?: Float32Array;
  correctivesAfter?: Float32Array;
}
export interface FacialTrace { parts: FacialTracePart[] }
export type FacialPartName = "Tongue" | "Eyes" | "Face";
export type FacialStage = "envelopes" | "limits" | "influences" | "upperLower" | "overrides" | "lipsyncPoses" | "influences2" | "wrinkles";

/** A solve's result and scratch, for one solve at a time. */
export interface FacialPose {
  /** Per joint, rig order: the rotation delta (x, y, z, w), REDengine axes. */
  readonly rotations: Float32Array;
  /** Per joint: the translation delta (x, y, z), metres. */
  readonly translations: Float32Array;
  /** The processed track buffer: wrinkle outputs, the face pass's main weights, the rest passed through. */
  readonly tracks: Float32Array;
  /** Per joint scale factors (x, y, z), only with `scalePoses: "apply"`. */
  readonly scales?: Float32Array;
  /** @internal scratch */ readonly scratch: FacialScratch;
}
/** Many instants, frame-major. */
export interface FacialFrames { readonly frames: number; readonly rotations: Float32Array; readonly translations: Float32Array; readonly tracks: Float32Array;
  readonly scales?: Float32Array }
interface FacialScratch { q: Float64Array; t: Float64Array; s: Float64Array | null; beta: Float64Array; gamma: Float64Array; input: Float32Array; touched: Uint8Array }

export class FacialSetupError extends Error { override name = "FacialSetupError"; }

/** One part flattened (§8.3). */
interface CompiledPart {
  readonly name: FacialPartName;
  readonly env: { readonly track: Int32Array; readonly type: Uint8Array; readonly lod: Int32Array };
  readonly limits: { readonly track: Int32Array; readonly env: Uint8Array; readonly min: Float64Array; readonly mid: Float64Array; readonly max: Float64Array };
  readonly influences: { readonly track: Int32Array; readonly type: Uint8Array; readonly start: Int32Array; readonly from: Int32Array };
  readonly upperLower: { readonly track: Int32Array; readonly part: Uint8Array };
  readonly lipsync: Int32Array;
  readonly main: { readonly track: Int32Array; readonly first: Int32Array; readonly count: Int32Array; readonly firstScope: Int32Array;
    readonly thresholds: Float64Array; readonly scopes: Float64Array };
  readonly correctives: { readonly count: number; readonly globalStart: Int32Array; readonly globalTrack: Int32Array; readonly globalFlag: Uint8Array;
    readonly betweenStart: Int32Array; readonly betweenPose: Int32Array; readonly betweenFlag: Uint8Array };
  readonly correctiveInfluences: { readonly index: Int32Array; readonly type: Uint8Array; readonly start: Int32Array; readonly from: Int32Array };
  readonly wrinkles: { readonly sources: Int32Array; readonly start: number };
  readonly mainPoses: CompiledPoses;
  readonly correctivePoses: CompiledPoses;
  /** Main pose index per in-between pose (for diagnostics). */
  readonly mapped: Int32Array;
}
interface CompiledPoses {
  readonly count: number;
  /** Row starts into the transform arrays (count + 1). */
  readonly start: Int32Array;
  readonly joint: Int16Array;
  readonly rotation: Float64Array;
  readonly translation: Float64Array;
  /** Per transform: its scale (x, y, z) when its pose is a scale pose, else NaN in x. */
  readonly scale: Float64Array;
}

export interface CompiledFacialRig {
  readonly jointNames: readonly string[];
  readonly parentIndices: Int16Array;
  readonly trackNames: readonly string[];
  /** A fresh copy of the rig's rest track values. */
  referenceTracks(): Float32Array;
  trackIndex(name: string): number;
  readonly segments: { readonly envelopes: Range; readonly main: Range; readonly overrides: Range; readonly lipsyncPoses: Range; readonly wrinkles: Range };
  /** Per part: its main-pose tracks and each one's in-between thresholds (for marks on a slider). */
  readonly parts: readonly { readonly name: FacialPartName; readonly mainTracks: readonly number[]; readonly thresholds: readonly (readonly number[])[];
    readonly correctives: number }[];
  readonly faceCorrectiveNames: readonly string[];
  readonly tongueCorrectiveNames: readonly string[];
  /** Joints any pose moves, ascending. */
  readonly posedJoints: readonly number[];
  readonly compat: FacialCompat;
  /** Plain notes from compiling (another setup version; T1: a posed joint with a non-identity rest). */
  readonly warnings: readonly string[];
  /** @internal */ readonly solver: CompiledSolver;
}
export type Range = { readonly start: number; readonly count: number };
interface CompiledSolver {
  readonly joints: number; readonly tracks: number; readonly reference: Float32Array;
  readonly order: readonly CompiledPart[];
  readonly overrideMap: Int32Array; readonly overrideStart: number; readonly lipsyncStart: number; readonly envelopes: number;
  /** Rest per joint: t (3), q (4), s (3). */
  readonly rest: Float64Array;
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* Reading the JSON                                                                                                                       */

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
/** A document (`{Data: {RootChunk}}`) or its root. */
const rootOf = (value: unknown, what: string): Obj => {
  const root = isObj(value) && isObj(value.Data) && isObj((value.Data as Obj).RootChunk) ? (value.Data as Obj).RootChunk : value;
  if (!isObj(root)) throw new FacialSetupError(`The ${what} couldn't be read.`);
  return root as Obj;
};
const nameOf = (value: unknown): string => typeof value === "string" ? value : isObj(value) && typeof value.$value === "string" ? value.$value : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const num = (value: unknown, what: string): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new FacialSetupError(`The facial setup is damaged (${what}).`);
  return n;
};
const int = (value: unknown, what: string): number => {
  const n = num(value, what);
  if (!Number.isInteger(n) || n < 0) throw new FacialSetupError(`The facial setup is damaged (${what}).`);
  return n;
};
/** A parsed buffer's `Data` (WolvenKit JSON and the native reader both write `{BufferId, Flags, Type, Data}`). */
const bufferData = (value: unknown): Obj | null => isObj(value) && isObj(value.Data) ? value.Data as Obj : null;

/** The envelope names the solver reads by position (§3.3). */
export const ENVELOPE_NAMES = ["faceEnvelope", "upperFace", "lowerFace", "antiStretch", "lipSyncEnvelope", "lipSyncLeftEnvelope", "lipSyncRightEnvelope",
  "jaliJaw", "jaliLips", "muzzleLips", "muzzleEyes", "muzzleBrows", "muzzleEyeDirections"] as const;
/** Solve order (§4.1). */
const PART_ORDER: readonly FacialPartName[] = ["Tongue", "Eyes", "Face"];
const INFO_KEY: Readonly<Record<FacialPartName, string>> = { Face: "face", Eyes: "eyes", Tongue: "tongue" };
/** ε_w (§5.6), compared as the float32 0.001: a control of exactly 0.001 is below it (implementation note 1). */
export const WEIGHT_EPSILON = Math.fround(0.001);
const FULL_WEIGHT = 1 - 1e-5;
const NLERP_GUARD = 1e-8;

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* Compiling                                                                                                                              */

/**
 * Validate and flatten a rig and facial setup (WolvenKit-shaped JSON documents or their `RootChunk`s; the native reader writes the same
 * shape) into typed arrays (§3.5, §8.3). Throws `FacialSetupError` with a plain reason.
 */
export function compileFacialRig(rigJson: unknown, setupJson: unknown, options: FacialCompileOptions = {}): CompiledFacialRig {
  const compat: FacialCompat = Object.freeze({ ...IO_SUITE_COMPAT, ...options.compat });
  const rig = rootOf(rigJson, "face skeleton"), setup = rootOf(setupJson, "facial setup");
  const warnings: string[] = [];
  // The rig.
  const jointNames = list(rig.boneNames).map(nameOf), parents = list(rig.boneParentIndexes), transforms = list(rig.boneTransforms);
  const trackNames = list(rig.trackNames).map(nameOf), reference = list(rig.referenceTracks);
  const J = jointNames.length, T = trackNames.length;
  if (!J || parents.length !== J || transforms.length !== J) throw new FacialSetupError("The face skeleton is damaged: its joints and rest pose don't match.");
  if (reference.length !== T) throw new FacialSetupError("The face skeleton is damaged: its tracks and rest values don't match.");
  if (J > 0x7fff) throw new FacialSetupError("The face skeleton has more joints than XF Studio's solver takes.");
  const parentIndices = new Int16Array(J), rest = new Float64Array(J * 10);
  for (let j = 0; j < J; j++) {
    const p = Number(parents[j]);
    if (!Number.isInteger(p) || p >= j || p < -1) throw new FacialSetupError("The face skeleton is damaged: a joint comes before its parent.");
    parentIndices[j] = p;
    const qs = isObj(transforms[j]) ? transforms[j] as Obj : {};
    const tr = isObj(qs.Translation) ? qs.Translation as Obj : {}, ro = isObj(qs.Rotation) ? qs.Rotation as Obj : {}, sc = isObj(qs.Scale) ? qs.Scale as Obj : {};
    const values = [tr.X ?? 0, tr.Y ?? 0, tr.Z ?? 0, ro.i ?? 0, ro.j ?? 0, ro.k ?? 0, ro.r ?? 1, sc.X ?? 1, sc.Y ?? 1, sc.Z ?? 1].map(v => num(v, "rest pose"));
    rest.set(values, j * 10);
  }
  const referenceTracks = Float32Array.from(reference, v => num(v, "rest tracks"));
  // The setup (§3.5).
  const version = Number(setup.version);
  if (version !== 8) warnings.push(`The facial setup is version ${Number.isFinite(version) ? version : "unknown"}; XF Studio's solver was checked on version 8.`);
  const baked = bufferData(setup.bakedData), mainData = bufferData(setup.mainPosesData), corrData = bufferData(setup.correctivePosesData);
  if (!baked || !mainData || !corrData) throw new FacialSetupError("This facial setup has no baked data, so XF Studio can't solve it.");
  const info = isObj(setup.info) ? setup.info as Obj : {}, mapping = isObj(info.tracksMapping) ? info.tracksMapping as Obj : {};
  const nE = int(mapping.numEnvelopes ?? 0, "numEnvelopes"), nM = int(mapping.numMainPoses ?? 0, "numMainPoses"),
    nO = int(mapping.numLipsyncOverrides ?? 0, "numLipsyncOverrides"), nW = int(mapping.numWrinkles ?? 0, "numWrinkles");
  const overrideStart = nE + nM, lipsyncStart = overrideStart + nO, wrinkleStart = lipsyncStart + nM;
  if (wrinkleStart + nW > T) throw new FacialSetupError("This facial setup needs more controls than the face skeleton has; they don't belong together.");
  if (nE !== ENVELOPE_NAMES.length || ENVELOPE_NAMES.some((name, i) => trackNames[i] !== name))
    throw new FacialSetupError("The face skeleton's first controls aren't the envelopes the facial setup expects; they don't belong together.");
  const isMain = (k: number) => k >= nE && k < overrideStart;
  const overrideMap = Int32Array.from(list(baked.LipsyncOverridesIndexMapping), (v, i) => {
    const k = int(v, `lipsync override ${i}`);
    if (!isMain(k)) throw new FacialSetupError("The facial setup's lipsync overrides point outside its controls.");
    return k;
  });
  if (overrideMap.length !== nO) throw new FacialSetupError("The facial setup's lipsync overrides don't match its counts.");
  const track = (value: unknown, what: string) => {
    const k = int(value, what);
    if (k >= T) throw new FacialSetupError(`The facial setup names a control the face skeleton doesn't have (${what}).`);
    return k;
  };
  const partInfo = (name: FacialPartName) => isObj(info[INFO_KEY[name]]) ? info[INFO_KEY[name]] as Obj : {};
  const compiled = new Map<FacialPartName, CompiledPart>();
  const posed = new Set<number>();
  for (const name of PART_ORDER) {
    const b = isObj(baked[name]) ? baked[name] as Obj : null, mp = isObj(mainData[name]) ? mainData[name] as Obj : null, cp = isObj(corrData[name]) ? corrData[name] as Obj : null;
    if (!b || !mp || !cp) throw new FacialSetupError(`The facial setup has no ${name.toLowerCase()} part.`);
    const pi = partInfo(name);
    const expect = (key: string, table: string) => {
      const have = list(b[table]).length, want = pi[key] === undefined ? have : int(pi[key], key);
      if (have !== want) throw new FacialSetupError(`The facial setup's ${name.toLowerCase()} ${table} don't match their count.`);
    };
    expect("numEnvelopesPerTrackMapping", "EnvelopesPerTrackMapping"); expect("numGlobalLimits", "GlobalLimits"); expect("numInfluencedPoses", "InfluencedPoses");
    expect("numInfluenceIndices", "InfluenceIndices"); expect("numUpperLowerFace", "UpperLowerFace"); expect("numLipsyncPosesSides", "LipsyncPosesSides");
    expect("numGlobalCorrectiveEntries", "GlobalCorrectiveEntries"); expect("numInbetweenCorrectiveEntries", "InbetweenCorrectiveEntries");
    expect("numCorrectiveInfluencedPoses", "CorrectiveInfluencedPoses"); expect("numCorrectiveInfluenceIndices", "CorrectiveInfluenceIndices");
    expect("numAllMainPoses", "AllMainPoses"); expect("numAllMainPosesInbetweens", "AllMainPosesInbetweens");
    expect("numAllMainPosesInbetweenScopeMultipliers", "AllMainPosesInbetweenScopeMultipliers"); expect("numWrinkles", "Wrinkles");
    const rows = (table: string) => list(b[table]).map(v => isObj(v) ? v : {});
    // Envelopes.
    const envRows = rows("EnvelopesPerTrackMapping");
    const env = { track: Int32Array.from(envRows, (e, i) => track(e.Track, `envelope ${i}`)), type: Uint8Array.from(envRows, e => int(e.Envelope ?? 0, "envelope type")),
      lod: Int32Array.from(envRows, e => int(e.LevelOfDetail ?? 0, "envelope LOD")) };
    for (const k of env.track) if (!isMain(k)) throw new FacialSetupError(`The facial setup's ${name.toLowerCase()} part maps a control outside its main poses.`);
    // Limits.
    const limRows = rows("GlobalLimits");
    const limits = { track: Int32Array.from(limRows, (e, i) => track(e.Track, `limit ${i}`)), env: Uint8Array.from(limRows, e => int(e.Envelope ?? 0, "limit envelope")),
      min: Float64Array.from(limRows, e => num(e.Min ?? 0, "limit")), mid: Float64Array.from(limRows, e => num(e.Mid ?? 0, "limit")),
      max: Float64Array.from(limRows, e => num(e.Max ?? 0, "limit")) };
    // Influences (rows: the next NumInfluences entries of the index list).
    const influences = influenceRows(rows("InfluencedPoses"), list(b.InfluenceIndices), "Track", v => track(v, "influence"), `${name} influences`);
    // Upper / lower face.
    const ulRows = rows("UpperLowerFace");
    const upperLower = { track: Int32Array.from(ulRows, (e, i) => track(e.Track, `upper/lower ${i}`)), part: Uint8Array.from(ulRows, e => int(e.Part ?? 0, "upper/lower part")) };
    if ([...upperLower.part].some(p => p > 2)) warnings.push(`The ${name.toLowerCase()} part scales a control by an unknown face part; it is left unscaled.`);
    const lipsync = Int32Array.from(rows("LipsyncPosesSides"), (e, i) => {
      const k = track(e.Track, `lipsync pose ${i}`);
      if (!isMain(k)) throw new FacialSetupError("The facial setup adds a lipsync pose to a control outside its main poses.");
      return k;
    });
    // Main poses and in-betweens.
    const mainRows = rows("AllMainPoses"), thresholds = list(b.AllMainPosesInbetweens).map(v => num(v, "in-between")),
      scopes = list(b.AllMainPosesInbetweenScopeMultipliers).map(v => num(v, "in-between multiplier"));
    const main = { track: new Int32Array(mainRows.length), first: new Int32Array(mainRows.length), count: new Int32Array(mainRows.length),
      firstScope: new Int32Array(mainRows.length), thresholds: Float64Array.from(thresholds), scopes: Float64Array.from(scopes) };
    let between = 0, scope = 0;
    const mapped: number[] = [];
    mainRows.forEach((row, i) => {
      const n = int(row.NumInbetweens ?? 0, "in-between count");
      if (n < 1) throw new FacialSetupError("A main pose of the facial setup has no in-betweens.");
      main.track[i] = track(row.Track, `main pose ${i}`); main.first[i] = between; main.count[i] = n; main.firstScope[i] = scope;
      for (let j = 0; j < n; j++) mapped.push(i);
      for (let j = 1; j < n; j++) if (!(thresholds[between + j]! > thresholds[between + j - 1]!)) throw new FacialSetupError("A main pose's in-betweens aren't in order.");
      between += n; scope += n - 1;
    });
    if (between !== thresholds.length || scope !== scopes.length) throw new FacialSetupError("The facial setup's in-betweens don't match its main poses.");
    // Pose buffers.
    const mainPoses = compilePoses(mp, J, `${name} main poses`), correctivePoses = compilePoses(cp, J, `${name} correctives`);
    if (mainPoses.count !== between) throw new FacialSetupError(`The facial setup's ${name.toLowerCase()} main pose buffer doesn't match its in-betweens.`);
    const C = correctivePoses.count;
    if (pi.numAllCorrectives !== undefined && int(pi.numAllCorrectives, "numAllCorrectives") !== C)
      throw new FacialSetupError(`The facial setup's ${name.toLowerCase()} correctives don't match their pose buffer.`);
    for (const poses of [mainPoses, correctivePoses]) for (const j of poses.joint) posed.add(j);
    // Correctives: entries grouped by corrective, file order kept within one.
    const group = (table: string, driver: (value: unknown, i: number) => number) => {
      const entries = rows(table), start = new Int32Array(C + 1), drivers = new Int32Array(entries.length), flags = new Uint8Array(entries.length);
      const index = entries.map((e, i) => { const c = int(e.Index, `${table} ${i}`); if (c >= C) throw new FacialSetupError(`The facial setup's ${table} name a corrective it doesn't have.`); return c; });
      for (const c of index) start[c + 1]!++;
      for (let c = 0; c < C; c++) start[c + 1]! += start[c]!;
      const fill = start.slice(0, C);
      entries.forEach((e, i) => { const at = fill[index[i]!]!++; drivers[at] = driver(e.Track, i); flags[at] = int(e.Unknown ?? 0, "corrective flag"); });
      return { start, drivers, flags };
    };
    const globals = group("GlobalCorrectiveEntries", (v, i) => track(v, `corrective entry ${i}`));
    const betweens = group("InbetweenCorrectiveEntries", (v, i) => {
      const at = int(v, `in-between corrective ${i}`);
      if (at >= between) throw new FacialSetupError("A corrective of the facial setup follows an in-between it doesn't have.");
      return at;
    });
    const correctiveInfluences = influenceRows(rows("CorrectiveInfluencedPoses"), list(b.CorrectiveInfluenceIndices), "Index", v => {
      const c = int(v, "corrective influence"); if (c >= C) throw new FacialSetupError("A corrective influence names a corrective the setup doesn't have."); return c;
    }, `${name} corrective influences`);
    for (const c of correctiveInfluences.track) if (c >= C) throw new FacialSetupError("A corrective influence names a corrective the setup doesn't have.");
    const wrinkleStartIndex = pi.wrinkleStartingIndex === undefined ? wrinkleStart : int(pi.wrinkleStartingIndex, "wrinkleStartingIndex");
    const sources = Int32Array.from(list(b.Wrinkles), (v, i) => track(v, `wrinkle ${i}`));
    if (wrinkleStartIndex + sources.length > T) throw new FacialSetupError("The facial setup's wrinkle outputs run past the face skeleton's controls.");
    compiled.set(name, { name, env, limits, influences, upperLower, lipsync, main, mainPoses, correctivePoses, mapped: Int32Array.from(mapped),
      correctives: { count: C, globalStart: globals.start, globalTrack: globals.drivers, globalFlag: globals.flags,
        betweenStart: betweens.start, betweenPose: betweens.drivers, betweenFlag: betweens.flags },
      correctiveInfluences: { index: correctiveInfluences.track, type: correctiveInfluences.type, start: correctiveInfluences.start, from: correctiveInfluences.from },
      wrinkles: { sources, start: wrinkleStartIndex } });
  }
  const posedJoints = [...posed].sort((a, b) => a - b);
  // T1: the delta is applied after the rest; for a posed joint with a turned or scaled rest that composition matters (§4.15).
  const offRest = posedJoints.filter(j => Math.abs(rest[j * 10 + 3]!) > 1e-6 || Math.abs(rest[j * 10 + 4]!) > 1e-6 || Math.abs(rest[j * 10 + 5]!) > 1e-6
    || Math.abs(rest[j * 10 + 7]! - 1) > 1e-6 || Math.abs(rest[j * 10 + 8]! - 1) > 1e-6 || Math.abs(rest[j * 10 + 9]! - 1) > 1e-6);
  if (offRest.length) warnings.push(`${offRest.length} posed joints of this face skeleton have a turned or scaled rest; how the game composes their poses is unchecked.`);
  const order = PART_ORDER.map(name => compiled.get(name)!);
  const byName = new Map(trackNames.map((name, i) => [name, i] as const));
  const solver: CompiledSolver = { joints: J, tracks: T, reference: referenceTracks, order, overrideMap, overrideStart, lipsyncStart, envelopes: nE, rest };
  return Object.freeze({
    jointNames: Object.freeze(jointNames), parentIndices, trackNames: Object.freeze(trackNames),
    referenceTracks: () => referenceTracks.slice(), trackIndex: (name: string) => byName.get(name) ?? -1,
    segments: Object.freeze({ envelopes: { start: 0, count: nE }, main: { start: nE, count: nM }, overrides: { start: overrideStart, count: nO },
      lipsyncPoses: { start: lipsyncStart, count: nM }, wrinkles: { start: wrinkleStart, count: nW } }),
    parts: Object.freeze(order.map(part => Object.freeze({ name: part.name, mainTracks: Object.freeze([...part.main.track]),
      thresholds: Object.freeze([...part.main.track].map((_, i) => Object.freeze([...part.main.thresholds.subarray(part.main.first[i]!, part.main.first[i]! + part.main.count[i]!)]))),
      correctives: part.correctives.count }))),
    faceCorrectiveNames: Object.freeze(list(setup.faceCorrectiveNames).map(nameOf)), tongueCorrectiveNames: Object.freeze(list(setup.tongueCorrectiveNames).map(nameOf)),
    posedJoints: Object.freeze(posedJoints), compat, warnings: Object.freeze(warnings), solver,
  });
}

/** Rows that each own the next `NumInfluences` entries of a flat index list (§4.5, §4.12). */
function influenceRows(rows: Obj[], indices: unknown[], key: "Track" | "Index", resolve: (value: unknown) => number, what: string) {
  const track = new Int32Array(rows.length), type = new Uint8Array(rows.length), start = new Int32Array(rows.length + 1);
  let at = 0;
  rows.forEach((row, i) => {
    track[i] = resolve(row[key]); type[i] = int(row.Type ?? 0, `${what} type`);
    const n = int(row.NumInfluences ?? 0, `${what} count`);
    start[i] = at; at += n;
  });
  start[rows.length] = at;
  if (at !== indices.length) throw new FacialSetupError(`The facial setup's ${what} don't match their index list.`);
  const from = Int32Array.from(indices, v => resolve(v));
  return { track, type, start, from };
}

function compilePoses(data: Obj, joints: number, what: string): CompiledPoses {
  const poses = list(data.Poses).map(v => isObj(v) ? v : {}), transforms = list(data.Transforms).map(v => isObj(v) ? v : {}), scales = list(data.Scales).map(v => isObj(v) ? v : {});
  const start = new Int32Array(poses.length + 1);
  let total = 0;
  const ranges = poses.map((pose, i) => {
    const first = int(pose.TransformIdx ?? 0, `${what} ${i}`), n = int(pose.NumTransforms ?? 0, `${what} ${i}`);
    if (first + n > transforms.length) throw new FacialSetupError(`The facial setup's ${what} run past their transforms.`);
    const isScale = int(pose.IsScale ?? 0, "IsScale") !== 0, scaleFirst = int(pose.ScaleIdx ?? 0, "ScaleIdx");
    if (isScale && scaleFirst + n > scales.length) throw new FacialSetupError(`The facial setup's ${what} run past their scales.`);
    start[i] = total; total += n;
    // Ranges that overlap could otherwise ask for up to poses × 32,767 flattened transforms from a small file; the game's setups share none,
    // so the flattened total can never exceed the transforms the file holds.
    if (total > transforms.length) throw new FacialSetupError(`The facial setup is damaged: its ${what} use more transforms than it holds.`);
    return { first, n, isScale, scaleFirst };
  });
  start[poses.length] = total;
  const joint = new Int16Array(total), rotation = new Float64Array(total * 4), translation = new Float64Array(total * 3), scale = new Float64Array(total * 3).fill(NaN);
  ranges.forEach((range, i) => {
    for (let k = 0; k < range.n; k++) {
      const at = start[i]! + k, t = transforms[range.first + k]!;
      const bone = int(t.Bone, `${what} joint`);
      if (bone >= joints) throw new FacialSetupError(`The facial setup moves a joint the face skeleton doesn't have (${what}).`);
      joint[at] = bone;
      const r = isObj(t.Rotation) ? t.Rotation as Obj : {}, p = isObj(t.Translation) ? t.Translation as Obj : {};
      rotation[at * 4] = num(r.i ?? 0, what); rotation[at * 4 + 1] = num(r.j ?? 0, what); rotation[at * 4 + 2] = num(r.k ?? 0, what); rotation[at * 4 + 3] = num(r.r ?? 1, what);
      // Stored as float32 in the file; kept as stored (§5.3), only widened.
      for (let c = 0; c < 4; c++) rotation[at * 4 + c] = Math.fround(rotation[at * 4 + c]!);
      translation[at * 3] = Math.fround(num(p.X ?? 0, what)); translation[at * 3 + 1] = Math.fround(num(p.Y ?? 0, what)); translation[at * 3 + 2] = Math.fround(num(p.Z ?? 0, what));
      if (range.isScale) {
        const s = scales[range.scaleFirst + k]!;
        scale[at * 3] = Math.fround(num(s.i ?? 0, what)); scale[at * 3 + 1] = Math.fround(num(s.j ?? 0, what)); scale[at * 3 + 2] = Math.fround(num(s.k ?? 0, what));
      }
    }
  });
  return { count: poses.length, start, joint, rotation, translation, scale };
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* Solving                                                                                                                                */

/** Result and scratch buffers for one solve at a time, allocated once per compiled rig. */
export function createFacialPose(rig: CompiledFacialRig): FacialPose {
  const s = rig.solver, apply = rig.compat.scalePoses === "apply";
  let beta = 0, gamma = 0;
  for (const part of s.order) { beta = Math.max(beta, part.mainPoses.count); gamma = Math.max(gamma, part.correctives.count); }
  return { rotations: new Float32Array(s.joints * 4), translations: new Float32Array(s.joints * 3), tracks: new Float32Array(s.tracks),
    ...(apply ? { scales: new Float32Array(s.joints * 3) } : {}),
    scratch: { q: new Float64Array(s.joints * 4), t: new Float64Array(s.joints * 3), s: apply ? new Float64Array(s.joints * 3) : null,
      beta: new Float64Array(beta), gamma: new Float64Array(gamma), input: new Float32Array(s.tracks), touched: new Uint8Array(s.joints) } };
}

/** clamp01 (§2); a NaN becomes 0 rather than passing through. */
const clamp01 = (x: number) => x > 0 ? (x < 1 ? x : 1) : 0;
/** The default solve options, shared so a solve allocates nothing (§8.2). */
const NO_SOLVE_OPTIONS: FacialSolveOptions = Object.freeze({});

/**
 * Solve one instant (§4). `tracks` holds absolute values for every track of the rig (reference plus clip or control values, §3.3). Writes
 * every value of `out` and returns it. Throws `FacialSetupError` for a vector of the wrong length or holding a NaN or an infinity; allocates nothing
 * unless a trace is asked for.
 */
export function solveFace(rig: CompiledFacialRig, tracks: Float32Array | Float64Array | readonly number[], out: FacialPose, options: FacialSolveOptions = NO_SOLVE_OPTIONS): FacialPose {
  const s = rig.solver, T = s.tracks, J = s.joints, compat = rig.compat;
  if (tracks.length !== T) throw new FacialSetupError(`A face pose needs ${T} control values; ${tracks.length} were given.`);
  const I = out.scratch.input, O = out.tracks;
  for (let k = 0; k < T; k++) {
    const v = tracks[k]!;
    if (!Number.isFinite(v)) throw new FacialSetupError("A face pose holds an invalid number.");
    I[k] = v;
  }
  O.set(I);
  const q = out.scratch.q, t = out.scratch.t, sc = out.scratch.s, touched = out.scratch.touched;
  q.fill(0); t.fill(0); touched.fill(0);
  for (let j = 0; j < J; j++) q[j * 4 + 3] = 1;
  if (sc) sc.fill(0);
  const lod = options.lod ?? 0, fade = options.lodFade ?? 0, trace = options.trace;
  const order = s.order;
  for (let p = 0; p < order.length; p++) solvePart(s, order[p]!, I, O, q, t, sc, touched, out.scratch.beta, out.scratch.gamma, lod, fade, compat, trace);
  const R = out.rotations, P = out.translations;
  for (let i = 0; i < J * 4; i++) R[i] = q[i]!;
  for (let i = 0; i < J * 3; i++) P[i] = t[i]!;
  if (sc && out.scales) for (let i = 0; i < J * 3; i++) out.scales[i] = 1 + sc[i]!;
  return out;
}

function snapshot(trace: FacialTracePart | undefined, stage: FacialStage, O: Float32Array) {
  if (trace) trace.tracks.push({ stage, values: O.slice() });
}

function solvePart(s: CompiledSolver, part: CompiledPart, I: Float32Array, O: Float32Array, q: Float64Array, t: Float64Array, sc: Float64Array | null,
  touched: Uint8Array, beta: Float64Array, gamma: Float64Array, lod: number, fade: number, compat: FacialCompat, trace: FacialTrace | undefined) {
  const record: FacialTracePart | undefined = trace ? { part: part.name, tracks: [] } : undefined;
  if (record) trace!.parts.push(record);
  // §4.2 globals (O still holds the input at the envelope positions).
  const upper = clamp01(O[1]!), lower = clamp01(O[2]!), lipEnv = clamp01(O[4]!);
  const jaliJaw = Math.min(2, Math.max(0, O[7]!)), jaliLips = Math.min(2, Math.max(0, O[8]!));
  const mLips = clamp01(O[9]!), mEyes = clamp01(O[10]!), mBrows = clamp01(O[11]!), mDir = clamp01(O[12]!);
  const gate = compat.faceEnvelope === "gate" ? clamp01(O[0]!) : 1;
  // §4.3 envelopes: muzzles and LOD, from the input.
  const env = part.env;
  for (let e = 0; e < env.track.length; e++) {
    const k = env.track[e]!, type = env.type[e]!, level = env.lod[e]!;
    const f = type === 2 ? 1 - mEyes : type === 3 ? 1 - mBrows : type === 4 ? 1 - mDir : type === 1 && compat.lipsMuzzle === "envelope" ? 1 - mLips : 1;
    const g = level < lod ? 0 : level === lod ? 1 - fade : 1;
    let w = clamp01(I[k]!) * f * g * gate;
    if (w <= WEIGHT_EPSILON) w = 0;
    O[k] = w;
  }
  snapshot(record, "envelopes", O);
  // §4.4 speech limits.
  if (lipEnv !== 0) {
    const L = part.limits;
    for (let e = 0; e < L.track.length; e++) {
      const k = L.track[e]!, strength = L.env[e] === 0 ? jaliJaw : L.env[e] === 1 ? jaliLips : 1;
      const min = L.min[e]!, mid = L.mid[e]!, max = L.max[e]!;
      let cap: number;
      if (strength <= 1) { cap = min + strength * (mid - min); cap = mid >= min ? Math.min(mid, Math.max(min, cap)) : Math.min(min, Math.max(mid, cap)); }
      else { cap = mid + (strength - 1) * (max - mid); cap = max >= mid ? Math.min(max, Math.max(mid, cap)) : Math.min(mid, Math.max(max, cap)); }
      const w = O[k]!;
      if (w > cap) O[k] = w + mLips * (cap - w);
    }
  }
  snapshot(record, "limits", O);
  // §4.5 influences, first pass.
  influences(part, O);
  snapshot(record, "influences", O);
  // §4.6 upper and lower face.
  const UL = part.upperLower;
  for (let e = 0; e < UL.track.length; e++) {
    const k = UL.track[e]!, p = UL.part[e]!;
    O[k] = clamp01(O[k]! * (p === 1 ? upper : p === 2 ? lower : 1));
  }
  snapshot(record, "upperLower", O);
  // §4.7 lipsync overrides: over every override, on the shared buffer, in each part's pass (the IO Suite's order; implementation note 2).
  if (lipEnv !== 0) {
    const map = s.overrideMap, start = s.overrideStart;
    for (let i = 0; i < map.length; i++) { const k = map[i]!; O[k] = O[k]! * (1 + lipEnv * (I[start + i]! - 1)); }
  }
  snapshot(record, "overrides", O);
  // §4.8 lipsync poses: added, ungated and side-blind.
  const LS = part.lipsync, shift = s.lipsyncStart - s.envelopes;
  let lipsyncAdded = false;
  for (let e = 0; e < LS.length; e++) {
    const k = LS[e]!, added = I[k + shift]!;
    if (added !== 0) lipsyncAdded = true;
    O[k] = clamp01(O[k]! + added);
  }
  snapshot(record, "lipsyncPoses", O);
  // §4.9 influences, second pass.
  if (compat.influencePasses === 2 || lipsyncAdded) influences(part, O);
  snapshot(record, "influences2", O);
  // §4.10 in-betweens.
  const M = part.main, B = part.mainPoses.count;
  beta.fill(0, 0, B);
  const byThreshold = compat.firstInbetweenSegment === "threshold";
  for (let i = 0; i < M.track.length; i++) {
    const w = O[M.track[i]!]!;
    if (w < WEIGHT_EPSILON) continue;
    const n = M.count[i]!, b0 = M.first[i]!, s0 = M.firstScope[i]!;
    if (n === 1) { beta[b0] = w; continue; }
    const th = M.thresholds, sg = M.scopes;
    if (w <= th[b0]!) { beta[b0] = byThreshold ? w / th[b0]! : w * sg[s0]!; continue; }
    if (w >= th[b0 + n - 1]!) { beta[b0 + n - 1] = 1; continue; }
    for (let j = 0; j < n - 1; j++) {
      if (th[b0 + j]! <= w && w < th[b0 + j + 1]!) {
        const x = (w - th[b0 + j]!) * sg[s0 + j]!;
        beta[b0 + j] = 1 - x; beta[b0 + j + 1] = x;
        break;
      }
    }
  }
  if (record) record.inbetweens = Float32Array.from(beta.subarray(0, B));
  // §4.11 corrective weights.
  const C = part.correctives, nC = C.count, flags = compat.correctiveFlag === "minLod";
  for (let c = 0; c < nC; c++) {
    let g = 1;
    for (let e = C.globalStart[c]!; e < C.globalStart[c + 1]!; e++) {
      if (flags && C.globalFlag[e]! > lod) { g = 0; break; }
      g *= clamp01(O[C.globalTrack[e]!]!);
    }
    if (g > 0) {
      for (let e = C.betweenStart[c]!; e < C.betweenStart[c + 1]!; e++) {
        if (flags && C.betweenFlag[e]! > lod) { g = 0; break; }
        const at = C.betweenPose[e]!;
        g *= at < B ? clamp01(beta[at]!) : 0;
      }
    }
    gamma[c] = g;
  }
  if (record) record.correctivesBefore = Float32Array.from(gamma.subarray(0, nC));
  // §4.12 corrective influences, in place.
  const CI = part.correctiveInfluences;
  for (let e = 0; e < CI.index.length; e++) {
    const c = CI.index[e]!, g = gamma[c]!;
    if (g <= WEIGHT_EPSILON) continue;
    let sum = 0;
    for (let f = CI.start[e]!; f < CI.start[e + 1]!; f++) sum += gamma[CI.from[f]!]!;
    const type = CI.type[e]! & 3;
    const result = type === 0 ? (sum >= 1 ? 0 : Math.min(g, 1 - sum)) : type === 1 ? (sum >= 1 ? 0 : g * (1 - sum * sum))
      : type === 2 ? g * (1 - sum) : g * (1 - sum) * (1 - sum);
    gamma[c] = result > 0 ? result : 0;
  }
  if (record) record.correctivesAfter = Float32Array.from(gamma.subarray(0, nC));
  // §4.13 pose blending: main poses, then correctives, each in pose order.
  blend(part.mainPoses, beta, q, t, sc, touched);
  blend(part.correctivePoses, gamma, q, t, sc, touched);
  // §4.14 wrinkles.
  const W = part.wrinkles;
  for (let i = 0; i < W.sources.length; i++) { const r = 1 - O[W.sources[i]!]!; O[W.start + i] = clamp01(1 - r * r); }
  snapshot(record, "wrinkles", O);
}

function influences(part: CompiledPart, O: Float32Array) {
  const inf = part.influences;
  for (let e = 0; e < inf.track.length; e++) {
    const k = inf.track[e]!;
    let w = O[k]!;
    if (w <= 0) continue;
    let sum = 0;
    for (let f = inf.start[e]!; f < inf.start[e + 1]!; f++) sum += O[inf.from[f]!]!;
    if (sum >= 1) w = 0;
    else {
      const type = inf.type[e]!;
      if (type === 0) w = Math.min(w, 1 - sum);
      else if (type === 1) w = w * (1 - sum * sum);
      else if (type === 2) w = w * (1 - sum) * (1 - sum);
    }
    O[k] = w;
  }
}

function blend(poses: CompiledPoses, weights: Float64Array, q: Float64Array, t: Float64Array, sc: Float64Array | null, touched: Uint8Array) {
  const start = poses.start, joint = poses.joint, rot = poses.rotation, tr = poses.translation;
  for (let b = 0; b < poses.count; b++) {
    const w = weights[b]!;
    if (!(w > WEIGHT_EPSILON)) continue;
    const full = w >= FULL_WEIGHT;
    for (let at = start[b]!; at < start[b + 1]!; at++) {
      const j = joint[at]!, jq = j * 4, jt = j * 3, a4 = at * 4, a3 = at * 3;
      touched[j] = 1;
      t[jt] += w * tr[a3]!; t[jt + 1] += w * tr[a3 + 1]!; t[jt + 2] += w * tr[a3 + 2]!;
      if (sc && poses.scale[a3] === poses.scale[a3]) { sc[jt] += w * poses.scale[a3]!; sc[jt + 1] += w * poses.scale[a3 + 1]!; sc[jt + 2] += w * poses.scale[a3 + 2]!; }
      // r = q ⊗ Δq (Hamilton product).
      const ax = q[jq]!, ay = q[jq + 1]!, az = q[jq + 2]!, aw = q[jq + 3]!;
      const bx = rot[a4]!, by = rot[a4 + 1]!, bz = rot[a4 + 2]!, bw = rot[a4 + 3]!;
      let rx = aw * bx + bw * ax + ay * bz - az * by;
      let ry = aw * by + bw * ay + az * bx - ax * bz;
      let rz = aw * bz + bw * az + ax * by - ay * bx;
      let rw = aw * bw - ax * bx - ay * by - az * bz;
      if (full) { q[jq] = rx; q[jq + 1] = ry; q[jq + 2] = rz; q[jq + 3] = rw; continue; }
      if (ax * rx + ay * ry + az * rz + aw * rw < 0) { rx = -rx; ry = -ry; rz = -rz; rw = -rw; }
      const mx = ax + w * (rx - ax), my = ay + w * (ry - ay), mz = az + w * (rz - az), mw = aw + w * (rw - aw);
      const norm = Math.sqrt(mx * mx + my * my + mz * mz + mw * mw);
      if (norm >= NLERP_GUARD) { const inv = 1 / norm; q[jq] = mx * inv; q[jq + 1] = my * inv; q[jq + 2] = mz * inv; q[jq + 3] = mw * inv; }
    }
  }
}

/** Solve many instants (`frames`: F × T values, frame-major) into one set of frame-major arrays. */
export function solveFaceFrames(rig: CompiledFacialRig, frames: Float32Array | Float64Array, out?: FacialFrames, options: Omit<FacialSolveOptions, "trace"> = NO_SOLVE_OPTIONS): FacialFrames {
  const T = rig.solver.tracks, J = rig.solver.joints;
  if (frames.length % T !== 0) throw new FacialSetupError(`Face frames need ${T} control values each.`);
  const F = frames.length / T, apply = rig.compat.scalePoses === "apply";
  const result = out && out.frames === F ? out : { frames: F, rotations: new Float32Array(F * J * 4), translations: new Float32Array(F * J * 3),
    tracks: new Float32Array(F * T), ...(apply ? { scales: new Float32Array(F * J * 3) } : {}) };
  const pose = createFacialPose(rig);
  for (let f = 0; f < F; f++) {
    solveFace(rig, frames.subarray(f * T, (f + 1) * T), pose, options);
    result.rotations.set(pose.rotations, f * J * 4); result.translations.set(pose.translations, f * J * 3); result.tracks.set(pose.tracks, f * T);
    if (pose.scales && result.scales) result.scales.set(pose.scales, f * J * 3);
  }
  return result;
}

/**
 * Local transforms per joint (§4.15): the rest followed by the solved delta. Writes `out` (10 × J: translation x y z, rotation x y z w,
 * scale x y z) in REDengine axes, or glTF axes (x, z, −y) with `axes: "gltf"`. Returns `out`.
 */
export function composeLocalPose(rig: CompiledFacialRig, pose: Pick<FacialPose, "rotations" | "translations" | "scales">, out: Float32Array, axes: "red" | "gltf" = "red",
  frame = 0): Float32Array {
  const J = rig.solver.joints, rest = rig.solver.rest;
  if (out.length < J * 10) throw new FacialSetupError(`A local pose needs ${J * 10} values.`);
  const R = pose.rotations, P = pose.translations, S = pose.scales, qo = frame * J * 4, to = frame * J * 3;
  for (let j = 0; j < J; j++) {
    const r = j * 10;
    const tx = rest[r]!, ty = rest[r + 1]!, tz = rest[r + 2]!, x = rest[r + 3]!, y = rest[r + 4]!, z = rest[r + 5]!, w = rest[r + 6]!;
    const sx = rest[r + 7]!, sy = rest[r + 8]!, sz = rest[r + 9]!;
    const dx = R[qo + j * 4]!, dy = R[qo + j * 4 + 1]!, dz = R[qo + j * 4 + 2]!, dw = R[qo + j * 4 + 3]!;
    // rotation: q_rest ⊗ q_delta
    const qx = w * dx + dw * x + y * dz - z * dy, qy = w * dy + dw * y + z * dx - x * dz, qz = w * dz + dw * z + x * dy - y * dx, qw = w * dw - x * dx - y * dy - z * dz;
    // translation: t_rest + R(q_rest)(s_rest ⊙ t_delta)
    const vx = sx * P[to + j * 3]!, vy = sy * P[to + j * 3 + 1]!, vz = sz * P[to + j * 3 + 2]!;
    const cx = y * vz - z * vy + w * vx, cy = z * vx - x * vz + w * vy, cz = x * vy - y * vx + w * vz;
    const px = tx + vx + 2 * (y * cz - z * cy), py = ty + vy + 2 * (z * cx - x * cz), pz = tz + vz + 2 * (x * cy - y * cx);
    const fx = S ? S[to + j * 3]! : 1, fy = S ? S[to + j * 3 + 1]! : 1, fz = S ? S[to + j * 3 + 2]! : 1;
    const o = j * 10;
    if (axes === "gltf") {
      out[o] = px; out[o + 1] = pz; out[o + 2] = -py;
      out[o + 3] = qx; out[o + 4] = qz; out[o + 5] = -qy; out[o + 6] = qw;
      out[o + 7] = Math.abs(sx * fx); out[o + 8] = Math.abs(sz * fz); out[o + 9] = Math.abs(sy * fy);
    } else {
      out[o] = px; out[o + 1] = py; out[o + 2] = pz; out[o + 3] = qx; out[o + 4] = qy; out[o + 5] = qz; out[o + 6] = qw;
      out[o + 7] = sx * fx; out[o + 8] = sy * fy; out[o + 9] = sz * fz;
    }
  }
  return out;
}
