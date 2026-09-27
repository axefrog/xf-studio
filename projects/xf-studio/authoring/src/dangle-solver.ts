/**
 * The game's Dyng dangle simulation (`animDangleConstraint_SimulationDyng`), reproduced from the arithmetic read in the 2.31 executable
 * (knowledge/hair-physics.md §5): pure, DOM-free, deterministic, allocation-free per frame, `Float64Array` state.
 *
 * One instance per dangle component per scene. Each frame takes the component's input pose (every rig joint in model space, the game's
 * axes: Z up) and two time steps, and writes the output pose: every chain joint moved to its particle and turned toward its linked
 * child (§5.5). Inside: the filtered substep count (§5.1), velocity Verlet with the pull spring and capped drag (§5.2), the link, cone
 * and ellipsoid projections in file order (§5.3), rounded-shape collision (§5.4).
 *
 * The world never moves the preview's V, so the solver runs the game's mode 0 (state in model space; the character's world rotation is
 * the identity) and mode 2 (reset) only; mode 1 (world-space inertia) isn't needed (hair-physics-plan.md §3.4). The game computes in
 * single precision; this runs in doubles, so results agree with the knowledge page's test vectors to about 1e-6 relative.
 */
import { type DangleSimulation, type DangleSpec, type Transform } from "./dangle-spec";

/** The `Dangle` engine settings (knowledge §5.1); no override was found in the installed configuration. */
export const DANGLE_ENGINE = Object.freeze({ maxPhysicsStepsCount: 3, physicsStepsCountLowPassFilterRc: 1, minTimeDilatation: 0.05,
  maxTimeDilatation: 1, solverIterationsWhenSkippingPhysics: 1 });
/** The drag acceleration's cap, m/s² (§5.2). */
const DRAG_CAP = 50;
/** Joints per pose entry: translation (3) and rotation quaternion (4). */
export const POSE_STRIDE = 7;

const LINK = { fixed: 0, variable: 1, greater: 2, closer: 3 } as const;
const CONE = { cone: 0, hinge: 1, half: 2 } as const;

/** Rest pose helpers for callers: a spec's reference pose as a flat pose array. */
export function referencePose(spec: DangleSpec): Float64Array {
  const pose = new Float64Array(spec.joints.length * POSE_STRIDE);
  spec.reference.forEach((t, i) => pose.set(t, i * POSE_STRIDE));
  return pose;
}

/**
 * Pose the rig's chains rigidly: every joint in `keep` holds the pose it has, every other joint is its parent's pose times its reference
 * transform (the game's reference pose under the shared base joints, knowledge §2.3). Parents come before children in a rig.
 */
export function rigidChains(spec: DangleSpec, pose: Float64Array, keep: ArrayLike<boolean>): void {
  for (let i = 0; i < spec.joints.length; i++) {
    if (keep[i]) continue;
    const { parent, local } = spec.joints[i]!;
    if (parent < 0) pose.set(local, i * POSE_STRIDE);
    else composeInto(pose, parent * POSE_STRIDE, local, 0, pose, i * POSE_STRIDE);
  }
}

export type DangleSolverOptions = {
  /**
   * The substep count filter's starting value (`smoothed`, §5.1). The game's starting value is unread; the Studio starts at the steady
   * value of its nominal frame rate so the first seconds run at the same pace as the rest.
   */
  initialSteps?: number;
};

export class DangleSolver {
  readonly joints: number;
  readonly particles: number;
  /** The last frame's output pose (the input with every particle's joint written). */
  readonly out: Float64Array;
  private readonly sim: DangleSimulation;
  // Particle state, 3 per particle.
  private readonly x: Float64Array; private readonly v: Float64Array; private readonly xPrev: Float64Array;
  private readonly mass: Float64Array; private readonly free: Uint8Array; private readonly joint: Int32Array;
  // Input poses of the previous and current frame, and their interpolation for this substep (all joints).
  private readonly prev: Float64Array; private readonly cur: Float64Array; private readonly anim: Float64Array;
  // Rounded shapes' frames (bone ∘ transformLS), previous, current and interpolated.
  private readonly shapePrev: Float64Array; private readonly shapeCur: Float64Array; private readonly shapeNow: Float64Array;
  private readonly rest: Float64Array;
  private readonly coneCos: Float64Array; private readonly coneSin: Float64Array;
  /** Particle indices in ascending joint order (the initialiser's sort), and the links ending on each particle. */
  private readonly outputOrder: Int32Array;
  private readonly linksTo: number[][];
  private readonly gravityPrev = new Float64Array(3); private readonly gravityCur = new Float64Array(3); private readonly gravity = new Float64Array(3);
  private readonly externalPrev = new Float64Array(3); private readonly externalCur = new Float64Array(3); private readonly external = new Float64Array(3);
  private readonly acc = new Float64Array(3);
  // Scratch: a frame, a vector, a rotation, a transform and a blend.
  private readonly F = new Float64Array(7); private readonly va = new Float64Array(3);
  private readonly arc = new Float64Array(4); private readonly T = new Float64Array(7); private readonly blend = new Float64Array(7);
  private accumulator = 0;
  private lastDt = 0;
  private smoothed: number;
  private needsReset = true;
  /** The substeps the last frame ran and their length (0 substeps when its time-dilation ratio stopped the simulation). */
  lastSteps = 0;
  lastH = 0;
  /**
   * How many frames ended with a particle no longer finite and were reset to the input pose (PREV-130). The spec's ranges keep the
   * vanilla and inspected sets far from it; this is the backstop, so a part never vanishes while physics is on.
   */
  unstable = 0;

