// Drift car dynamics: a bicycle model with saturating (Pacejka-style) tyre
// forces, weight transfer and a rear friction circle, plus two small arcade
// assists. Pure functions, so it can be unit-tested outside the renderer.

import * as THREE from "three";

export const WHEELBASE = 2.66;
export const MAX_VF = 48; // m/s (~170 km/h)

/*
 * Tyre / chassis constants for the drift model. The rear is a touch less
 * grippy than the front and throttle eats into rear lateral grip (friction
 * circle), so power-oversteer and handbrake entries both work; two small
 * arcade assists (auto counter-steer, anti-spin damping) keep it controllable.
 */
export const TYRE = {
  mass: 1350,
  inertia: 2100,
  a: 1.22, // CG -> front axle
  b: 1.44, // CG -> rear axle
  cgH: 0.4,
  // rear >= front so a normal corner understeers slightly instead of spinning;
  // slides come from the handbrake or from power (friction circle)
  muFront: 1.0,
  muRear: 1.2,
  stiffB: 7.5,
  shapeC: 1.25,
  power: 260000, // W
  maxDrive: 11500, // N
  brake: 15000,
  rollRes: 180,
  aero: 0.42,
  maxSteer: 0.62,
  minSteer: 0.05,
  /** full keyboard steer asks for this fraction of the front grip */
  steerLimit: 1.05,
  counterSteer: 0.4,
  handbrakeLat: 0.32,
  /** how much full drive force eats into rear lateral grip (0..1) */
  powerOversteer: 0.55,
  maxSlide: THREE.MathUtils.degToRad(52),
  spinDamp: 28,
  /** drift-angle controller: target slide while steering into / neutral / against the drift (rad) */
  driftInto: THREE.MathUtils.degToRad(38),
  driftNeutral: THREE.MathUtils.degToRad(22),
  driftCounter: THREE.MathUtils.degToRad(4),
  driftGain: 22,
  driftDamp: 5,
  /** a slide above this angle with power or handbrake starts drift mode */
  driftEnter: THREE.MathUtils.degToRad(10),
  driftExit: THREE.MathUtils.degToRad(5),
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
  // body frame: x = forward (vF), y = rgt (vR), r = yawRate (turns fwd towards rgt)
  const T = TYRE;
  const speedAbs = Math.hypot(vF, vR);
  const dir = vF >= 0 ? 1 : -1;

  // steering: rate-limited input, speed-sensitive lock while gripping,
  // full lock (for counter-steer) once the car is sliding
  const rate = steerIn !== 0 ? 4.5 : 7;
  b.steer += THREE.MathUtils.clamp(steerIn - b.steer, -rate * h, rate * h);
  const beta = Math.atan2(vR, Math.abs(vF) + 1); // body slip (+ = sliding towards rgt)
  // keyboard steering is all-or-nothing, so the lock shrinks with speed like a
  // real driver's hands would; counter-steer (steering against the rotation)
  // always gets full lock so slides can be caught
  // lock that asks for just about the tyres' limit at this speed
  const gripLock = Math.atan((WHEELBASE * T.muFront * 9.81 * T.steerLimit) / Math.max(1, speedAbs * speedAbs)) + 0.03;
  const speedLock = THREE.MathUtils.clamp(gripLock, T.minSteer, T.maxSteer);
  const counter = b.steer * b.yawRate * dir < 0 && Math.abs(beta) > 0.08;
  const lock = counter ? T.maxSteer : speedLock;
  // arcade assist: the front wheels partly follow the slide (auto counter-steer)
  const assist = T.counterSteer * THREE.MathUtils.clamp(speedAbs / 8, 0, 1);
  const delta = THREE.MathUtils.clamp(b.steer * lock + beta * assist * dir, -T.maxSteer, T.maxSteer);

  // longitudinal: engine on the rear axle, brakes on both
  let fxRear = 0;
  let fxFront = 0;
  if (throttle) {
    fxRear = Math.min(T.maxDrive, T.power / Math.max(4, Math.abs(vF)));
    if (vF < -0.5) fxRear = T.maxDrive; // throttle while rolling back = brake
  } else if (brake) {
    if (vF > 0.5) {
      fxRear = -T.brake * 0.4;
      fxFront = -T.brake * 0.6;
    } else fxRear = -T.maxDrive * 0.45; // reverse
  }
  fxRear -= Math.sign(vF) * (T.rollRes + T.aero * vF * vF);

  // weight transfer (braking loads the nose, throttle squats the rear)
  const shift = THREE.MathUtils.clamp(b.aLong * T.mass * T.cgH / WHEELBASE, -T.mass * 9.81 * 0.15, T.mass * 9.81 * 0.15);
  const fzF = (T.mass * 9.81 * T.b) / WHEELBASE - shift;
  const fzR = (T.mass * 9.81 * T.a) / WHEELBASE + shift;

  // slip angles (low-speed safe)
  const vx = Math.abs(vF) + 1.5;
  const alphaF = Math.atan2(vR + T.a * b.yawRate * dir, vx) - delta * dir;
  const alphaR = Math.atan2(vR - T.b * b.yawRate * dir, vx);

  // rear friction circle: drive / handbrake eat into lateral grip
  const muR = T.muRear;
  let rearLatScale = 1;
  if (handbrake && Math.abs(vF) > 1) {
    fxRear = -Math.sign(vF) * muR * fzR * 0.7;
    rearLatScale = T.handbrakeLat;
  }
  const maxR = muR * fzR;
  fxRear = THREE.MathUtils.clamp(fxRear, -maxR, maxR);
  rearLatScale *= 1 - T.powerOversteer * (fxRear / maxR) ** 2;

  const fyF = -T.muFront * fzF * Math.sin(T.shapeC * Math.atan(T.stiffB * alphaF));
  const fyR = -muR * fzR * rearLatScale * Math.sin(T.shapeC * Math.atan(T.stiffB * alphaR));

  // equations of motion
  const cosD = Math.cos(delta);
  const sinD = Math.sin(delta);
  const ax = (fxRear + fxFront * cosD - fyF * sinD) / T.mass;
  const ay = (fyR + fyF * cosD + fxFront * sinD) / T.mass;
  let rDot = ((T.a * (fyF * cosD + fxFront * sinD) - T.b * fyR) / T.inertia) * dir;

  // drift mode: once a slide is started (handbrake / power), steer sets the
  // angle you hold — into the turn for a deep drift, neutral for a shallow
  // one, against it to straighten out — and a yaw controller holds it
  const slideAbs = Math.abs(beta);
  if (!b.drift && slideAbs > T.driftEnter && (throttle || handbrake) && vF > 6) b.drift = 1;
  const side = beta < 0 ? 1 : -1; // +1: rotating towards rgt (yawRate > 0)
  const into = b.steer * side; // + = steering into the drift
  // counter-steering a shallow slide ends the drift instead of flicking the car the other way
  const caught = into < -0.3 && slideAbs < T.driftEnter;
  if (b.drift && (slideAbs < T.driftExit || vF < 4 || brake || caught)) b.drift = 0;
  if (b.drift) {
    const target =
      into > 0.1
        ? THREE.MathUtils.lerp(T.driftNeutral, T.driftInto, into)
        : into < -0.1
          ? THREE.MathUtils.lerp(T.driftNeutral, T.driftCounter, -into)
          : T.driftNeutral;
    const targetBeta = -side * (throttle || handbrake ? target : target * 0.6);
    const betaRate = b.betaPrev === undefined ? 0 : (beta - b.betaPrev) / h;
    const auth = Math.min(1, speedAbs / 10);
    rDot += ((beta - targetBeta) * T.driftGain + betaRate * T.driftDamp) * auth;
  }
  b.betaPrev = beta;

  // arcade assist: past ~60 deg of slide, damp the yaw so it doesn't spin out
  const excess = Math.max(0, Math.abs(beta) - T.maxSlide * 0.85);
  rDot -= b.yawRate * excess * T.spinDamp;
  // at a crawl, blend to kinematic steering (no jitter when parked)
  const slow = THREE.MathUtils.clamp(1 - speedAbs / 3, 0, 1);

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
  vF = THREE.MathUtils.clamp(vF, -12, MAX_VF);

  b.vF = vF;
  b.vR = vR;
}
