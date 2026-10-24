import type { Layer3Data, Layer3State, SenseFrame } from './types.ts';

export function defaultData(): Layer3Data {
  return {
    pacing: {
      decayA: 0.9771599684342459,
      decayN: 0.9942404238175473,
      thetaPeak: 0.7,
      thetaFade: 0.35,
      peakHold: 5,
      settle: 90,
      restFactor: 1.5,
      restMin: 45,
      restMax: 180,
      highIntensity: 0.5,
      climaxNoPush: 300,
      climaxNoHigh: 1200,
      arcNoNewThread: 1200,
      engagedMetres: 40,
      senseWeights: {
        healthLost: 1,
        lowHealth: 0.15,
        downed: 0.3,
        combatEntered: 0.1,
        hostileDeath: 0.05,
        civilianDeath: 0.1,
        heatRise: 0.1,
        collision: 0.05,
        stim: 0.03,
        special: 0.2,
      },
    },
    threads: {
      attendedWindow: 2700,
      simmerWindow: 28800,
      maxAttended: 4,
      maxLive: 2,
      maxClimactic: 1,
      maxSimmering: 8,
      pendingLifetime: 3600,
    },
    aim: { preferredUrgency: 0.35, preferredWait: 300, lateUrgency: 0.7, relaxAt: 0.7 },
    joint: { arrivedMetres: 100, stationarySeconds: 3 },
    schedule: {
      slotGap: 4500,
      theta: { off: 0, calm: 0.3125, steady: 0.625, restless: 1 },
      gentleFirst: 600,
      gentleHour: 3600,
    },
    sifter: {
      poolPerPattern: 32,
      poolTotal: 256,
      maxStages: 5,
      defaultWithin: 518400,
      maxWithin: 2592000,
      candidateTtl: 259200,
      tombstoneSpans: 2,
    },
    sower: {
      lambda: 1,
      diversity: 0.5,
      recentSown: 6,
      recentKits: 3,
      kitDiversity: 1,
      maxCandidateTries: 3,
      maxKitTries: 3,
      cooldown: 600,
      maxRefusals: 3,
      featureWeights: { F3: 1, F5: 1, F6: 1, F11: 1 },
      timelyH: 21600,
      irreversible: ['kill', 'expose'],
      harmful: ['harm', 'kill', 'take', 'expose', 'protect', 'rescue'],
      maxLevel: 'gig',
    },
    fit: { aesthetic: 0.3, variety: 0.2, yield: 0.3, varietyOffers: 3 },
  };
}
export function dataProblems(d: Layer3Data): string[] {
  const out: string[] = [];
  const finite = (v: unknown, path: string): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) out.push(path + ' must be finite');
    if (v && typeof v === 'object') for (const [key, value] of Object.entries(v)) finite(value, path + '.' + key);
  };
  finite(d, 'data');
  if (!(d.schedule.slotGap > 0 && Number.isInteger(d.schedule.slotGap))) out.push('slotGap must be a positive integer');
  if (
    d.schedule.theta.off !== 0 ||
    d.schedule.theta.restless !== 1 ||
    d.schedule.theta.calm < 0 ||
    d.schedule.theta.calm > d.schedule.theta.steady ||
    d.schedule.theta.steady > 1
  )
    out.push('Schedule thinning must nest');
  if (d.pacing.decayA < 0 || d.pacing.decayA > 1 || d.pacing.decayN < 0 || d.pacing.decayN > 1)
    out.push('Decay must be in [0,1]');
  for (const [key, value] of Object.entries(d.sifter))
    if (!(value > 0 && Number.isInteger(value))) out.push(key + ' must be a positive integer');
  for (const [key, value] of Object.entries(d.threads)) if (!(value > 0)) out.push(key + ' must be positive');
  for (const key of ['recentSown', 'recentKits', 'maxCandidateTries', 'maxKitTries', 'maxRefusals'] as const)
    if (!(d.sower[key] > 0 && Number.isInteger(d.sower[key]))) out.push(key + ' must be a positive integer');
  if (d.sower.recentKits > d.sower.recentSown) out.push('recentKits exceeds retained recentSown history');
  if (Object.values(d.sower.featureWeights).some((w) => w < 0)) out.push('Feature weights must be nonnegative');
  if (!['glance', 'encounter', 'vignette', 'gig'].includes(d.sower.maxLevel))
    out.push('Arc and season sowing is not supported yet');
  return out;
}
export function emptyState(playTotal: number, gap: number): Layer3State {
  return {
    schema: 1,
    slots: { open: { next: Math.floor(playTotal / gap) } },
    nextSeq: 0,
    openLockUntil: 0,
    pool: [],
    tombstones: [],
    pending: [],
    recent: [],
    buffer: [],
    evidence: [],
  };
}
export function quietFrame(at: number, over: Partial<SenseFrame> = {}): SenseFrame {
  return {
    at,
    health: 1,
    downed: false,
    hostileAware: false,
    hostileAwareNear: false,
    hostileDeaths: [],
    civilianDeaths: [],
    heatStage: 0,
    pursuit: false,
    collision: false,
    stims: 0,
    specialEncounter: false,
    district: null,
    moving: false,
    metresMoved: 0,
    ...over,
  };
}
/** The port may hold other telemetry. Only this projection enters pacing or its log. */
export function copySense(f: SenseFrame): SenseFrame {
  return {
    at: f.at,
    health: f.health,
    downed: f.downed,
    hostileAware: f.hostileAware,
    hostileAwareNear: f.hostileAwareNear,
    hostileDeaths: f.hostileDeaths.slice(),
    civilianDeaths: f.civilianDeaths.slice(),
    heatStage: f.heatStage,
    pursuit: f.pursuit,
    collision: f.collision,
    stims: f.stims,
    specialEncounter: f.specialEncounter,
    district: f.district,
    moving: f.moving,
    metresMoved: f.metresMoved,
    ...(f.jump ? { jump: f.jump } : {}),
    ...(f.questCompleted !== undefined ? { questCompleted: f.questCompleted } : {}),
  };
}
