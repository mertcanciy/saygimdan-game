// Drift car dynamics: a bicycle model with saturating (Pacejka-style) tyre
// forces, weight transfer and a rear friction circle, plus arcade assists:
//  - traction control: while not drifting, drive force is capped so drive +
//    cornering force stay inside ~88% of the rear friction circle (no wheel-
//    spin slides on launch or in slow corners)
//  - stability assist: outside drift mode a yaw controller pulls the body slip
//    back to zero (planted grip driving, slides die out quickly)
//  - drift mode: entered deliberately (handbrake at speed, or throttle + a
//    steering flick / full lock above ~55 km/h); a PD controller then holds a
//    moderate slip angle chosen by the steering input.
// Pure functions, so it can be unit-tested outside the renderer.

import * as THREE from "three";

export const WHEELBASE = 2.66;
/** safety cap only; the real top speed (~185 km/h) comes from drag */
export const MAX_VF = 70;

const deg = THREE.MathUtils.degToRad;
const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

export const TYRE = {
  mass: 1350,
  inertia: 2100,
  a: 1.22, // CG -> front axle
  b: 1.44, // CG -> rear axle
  cgH: 0.4,
  // rear >= front so a normal corner understeers slightly instead of spinning
  muFront: 1.0,
  muRear: 1.2,
  stiffB: 7.5,
  shapeC: 1.25,
  power: 300000, // W
  maxDrive: 11500, // N
  brake: 15000,
  rollRes: 180,
  // drag balances full power at ~51 m/s (~185 km/h)
  aero: 2.1,
  maxSteer: 0.62,
  minSteer: 0.05,
  /** full keyboard steer asks for this fraction of the front grip */
  steerLimit: 1.0,
  counterSteer: 0.4,
  handbrakeLat: 0.3,
  /** traction control: share of the rear friction circle usable while gripping */
  tcLimit: 0.88,
  /** power-oversteer: speed window (m/s) where throttle can break the rear loose */
  powerV0: 14.5, // ~52 km/h
  powerV1: 17.5, // ~63 km/h
  /** how much full drive force eats into rear lateral grip once unlocked (0..1) */
  powerOversteer: 0.6,
  /** drift mode needs at least this speed (m/s) */
  driftMinV: 11.2, // ~40 km/h
  maxSlide: deg(45),
  spinDamp: 30,
  /** drift-angle controller: target slide while steering into / neutral / against the drift (rad) */
  driftInto: deg(27),
  driftNeutral: deg(16),
  driftCounter: deg(2),
  /** target scale when off the throttle (lift = straighten up) */
  driftLift: 0.3,
  driftGain: 32,
  driftDamp: 11,
  /** lateral g the path can pull while drifting: steering into / neutral / against */
  driftGripInto: 1.35,
  driftGripNeutral: 0.9,
  driftGripCounter: 0.35,
  /** drive force cap in drift mode (g) */
  driftDrive: 0.45,
  /** on the throttle a drift settles at this speed (m/s, ~62 km/h), shedding at most driftBleed m/s² */
  driftCruise: 17.2,
  driftBleed: 3.2,
  /** stability assist outside drift mode */
  stabGain: 14,
  stabDamp: 6,
  /** a slide above this angle with power or handbrake starts drift mode */
  driftEnter: deg(9),
  driftExit: deg(4),
};

/** Body-frame state. x = forward (vF), y = "rgt" (vR); yawRate turns forward towards rgt. */
export interface DriftBody {
  vF: number;
  vR: number;
  yawRate: number;
  /** smoothed steering input, -1..1 */
  steer: number;
  /** smoothed longitudinal acceleration (for weight transfer) */
  aLong: number;
  /** drift mode latch (0/1): set by handbrake or power slides, cleared when straight */
  drift?: number;
  betaPrev?: number;
  /** seconds left in which a steering flick (direction change) can break traction */
  flick?: number;
  /** last non-zero steering direction (-1 / 1) */
  lastDir?: number;
  /** seconds since the drift was caught / lifted (fast recovery window) */
  recover?: number;
  /** seconds since drift mode latched */
  driftAge?: number;
  /** seconds off the throttle while drifting */
  lift?: number;
}