  constructor(readonly spec: DangleSpec, options: DangleSolverOptions = {}) {
    const sim = spec.simulation;
    if (!sim) throw Error("This dangle has no simulation to run.");
    this.sim = sim;
    this.joints = spec.joints.length;
    const n = this.particles = sim.particles.length;
    this.x = new Float64Array(3 * n); this.v = new Float64Array(3 * n); this.xPrev = new Float64Array(3 * n);
    this.mass = Float64Array.from(sim.particles, p => p.mass);
    this.free = Uint8Array.from(sim.particles, p => p.free ? 1 : 0);
    this.joint = Int32Array.from(sim.particles, p => p.joint);
    const size = this.joints * POSE_STRIDE;
    this.prev = new Float64Array(size); this.cur = new Float64Array(size); this.anim = new Float64Array(size); this.out = new Float64Array(size);
    const shapes = sim.shapes.length * POSE_STRIDE;
    this.shapePrev = new Float64Array(shapes); this.shapeCur = new Float64Array(shapes); this.shapeNow = new Float64Array(shapes);
    // Rest lengths: the reference pose's joint-to-joint distances, measured once (§5.3).
    this.rest = Float64Array.from(sim.constraints, c => {
      if (c.kind !== "link") return 0;
      const a = spec.reference[sim.particles[c.a]!.joint]!, b = spec.reference[sim.particles[c.b]!.joint]!;
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    });
    // The cone's only trigonometry, at setup (§5.3; the executable's setup computes the cosine and the half-angle rotation).
    this.coneCos = Float64Array.from(sim.constraints, c => c.kind === "cone" ? Math.cos(c.halfAngle * Math.PI / 180) : 0);
    this.coneSin = Float64Array.from(sim.constraints, c => c.kind === "cone" ? Math.sin(c.halfAngle * Math.PI / 180) : 0);
    this.outputOrder = Int32Array.from([...sim.particles.keys()].sort((a, b) => sim.particles[a]!.joint - sim.particles[b]!.joint));
    this.linksTo = sim.particles.map(() => []);
    sim.constraints.forEach((c, i) => { if (c.kind === "link") this.linksTo[c.b]!.push(i); });
    this.smoothed = options.initialSteps ?? 0;
  }

  /** The game's reset mode (mode 2): the next frame puts every particle on its input pose with zero velocity. */
  requestReset() { this.needsReset = true; }

