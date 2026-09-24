// Synthesised car horns (Web Audio, no samples). A horn "voice" is two
// detuned oscillators (the classic dual-tone horn) through a soft clipper and
// a lowpass, gated by a fast attack / release envelope. The AudioContext is
// created lazily on first use (after a user gesture) and closed on dispose.

type Ctx = AudioContext;

class HornVoice {
  private env: GainNode;
  private oscs: OscillatorNode[] = [];
  private on = false;

  constructor(ctx: Ctx, out: AudioNode, f1: number, f2: number, volume: number, pan: number, cutoff: number) {
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const specs: [number, OscillatorType, number][] = [
      [f1, "sawtooth", 0.55],
      [f2, "square", 0.35],
      [f2 * 1.004, "sawtooth", 0.3],
    ];
    for (const [f, type, g] of specs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(mix);
      o.start();
      this.oscs.push(o);
    }
    // soft clip: gives the brassy "blare"
    const shaper = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6) / Math.tanh(2.6);
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    lp.Q.value = 0.9;
    // horn-body resonance
    const peak = ctx.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = (f1 + f2) * 1.5;
    peak.Q.value = 1.4;
    peak.gain.value = 5;
    this.env = ctx.createGain();
    this.env.gain.value = 0;
    const vol = ctx.createGain();
    vol.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    mix.connect(shaper).connect(lp).connect(peak).connect(this.env).connect(vol).connect(panner).connect(out);
  }

  set(ctx: Ctx, on: boolean) {
    if (on === this.on) return;
    this.on = on;
    const t = ctx.currentTime;
    const g = this.env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 1 : 0, t, on ? 0.01 : 0.035);
  }

  /** one short beep starting `delay` seconds from now */
  blip(ctx: Ctx, delay: number, dur: number) {
    const t = ctx.currentTime + delay;
    const g = this.env.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.setTargetAtTime(1, t, 0.012);
    g.setTargetAtTime(0, t + dur, 0.04);
  }

  stop() {
    for (const o of this.oscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}

export class CarHorn {
  private ctx: Ctx | null = null;
  private main: HornVoice | null = null;
  private other: HornVoice | null = null;
  private held = false;

  private ensure(): Ctx | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    // player's horn: ~420 / 500 Hz, centred
    this.main = new HornVoice(ctx, master, 418, 502, 0.16, 0, 2600);
    // other drivers: lower, duller, quieter, from behind-left
    this.other = new HornVoice(ctx, master, 338, 404, 0.07, -0.25, 1500);
    this.ctx = ctx;
    return ctx;
  }

  /** Hold state of the player's horn (call every frame; cheap when unchanged). */
  setHeld(on: boolean) {
    if (on === this.held) return;
    this.held = on;
    const ctx = on ? this.ensure() : this.ctx;
    if (!ctx || !this.main) return;
    if (on && ctx.state === "suspended") void ctx.resume();
    this.main.set(ctx, on);
  }

  /** Another car honks back briefly. */
  honkBack(delay: number, dur: number) {
    const ctx = this.ensure(); // the page already has a user gesture (start button)
    if (!ctx || !this.other) return;
    if (ctx.state === "suspended") void ctx.resume();
    this.other.blip(ctx, delay, dur);
  }

  dispose() {
    this.main?.stop();
    this.other?.stop();
    this.main = this.other = null;
    this.held = false;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close();
  }
}