/** Advance the car by `h` seconds. Mutates `b`. */
export function stepDrift(
  b: DriftBody,
  throttle: boolean,
  brake: boolean,
  handbrake: boolean,
  steerIn: number,
  h: number
): void {
  let vF = b.vF;
  let vR = b.vR;
  const T = TYRE;
  const speedAbs = Math.hypot(vF, vR);
  const dir = vF >= 0 ? 1 : -1;

  // ---- steering: rate-limited, speed-sensitive lock, full lock for counter-steer
  const rate = steerIn !== 0 ? 4.5 : 7;
  b.steer += clamp(steerIn - b.steer, -rate * h, rate * h);
  if (steerIn !== 0) {
    const sgn = Math.sign(steerIn);
    if (b.lastDir !== undefined && sgn !== b.lastDir) b.flick = 0.7; // left-right flick
    b.lastDir = sgn;
  }
  b.flick = Math.max(0, (b.flick ?? 0) - h);

  const beta = Math.atan2(vR, Math.abs(vF) + 1); // body slip (+ = sliding towards rgt)
  const slideAbs = Math.abs(beta);
  const gripLock = Math.atan((WHEELBASE * T.muFront * 9.81 * T.steerLimit) / Math.max(1, speedAbs * speedAbs)) + 0.03;
  const speedLock = clamp(gripLock, T.minSteer, T.maxSteer);
  const counter = b.steer * b.yawRate * dir < 0 && slideAbs > 0.08;
  // counter-steer gets extra lock in proportion to the slide, so catching a
  // slide doesn't over-correct into a tank-slapper
  const lock = counter ? clamp(speedLock + slideAbs * 1.2, speedLock, T.maxSteer) : speedLock;
  // arcade assist: the front wheels partly follow the slide (auto counter-steer)
  const assist = T.counterSteer * clamp(speedAbs / 8, 0, 1);
  const delta = clamp(b.steer * lock + beta * assist * dir, -T.maxSteer, T.maxSteer);

  // ---- longitudinal: engine on the rear axle, brakes on both
  let drive = 0;
  let fxFront = 0;
  if (throttle) {
    drive = Math.min(T.maxDrive, T.power / Math.max(4, Math.abs(vF)));
    if (vF < -0.5) drive = T.maxDrive; // throttle while rolling back = brake
  } else if (brake) {
    if (vF > 0.5) {
      drive = -T.brake * 0.4;
      fxFront = -T.brake * 0.6;
    } else drive = -T.maxDrive * 0.45; // reverse
  }
  const resist = -Math.sign(vF) * (T.rollRes + T.aero * vF * vF);

  // weight transfer (braking loads the nose, throttle squats the rear)
  const shift = clamp((b.aLong * T.mass * T.cgH) / WHEELBASE, -T.mass * 9.81 * 0.15, T.mass * 9.81 * 0.15);
  const fzF = (T.mass * 9.81 * T.b) / WHEELBASE - shift;
  const fzR = (T.mass * 9.81 * T.a) / WHEELBASE + shift;

  // slip angles (low-speed safe)
  const vx = Math.abs(vF) + 1.5;
  const alphaF = Math.atan2(vR + T.a * b.yawRate * dir, vx) - delta * dir;
  const alphaR = Math.atan2(vR - T.b * b.yawRate * dir, vx);

  const muR = T.muRear;
  const maxR = muR * fzR;
  const fyR0 = -maxR * Math.sin(T.shapeC * Math.atan(T.stiffB * alphaR));

  // power-oversteer is only possible at speed with real steering input, or
  // right after a flick; in drift mode the throttle always feeds the slide
  const flickBoost = (b.flick ?? 0) > 0 ? 1 : 0;
  const vUnlock = smooth(speedAbs, T.powerV0 - flickBoost * 2, T.powerV1 - flickBoost * 2);
  const steerUnlock = smooth(Math.abs(b.steer), 0.55, 0.95);
  const fresh = (b.recover ?? 10) > 0.9 ? 1 : 0;
  const unlock = b.drift ? 1 : throttle && vF > 0 ? vUnlock * steerUnlock * fresh : 0;

  let fxRear = drive;
  let rearLatScale = 1;
  if (handbrake && Math.abs(vF) > 1) {
    fxRear = -Math.sign(vF) * maxR * 0.7;
    rearLatScale = T.handbrakeLat;
  } else if (drive > 0 && vF > -0.5) {
    // traction control: keep drive + cornering inside the friction circle
    const cap = T.tcLimit * maxR;
    const avail = Math.sqrt(Math.max(0, cap * cap - fyR0 * fyR0));
    // (at a crawl the kinematic blend steers, so launch with full lock is fine)
    const floor = cap * THREE.MathUtils.lerp(1, 0.15, smooth(speedAbs, 3, 8));
    const tcDrive = Math.min(drive, Math.max(avail, floor));
    fxRear = THREE.MathUtils.lerp(tcDrive, Math.min(drive, maxR), unlock);
    // while drifting the throttle holds the slide rather than feeding speed
    if (b.drift) fxRear = Math.min(fxRear, T.driftDrive * T.mass * 9.81);
  }
  fxRear += resist;
  fxRear = clamp(fxRear, -maxR, maxR);
  if (!handbrake && unlock > 0) {
    // gripping: TC already made room for the cornering force, so no cut;
    // once unlocked the arcade friction-circle term lets power break it loose
    const u = fxRear / maxR;
    rearLatScale = THREE.MathUtils.lerp(1, 1 - T.powerOversteer * u * u, unlock);
  }

  const fyF = -T.muFront * fzF * Math.sin(T.shapeC * Math.atan(T.stiffB * alphaF));
  const fyR = fyR0 * rearLatScale;

  // ---- equations of motion
  const cosD = Math.cos(delta);
  const sinD = Math.sin(delta);
  let ax = (fxRear + fxFront * cosD - fyF * sinD) / T.mass;
  let ay = (fyR + fyF * cosD + fxFront * sinD) / T.mass;
  let rDot = ((T.a * (fyF * cosD + fxFront * sinD) - T.b * fyR) / T.inertia) * dir;

  // ---- drift mode latch
  const fast = vF > T.driftMinV;
  // right after a catch the throttle can't re-latch (no accidental flick to the other side)
  const settled = (b.recover ?? 10) > 0.9;
  // deliberate entries latch at once: a handbrake tap with steering at speed,
  // or a steering flick (left-right) on the throttle above ~45 km/h; a power
  // slide that has already built up (gas + full lock above ~55 km/h) too
  const hbEntry = handbrake && fast && Math.abs(b.steer) > 0.3;
  const flickEntry =
    throttle && fast && (b.flick ?? 0) > 0 && speedAbs > T.powerV0 - 2 && Math.abs(b.steer) > 0.6 && settled;
  const powerEntry = throttle && fast && slideAbs > T.driftEnter && unlock > 0.5 && settled;
  if (!b.drift && (hbEntry || flickEntry || powerEntry)) {
    b.drift = 1;
    b.driftAge = 0;
  }
  b.driftAge = (b.driftAge ?? 0) + h;
  // which way the car is rotating: from the slide once there is one, else
  // from the yaw rate / steering (at the moment of a handbrake entry)
  const side =
    slideAbs > 0.06 ? (beta < 0 ? 1 : -1) : Math.abs(b.yawRate) > 0.15 ? Math.sign(b.yawRate * dir) : b.steer >= 0 ? 1 : -1;
  const into = b.steer * side; // + = steering into the drift
  // counter-steering a moderate slide ends the drift instead of flicking the car the other way
  const caught = into < -0.3 && slideAbs < deg(14);
  // lifting off for a moment ends the drift: the car gathers itself up
  b.lift = b.drift && !throttle && !handbrake ? (b.lift ?? 0) + h : 0;
  if (b.drift && ((slideAbs < T.driftExit && b.driftAge > 0.6) || vF < T.driftMinV * 0.7 || brake || caught || b.lift > 0.3)) {
    b.drift = 0;
    b.recover = 0;
  }

  const betaRate = b.betaPrev === undefined ? 0 : (beta - b.betaPrev) / h;
  const auth = Math.min(1, speedAbs / 10);
  if (b.drift) {
    const target =
      into > 0.1
        ? THREE.MathUtils.lerp(T.driftNeutral, T.driftInto, into)
        : into < -0.1
          ? THREE.MathUtils.lerp(T.driftNeutral, T.driftCounter, -into)
          : T.driftNeutral;
    const powered = throttle || handbrake;
    const targetBeta = -side * (powered ? target : target * T.driftLift);
    const gain = powered ? T.driftGain : T.driftGain * 1.4;
    rDot += ((beta - targetBeta) * gain + betaRate * T.driftDamp) * auth;

    // arcade drift grip: a sliding car's tyres alone only bend the path at
    // ~0.25 g, so the slide would plough straight on. Top the cornering force
    // up (perpendicular to the velocity, towards the turn) so the path follows
    // the rotating body, up to a lateral g set by the steering: into the turn
    // = tight line, neutral = wider, counter-steer = straighten out.
    if (speedAbs > 3 && vF > 0) {
      const g =
        into > 0.1
          ? THREE.MathUtils.lerp(T.driftGripNeutral, T.driftGripInto, into)
          : into < -0.1
            ? THREE.MathUtils.lerp(T.driftGripNeutral, T.driftGripCounter, -into)
            : T.driftGripNeutral;
      const cap = g * 9.81 * (powered ? 1 : 0.8);
      const nx = (-vR / speedAbs) * side;
      const ny = (vF / speedAbs) * side;
      // once the slide is established the full cornering force is available
      const established = cap * clamp(slideAbs / (target * 0.7), 0, 1);
      const want = Math.max(Math.min(speedAbs * Math.abs(b.yawRate), cap), established);
      const extra = Math.max(0, want - (ax * nx + ay * ny));
      ax += nx * extra;
      ay += ny * extra;
      // speed along the path: on the throttle a drift settles towards a
      // cruising speed (fast entries bleed off, slow ones pick up a little),
      // so the line stays predictable; the handbrake keeps its own braking
      if (throttle && !handbrake) {
        const ux = vF / speedAbs;
        const uy = vR / speedAbs;
        const along = ax * ux + ay * uy;
        const wantAlong = clamp((T.driftCruise - speedAbs) * 1.2, -T.driftBleed, 1.2);
        ax += (wantAlong - along) * ux;
        ay += (wantAlong - along) * uy;
      }
    }
  } else {
    // stability assist: grip driving stays planted and leftover slides die
    // out; eased off while the player is deliberately provoking a slide
    b.recover = (b.recover ?? 10) + h;
    const provoking = handbrake ? (fast ? 1 : 0.6) : throttle ? unlock : 0;
    const k = (1 - provoking) * auth;
    const boost = b.recover < 1 ? 1.5 : 1;
    rDot += (beta * T.stabGain * boost + betaRate * T.stabDamp) * k;
  }
  b.betaPrev = beta;

  // arcade assist: well past the target angles, damp the yaw so it doesn't spin out
  const excess = Math.max(0, slideAbs - T.maxSlide * 0.85);
  rDot -= b.yawRate * excess * T.spinDamp;
  // at a crawl, blend to kinematic steering (no jitter when parked)
  const slow = clamp(1 - speedAbs / 3, 0, 1);

  vF += (ax + vR * b.yawRate) * h;
  vR += (ay - vF * b.yawRate) * h;
  b.yawRate += rDot * h;
  if (slow > 0) {
    const kin = (vF / WHEELBASE) * Math.tan(delta);
    b.yawRate += (kin - b.yawRate) * slow;
    vR *= 1 - slow * 0.5;
  }
  if (!throttle && !brake && Math.abs(vF) < 0.3 && speedAbs < 0.5) {
    vF = 0;
    vR = 0;
  }
  vF = clamp(vF, -12, MAX_VF);

  b.vF = vF;
  b.vR = vR;
}