  /**
   * One frame (§5.1 Update and Evaluate): `realDt` drives the substep count, `gameDt / realDt` the substep length. `pose` holds every rig
   * joint's input transform in model space (stride 7); the output is written to `out`.
   */
  frame(pose: Float64Array, realDt: number, gameDt = realDt): void {
    const sim = this.sim, E = DANGLE_ENGINE;
    this.lastDt = realDt;
    this.accumulator += realDt;
    const dilation = realDt > 1e-6 ? gameDt / realDt : 0;
    let resetFrame = false;
    if (this.needsReset) { this.reset(pose, true); resetFrame = true; this.needsReset = false; }
    const n = Math.trunc(this.accumulator / sim.substepTime);
    this.accumulator -= n * sim.substepTime;
    this.smoothed += (this.lastDt / (this.lastDt + E.physicsStepsCountLowPassFilterRc)) * (n - this.smoothed);
    const steps = Math.min(Math.max(Math.floor(this.smoothed + 0.5), 1), E.maxPhysicsStepsCount);
    const h = Math.min(dilation, E.maxTimeDilatation) * sim.substepTime;
    this.lastSteps = dilation > E.minTimeDilatation ? steps : 0;
    this.lastH = h;
    if (dilation > E.minTimeDilatation) {
      this.beginFrame(pose);
      const iterations = resetFrame ? Math.max(sim.iterations, E.solverIterationsWhenSkippingPhysics) : sim.iterations;
      for (let i = 0; i < steps; i++) {
        const f = (i + 1) / steps;
        this.kinematic(f);
        if (!resetFrame) this.integrate(h);
        for (let k = 0; k < iterations; k++) {
          this.project();
          if (sim.shapes.length) this.collideShapes();
        }
        if (!resetFrame) this.updateVelocities(h);
      }
    }
    if (resetFrame) this.reset(pose, false);
    if (!this.finite()) { this.unstable++; this.reset(pose, true); this.accumulator = 0; }
    this.output(pose);
  }
  private finite(): boolean {
    const x = this.x, v = this.v;
    // A sum is finite only when every term is (NaN and ±Infinity propagate), one branch per frame.
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i]! * 0 + v[i]! * 0;
    return sum === 0;
  }

  /** Every particle's position (model space, 3 per particle); read only. */
  get positions(): Readonly<Float64Array> { return this.x; }
  /**
   * The fastest free particle's stored velocity, m/s. At rest against a constraint it keeps the last half kick (`0.5·h·accel`, about 5 cm/s
   * under gravity), so the settle rule measures displacement instead (`settleDangle`).
   */
  maxSpeed(): number {
    let best = 0;
    for (let i = 0; i < this.particles; i++) {
      if (!this.free[i]) continue;
      const s = Math.hypot(this.v[3 * i]!, this.v[3 * i + 1]!, this.v[3 * i + 2]!);
      if (s > best) best = s;
    }
    return best;
  }
  /** A particle's position and velocity (model space). */
  particle(i: number): { x: [number, number, number]; v: [number, number, number] } {
    return { x: [this.x[3 * i]!, this.x[3 * i + 1]!, this.x[3 * i + 2]!], v: [this.v[3 * i]!, this.v[3 * i + 1]!, this.v[3 * i + 2]!] };
  }
  /** Place a particle (tests and captures). */
  setParticle(i: number, x: readonly number[], v: readonly number[] = [0, 0, 0]) {
    for (let k = 0; k < 3; k++) { this.x[3 * i + k] = x[k]!; this.v[3 * i + k] = v[k]!; }
  }

  // ---- §5.1: reset and begin frame ----
  /** `reset(true)`: particles on their bone's input position, zero velocity; `reset(false)`: zero velocity, positions kept. Both set prev = cur = pose. */
  private reset(pose: Float64Array, place: boolean) {
    this.prev.set(pose); this.cur.set(pose);
    for (let i = 0; i < this.particles; i++) {
      const j = this.joint[i]! * POSE_STRIDE;
      for (let k = 0; k < 3; k++) {
        if (place) this.x[3 * i + k] = pose[j + k]!;
        this.v[3 * i + k] = 0;
      }
    }
    this.shapeFrames(pose, this.shapeCur);
    this.shapePrev.set(this.shapeCur);
    this.forces(this.gravityCur, this.externalCur);
    this.gravityPrev.set(this.gravityCur); this.externalPrev.set(this.externalCur);
  }
  private beginFrame(pose: Float64Array) {
    this.prev.set(this.cur); this.cur.set(pose);
    this.shapePrev.set(this.shapeCur); this.shapeFrames(pose, this.shapeCur);
    this.gravityPrev.set(this.gravityCur); this.externalPrev.set(this.externalCur);
    this.forces(this.gravityCur, this.externalCur);
  }
  /** Gravity (0, 0, −gravityWS) and the external force, world to model space by the character's world rotation (the identity here). */
  private forces(gravity: Float64Array, external: Float64Array) {
    const sim = this.sim;
    gravity[0] = 0; gravity[1] = 0; gravity[2] = -sim.gravity;
    // A linked input replaces `externalForceWS`; the preview feeds that input's default (zero): no script writes it (knowledge §2.3).
    if (sim.externalLinked) external.fill(0); else external.set(sim.externalForce);
  }
  private shapeFrames(pose: Float64Array, into: Float64Array) {
    const shapes = this.sim.shapes;
    for (let s = 0; s < shapes.length; s++) composeInto(pose, shapes[s]!.joint * POSE_STRIDE, shapes[s]!.frame, 0, into, s * POSE_STRIDE);
  }

  /** Kinematic update (§5.1): the animated transforms, forces and shapes at fraction `f` between the previous and current frame. */
  private kinematic(f: number) {
    for (let j = 0; j < this.joints; j++) interpolate(this.prev, this.cur, j * POSE_STRIDE, f, this.anim);
    for (let k = 0; k < 3; k++) {
      this.gravity[k] = this.gravityPrev[k]! + (this.gravityCur[k]! - this.gravityPrev[k]!) * f;
      this.external[k] = this.externalPrev[k]! + (this.externalCur[k]! - this.externalPrev[k]!) * f;
    }
    for (let s = 0; s < this.sim.shapes.length; s++) interpolate(this.shapePrev, this.shapeCur, s * POSE_STRIDE, f, this.shapeNow);
  }

  // ---- §5.2: forces and integration ----
  private accel(i: number) {
    const p = this.sim.particles[i]!, m = this.mass[i]!, j = this.joint[i]! * POSE_STRIDE, a = this.acc;
    const pull = p.pull / m, drag = -(p.damping / m);
    let dx = drag * this.v[3 * i]!, dy = drag * this.v[3 * i + 1]!, dz = drag * this.v[3 * i + 2]!;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > DRAG_CAP) { const s = DRAG_CAP / len; dx *= s; dy *= s; dz *= s; }
    a[0] = pull * (this.anim[j]! - this.x[3 * i]!) + this.external[0]! / m + dx + this.gravity[0]!;
    a[1] = pull * (this.anim[j + 1]! - this.x[3 * i + 1]!) + this.external[1]! / m + dy + this.gravity[1]!;
    a[2] = pull * (this.anim[j + 2]! - this.x[3 * i + 2]!) + this.external[2]! / m + dz + this.gravity[2]!;
  }
  private integrate(h: number) {
    for (let i = 0; i < this.particles; i++) {
      const b = 3 * i;
      this.xPrev[b] = this.x[b]!; this.xPrev[b + 1] = this.x[b + 1]!; this.xPrev[b + 2] = this.x[b + 2]!;
      if (!this.free[i]) {
        const j = this.joint[i]! * POSE_STRIDE;
        this.x[b] = this.anim[j]!; this.x[b + 1] = this.anim[j + 1]!; this.x[b + 2] = this.anim[j + 2]!;
        continue;
      }
      this.accel(i);
      for (let k = 0; k < 3; k++) { this.v[b + k] = this.v[b + k]! + 0.5 * h * this.acc[k]!; this.x[b + k] = this.x[b + k]! + h * this.v[b + k]!; }
    }
  }
  private updateVelocities(h: number) {
    if (h === 0) return;
    for (let i = 0; i < this.particles; i++) {
      if (!this.free[i]) continue;
      this.accel(i);
      const b = 3 * i;
      for (let k = 0; k < 3; k++) this.v[b + k] = (this.x[b + k]! - this.xPrev[b + k]!) / h + 0.5 * h * this.acc[k]!;
    }
  }

  // ---- §5.3: constraints in file order ----
  private project() {
    const constraints = this.sim.constraints;
    for (let c = 0; c < constraints.length; c++) {
      const constraint = constraints[c]!;
      if (constraint.kind === "link") this.link(c, constraint.a, constraint.b, LINK[constraint.type], constraint.lower, constraint.upper);
      else if (constraint.kind === "cone") this.cone(c, constraint.constrained, constraint.attachment, constraint.frame, CONE[constraint.type]);
      else this.ellipsoid(constraint.particle, constraint.frame, constraint.radius, constraint.scale1, constraint.scale2);
    }
  }
  private link(c: number, a: number, b: number, type: number, lower: number, upper: number) {
    const x = this.x, A = 3 * a, B = 3 * b;
    const dx = x[B]! - x[A]!, dy = x[B + 1]! - x[A + 1]!, dz = x[B + 2]! - x[A + 2]!;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz), rest = this.rest[c]!;
    const lo = lower * 0.01 * rest, hi = upper * 0.01 * rest;
    const target = type === LINK.fixed ? lo : type === LINK.variable ? Math.min(Math.max(L, lo), hi) : type === LINK.greater ? Math.max(L, lo) : Math.min(L, hi);
    if (target === L) return;
    let nx = 1, ny = 0, nz = 0;
    if (L !== 0) { nx = dx / L; ny = dy / L; nz = dz / L; }
    const e = L - target, freeA = this.free[a], freeB = this.free[b];
    if (freeA && freeB) {
      const ma = this.mass[a]!, mb = this.mass[b]!, sa = (mb / (ma + mb)) * e, sb = (ma / (ma + mb)) * e;
      x[A] = x[A]! + sa * nx; x[A + 1] = x[A + 1]! + sa * ny; x[A + 2] = x[A + 2]! + sa * nz;
      x[B] = x[B]! - sb * nx; x[B + 1] = x[B + 1]! - sb * ny; x[B + 2] = x[B + 2]! - sb * nz;
    } else if (freeB) {
      x[B] = x[B]! - e * nx; x[B + 1] = x[B + 1]! - e * ny; x[B + 2] = x[B + 2]! - e * nz;
    } else if (freeA) {
      x[A] = x[A]! + e * nx; x[A + 1] = x[A + 1]! + e * ny; x[A + 2] = x[A + 2]! + e * nz;
    }
  }
  private cone(c: number, pc: number, pa: number, frame: Transform, type: number) {
    if (!this.free[pc]) return;
    const x = this.x, C = 3 * pc, Aa = 3 * pa, F = this.F;
    // The attachment's ANIMATED frame composed with coneTransformLS (not its simulated position).
    composeInto(this.anim, this.joint[pa]! * POSE_STRIDE, frame, 0, F, 0);
    const qx = F[3]!, qy = F[4]!, qz = F[5]!, qw = F[6]!;
    // axis = F.q · X, plane = F.q · Z (columns of the rotation matrix).
    const axx = 1 - 2 * (qy * qy + qz * qz), axy = 2 * (qx * qy + qz * qw), axz = 2 * (qx * qz - qy * qw);
    const plx = 2 * (qx * qz + qy * qw), ply = 2 * (qy * qz - qx * qw), plz = 1 - 2 * (qx * qx + qy * qy);
    const fx = F[0]!, fy = F[1]!, fz = F[2]!;
    let wx = x[C]! - fx, wy = x[C + 1]! - fy, wz = x[C + 2]! - fz;
    if (type === CONE.hinge) { const d = wx * plx + wy * ply + wz * plz; wx -= d * plx; wy -= d * ply; wz -= d * plz; }
    else if (type === CONE.half) { const d = Math.max(wx * plx + wy * ply + wz * plz, 0); wx -= d * plx; wy -= d * ply; wz -= d * plz; }
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
    let ux = 0, uy = 0, uz = 0;
    if (wl > 0) { ux = wx / wl; uy = wy / wl; uz = wz / wl; }
    if (ux * axx + uy * axy + uz * axz < this.coneCos[c]!) {
      // Onto the rim: the axis turned by the half angle about normalize(axis × u), in the plane of the axis and u.
      let kx = axy * uz - axz * uy, ky = axz * ux - axx * uz, kz = axx * uy - axy * ux;
      const kl = Math.sqrt(kx * kx + ky * ky + kz * kz);
      if (kl > 0) {
        kx /= kl; ky /= kl; kz /= kl;
        const cs = this.coneCos[c]!, sn = this.coneSin[c]!;
        // k ⟂ axis: axis·cos + (k × axis)·sin.
        ux = axx * cs + (ky * axz - kz * axy) * sn; uy = axy * cs + (kz * axx - kx * axz) * sn; uz = axz * cs + (kx * axy - ky * axx) * sn;
      } else { ux = axx; uy = axy; uz = axz; } // u zero or opposite the axis: the rim direction is undefined; the axis is used [unread edge].
    }
    // Keep pc's distance r from the SIMULATED attachment: roots t of |apex + t·u − pa.x| = r.
    const rx = x[C]! - x[Aa]!, ry = x[C + 1]! - x[Aa + 1]!, rz = x[C + 2]! - x[Aa + 2]!;
    const r2 = rx * rx + ry * ry + rz * rz;
    const ox = fx - x[Aa]!, oy = fy - x[Aa + 1]!, oz = fz - x[Aa + 2]!;
    const b = ux * ox + uy * oy + uz * oz, disc = b * b - (ox * ox + oy * oy + oz * oz - r2);
    let s: number;
    if (disc > 0 && -b + Math.sqrt(disc) >= 0) {
      const root = Math.sqrt(disc), t1 = -b - root, t2 = -b + root;
      const d1 = distanceSq(fx + t1 * ux - x[C]!, fy + t1 * uy - x[C + 1]!, fz + t1 * uz - x[C + 2]!);
      const d2 = distanceSq(fx + t2 * ux - x[C]!, fy + t2 * uy - x[C + 1]!, fz + t2 * uz - x[C + 2]!);
      s = d1 < d2 ? t1 : t2;
    } else if (disc === 0 && -b >= 0) s = -b;
    else s = Math.max((x[C]! - fx) * ux + (x[C + 1]! - fy) * uy + (x[C + 2]! - fz) * uz, 0);
    x[C] = fx + s * ux; x[C + 1] = fy + s * uy; x[C + 2] = fz + s * uz;
  }
  private ellipsoid(p: number, frame: Transform, R: number, scale1: number, scale2: number) {
    if (!this.free[p]) return;
    const x = this.x, P = 3 * p, E = this.F, va = this.va;
    composeInto(this.anim, this.joint[p]! * POSE_STRIDE, frame, 0, E, 0);
    let dx = x[P]! - E[0]!, dy = x[P + 1]! - E[1]!, dz = x[P + 2]! - E[2]!;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L <= 1e-4) return;
    const nx = dx / L, ny = dy / L, nz = dz / L;
    rotate(E, 0, nx, ny, nz, va, true);
    const lx = va[0]!, ly = va[1]!, lz = va[2]!;
    const Rz = R * (lz < 0 ? scale1 : scale2);
    const rDir = 1 / Math.sqrt((lx / R) ** 2 + (ly / R) ** 2 + (lz / Rz) ** 2);
    if (L > rDir) {
      rotate(E, 0, lx / (R * R), ly / (R * R), lz / (Rz * Rz), va);
      const gx0 = va[0]!, gy0 = va[1]!, gz0 = va[2]!;
      const gl = Math.sqrt(gx0 * gx0 + gy0 * gy0 + gz0 * gz0) || 1, gx = gx0 / gl, gy = gy0 / gl, gz = gz0 / gl;
      const k = (gx * dx + gy * dy + gz * dz) - rDir * (gx * nx + gy * ny + gz * nz);
      dx -= k * gx; dy -= k * gy; dz -= k * gz;
    }
    const m = Math.max(Rz, R), dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl > m) { const s = m / dl; dx *= s; dy *= s; dz *= s; }
    x[P] = E[0]! + dx; x[P + 1] = E[1]! + dy; x[P + 2] = E[2]! + dz;
  }

  // ---- §5.4: rounded-shape collision ----
  private collideShapes() {
    const shapes = this.sim.shapes, particles = this.sim.particles, x = this.x, S = this.shapeNow, va = this.va;
    for (let i = 0; i < this.particles; i++) {
      const p = particles[i]!;
      if (p.projection === "disabled") continue;
      const b = 3 * i;
      for (let s = 0; s < shapes.length; s++) {
        const shape = shapes[s]!, o = s * POSE_STRIDE;
        rotate(S, o, x[b]! - S[o]!, x[b + 1]! - S[o + 1]!, x[b + 2]! - S[o + 2]!, va, true);
        const qx = va[0]!, qy = va[1]!, qz = va[2]!;
        const r = shape.radius + p.radius, ez = shape.extents[2];
        const ox = Math.abs(qx), oy = Math.abs(qy), oz = Math.max(Math.abs(qz) - ez, 0);
        if (Math.sqrt(ox * ox + oy * oy + oz * oz) - r >= 0) continue;
        // Nearest point on a Z capsule of half-length ez and radius r (a sphere when ez is 0).
        let nx: number, ny: number, nz: number;
        if (qz > ez || qz < -ez) {
          const cz = qz > ez ? ez : -ez, dz0 = qz - cz, l = Math.sqrt(qx * qx + qy * qy + dz0 * dz0);
          if (l === 0) continue;
          nx = r * qx / l; ny = r * qy / l; nz = cz + r * dz0 / l;
        } else {
          const l = Math.sqrt(qx * qx + qy * qy);
          if (l === 0) continue;
          nx = r * qx / l; ny = r * qy / l; nz = qz;
        }
        rotate(S, o, nx - qx, ny - qy, nz - qz, va);
        x[b] = x[b]! + va[0]!; x[b + 1] = x[b + 1]! + va[1]!; x[b + 2] = x[b + 2]! + va[2]!;
      }
    }
  }

  // ---- §5.5: output ----
  private output(pose: Float64Array) {
    const out = this.out, sim = this.sim, alpha = sim.alpha, T = this.T, arc = this.arc, va = this.va;
    out.set(pose);
    for (let o = 0; o < this.outputOrder.length; o++) {
      const i = this.outputOrder[o]!, j = this.joint[i]! * POSE_STRIDE, b = 3 * i;
      if (sim.lookAt) for (const c of this.linksTo[i]!) {
        const link = sim.constraints[c]! as Extract<DangleSimulation["constraints"][number], { kind: "link" }>;
        const pj = this.joint[link.a]! * POSE_STRIDE;
        if (distanceSq(out[j]! - out[pj]!, out[j + 1]! - out[pj + 1]!, out[j + 2]! - out[pj + 2]!) <= 1e-5) continue;
        // The parent turned so its lookAtAxis aims at this particle's simulated position.
        rotate(out, pj, link.lookAt[0], link.lookAt[1], link.lookAt[2], va);
        const tx = this.x[b]! - out[pj]!, ty = this.x[b + 1]! - out[pj + 1]!, tz = this.x[b + 2]! - out[pj + 2]!;
        if (Math.sqrt(tx * tx + ty * ty + tz * tz) <= 1.19e-7) continue;
        if (!shortestArc(va[0]!, va[1]!, va[2]!, tx, ty, tz, arc)) continue;
        const ax = arc[0]!, ay = arc[1]!, az = arc[2]!, aw = arc[3]!;
        const px = out[pj + 3]!, py = out[pj + 4]!, pz = out[pj + 5]!, pw = out[pj + 6]!;
        T[0] = out[pj]!; T[1] = out[pj + 1]!; T[2] = out[pj + 2]!;
        T[3] = aw * px + ax * pw + ay * pz - az * py; T[4] = aw * py - ax * pz + ay * pw + az * px;
        T[5] = aw * pz + ax * py - ay * px + az * pw; T[6] = aw * pw - ax * px - ay * py - az * pz;
        write(out, pj, T, alpha, this.blend);
      }
      // Moved to its simulated position, keeping its rotation.
      T[0] = this.x[b]!; T[1] = this.x[b + 1]!; T[2] = this.x[b + 2]!;
      T[3] = out[j + 3]!; T[4] = out[j + 4]!; T[5] = out[j + 5]!; T[6] = out[j + 6]!;
      write(out, j, T, alpha, this.blend);
    }
  }
}

