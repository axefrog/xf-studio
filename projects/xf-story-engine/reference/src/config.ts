// The tunable and calibrated values (spec 1.3, 4.3, 10.5, 10.6, 10.7, 12, 13, 14.2, 16.2).
// A test may override any of them, to exercise a limit without building a huge world.

export interface Config {
  /** N_enum: the largest domain one draw may enumerate [tunable 4096]. */
  nEnum: number;
  /** epsilon [tunable 2^-20]. */
  epsilon: number;
  /** W_sim, in game seconds [tunable 600]. */
  wSim: number;
  /** Hard limits of one resolution (spec 10.7). */
  maxApplicableContributions: number;
  maxFieldPoints: number;
  maxDepth: number;
  /** Hard limits of one query (spec 10.7). */
  maxFrontierSteps: number;
  maxExactChecks: number;
  /** The shared work allowance per outer operation (spec 10.7). */
  allowance: number;
  /** The per-tick work budget [tunable; P7 measures it]. */
  tickBudget: number;
  /** w_actor for demand roots [tunable 4.0] (spec 10.6). */
  wActorRoot: number;
  /** theta_member [tunable 0.2] (spec 12). */
  thetaMember: number;
  /** theta_react [calibrate 0.08] (spec 10.5, 16.2). */
  thetaReact: number;
  /** m(t) per interest type [calibrate] (spec 10.5). */
  matchWeight: { wants: number; threatenedBy: number; protects: number; blockedBy: number; reactsTo: number };
  /** s(sigma, x) [calibrate] (spec 10.5). */
  specificity: { id: number; kind: number; bucket: number };
  /** k, the number of contributions explain presents [tunable 8] (spec 13). */
  explainTopK: number;
  /** Ops between snapshots [tunable 10000] (spec 14.2). */
  snapshotEvery: number;
  /** The most places an event summary draws from [tunable]. */
  summaryPlaceMax: number;
  /**
   * Whether a frame status change is a semantic change (spec 10.5, v4, V4-4). On by default. The frozen
   * v3 determinism digest runs with it off, because its script's group decisions change frame status and
   * a `wants` interest on a focus node then matches (SPEC-NOTES 58).
   */
  frameChanges: boolean;
  /**
   * Whether the items of a summary whose scope has no place strictly under it take the scope as their place (S0 v4, V4-39).
   * On by default.
   */
  itemScopePlace: boolean;
  /**
   * v4.17 (V4-53): whether opening a frame is a semantic change (`frame`, `old: 'none'` or the earlier status), kept apart from
   * `frameChanges` so that turning it off takes nothing from the v4 digest. Off in both digest configurations. On by default.
   */
  openingChanges: boolean;
  /** v4.17 (V4-52): whether setting, revising or dropping a memorable belief is a semantic change (`belief`). Off in both digests. */
  beliefChanges: boolean;
  /** v4.17 (V4-51): whether the `event` change carries `outcome`, `served` and `data`. Off in both digest configurations. */
  eventChangeFields: boolean;
}

export const DEFAULT_CONFIG: Config = {
  nEnum: 4096,
  epsilon: 2 ** -20,
  wSim: 600,
  maxApplicableContributions: 256,
  maxFieldPoints: 64,
  maxDepth: 32,
  maxFrontierSteps: 50_000,
  maxExactChecks: 5_000,
  allowance: 200_000,
  tickBudget: 100_000,
  wActorRoot: 4.0,
  thetaMember: 0.2,
  thetaReact: 0.08,
  matchWeight: { wants: 1.0, threatenedBy: 1.0, protects: 1.0, blockedBy: 0.8, reactsTo: 0.6 },
  specificity: { id: 1.0, kind: 0.5, bucket: 0.3 },
  explainTopK: 8,
  snapshotEvery: 10_000,
  summaryPlaceMax: 1024,
  frameChanges: true,
  itemScopePlace: true,
  openingChanges: true,
  beliefChanges: true,
  eventChangeFields: true,
};

export function makeConfig(over?: Partial<Config>): Config {
  return { ...DEFAULT_CONFIG, ...over };
}