const distanceSq = (x: number, y: number, z: number) => x * x + y * y + z * z;

/** Transform interpolation (§5): lerp translation, normalised lerp of rotation with the second's sign flipped when the dot is negative. */
function interpolate(a: Float64Array, b: Float64Array, o: number, f: number, into: Float64Array) {
  into[o] = a[o]! + (b[o]! - a[o]!) * f; into[o + 1] = a[o + 1]! + (b[o + 1]! - a[o + 1]!) * f; into[o + 2] = a[o + 2]! + (b[o + 2]! - a[o + 2]!) * f;
  const dot = a[o + 3]! * b[o + 3]! + a[o + 4]! * b[o + 4]! + a[o + 5]! * b[o + 5]! + a[o + 6]! * b[o + 6]!;
  const sign = dot < 0 ? -1 : 1;
  let x = a[o + 3]! + (sign * b[o + 3]! - a[o + 3]!) * f, y = a[o + 4]! + (sign * b[o + 4]! - a[o + 4]!) * f;
  let z = a[o + 5]! + (sign * b[o + 5]! - a[o + 5]!) * f, w = a[o + 6]! + (sign * b[o + 6]! - a[o + 6]!) * f;
  const n = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  into[o + 3] = x; into[o + 4] = y; into[o + 5] = z; into[o + 6] = w;
}
/** `write(bone, T)` with the simulation's `alpha` (§5.5); `scratch` holds 7 entries. */
function write(pose: Float64Array, o: number, T: Float64Array, alpha: number, scratch: Float64Array) {
  if (alpha === 0) return;
  if (alpha === 1) { for (let k = 0; k < 7; k++) pose[o + k] = T[k]!; return; }
  for (let k = 0; k < 7; k++) scratch[k] = pose[o + k]!;
  interpolate(scratch, T, 0, alpha, scratch);
  for (let k = 0; k < 7; k++) pose[o + k] = scratch[k]!;
}
/** `a ∘ b` into `into` (all offsets into flat stride-7 arrays). */
function composeInto(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, into: Float64Array, io: number) {
  const ax = a[ao + 3]!, ay = a[ao + 4]!, az = a[ao + 5]!, aw = a[ao + 6]!;
  const bx = b[bo]!, by = b[bo + 1]!, bz = b[bo + 2]!;
  const tx = aw * bx + ay * bz - az * by, ty = aw * by + az * bx - ax * bz, tz = aw * bz + ax * by - ay * bx, tw = -ax * bx - ay * by - az * bz;
  const qx = b[bo + 3]!, qy = b[bo + 4]!, qz = b[bo + 5]!, qw = b[bo + 6]!;
  into[io] = a[ao]! + tx * aw - tw * ax - ty * az + tz * ay;
  into[io + 1] = a[ao + 1]! + ty * aw - tw * ay - tz * ax + tx * az;
  into[io + 2] = a[ao + 2]! + tz * aw - tw * az - tx * ay + ty * ax;
  into[io + 3] = aw * qx + ax * qw + ay * qz - az * qy; into[io + 4] = aw * qy - ax * qz + ay * qw + az * qx;
  into[io + 5] = aw * qz + ax * qy - ay * qx + az * qw; into[io + 6] = aw * qw - ax * qx - ay * qy - az * qz;
}
/** Rotate a vector by the rotation of the transform at `o` (inverse: by its conjugate); the result goes to `out[0..2]`. */
function rotate(t: ArrayLike<number>, o: number, vx: number, vy: number, vz: number, out: Float64Array, inverse = false) {
  const s = inverse ? -1 : 1, qx = s * t[o + 3]!, qy = s * t[o + 4]!, qz = s * t[o + 5]!, qw = t[o + 6]!;
  const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz, iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz;
  out[0] = ix * qw - iw * qx - iy * qz + iz * qy; out[1] = iy * qw - iw * qy - iz * qx + ix * qz; out[2] = iz * qw - iw * qz - ix * qy + iy * qx;
}
/** The shortest rotation taking direction `a` onto direction `b` (null when either is zero). */
function shortestArc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: Float64Array): boolean {
  const la = Math.sqrt(ax * ax + ay * ay + az * az), lb = Math.sqrt(bx * bx + by * by + bz * bz);
  if (!la || !lb) return false;
  ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
  const d = ax * bx + ay * by + az * bz;
  if (d < -1 + 1e-12) {
    // Opposite: a half turn about any axis perpendicular to a.
    let px = 0, py = -az, pz = ay;
    if (px * px + py * py + pz * pz < 1e-12) { px = az; py = 0; pz = -ax; }
    const l = Math.sqrt(px * px + py * py + pz * pz);
    out[0] = px / l; out[1] = py / l; out[2] = pz / l; out[3] = 0;
    return true;
  }
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, w = 1 + d;
  const l = Math.sqrt(cx * cx + cy * cy + cz * cz + w * w);
  out[0] = cx / l; out[1] = cy / l; out[2] = cz / l; out[3] = w / l;
  return true;
}

/** The Studio's settle rule (hair-physics-plan.md §3.4): every free particle slower than this, m/s … */
export const SETTLE = Object.freeze({ speed: 0.001, /** … for this long, simulated seconds … */ hold: 0.2, /** … or at most this many substeps. */ maxSubsteps: 300 });

/**
 * Settle a dangle on a held pose (a Studio addition; the game has none): reset to the pose's rigid chains (the game's reset), then run
 * frames of `frameDt` on the same pose until every free particle has stayed under `SETTLE.speed` for `SETTLE.hold` simulated seconds, or
 * `SETTLE.maxSubsteps` have run. Returns the substeps run (the reset frame's included).
 */
export function settleDangle(solver: DangleSolver, pose: Float64Array, frameDt: number): number {
  solver.requestReset();
  solver.frame(pose, frameDt);
  const before = new Float64Array(solver.positions);
  let substeps = solver.lastSteps, still = 0;
  while (substeps < SETTLE.maxSubsteps) {
    solver.frame(pose, frameDt);
    if (!solver.lastSteps) break;
    const seconds = solver.lastSteps * solver.lastH, x = solver.positions;
    // A particle's speed over the frame: how far it moved (a particle resting on a constraint keeps a stored half kick; §5.2).
    let fastest = 0;
    for (let i = 0; i < x.length; i += 3) {
      const d = Math.hypot(x[i]! - before[i]!, x[i + 1]! - before[i + 1]!, x[i + 2]! - before[i + 2]!);
      if (d > fastest) fastest = d;
    }
    before.set(x);
    substeps += solver.lastSteps;
    still = seconds > 0 && fastest / seconds < SETTLE.speed ? still + seconds : 0;
    if (still >= SETTLE.hold - 1e-9) break;
  }
  return substeps;
}
