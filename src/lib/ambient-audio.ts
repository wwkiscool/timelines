// Synthesizes a subtle deep-space ambient drone and optional second-tick pulse
// via Web Audio API so zero external audio assets are required.

export class AmbientSpaceAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private enabled = false;
  private paused = false;

  async setEnabled(next: boolean): Promise<boolean> {
    if (next === this.enabled) return this.enabled;
    if (!next) {
      this.enabled = false;
      this.fadeOutAndSuspend();
      return false;
    }
    const started = await this.ensureStarted();
    this.enabled = started;
    if (started) this.updateGain();
    return this.enabled;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (this.enabled) this.updateGain();
  }

  triggerTick(isAccent = false) {
    if (!this.enabled || this.paused || !this.ctx || !this.masterGain || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isAccent ? 660 : 440, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(isAccent ? 0.025 : 0.012, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  dispose() {
    this.enabled = false;
    try {
      this.oscA?.stop();
      this.oscB?.stop();
      this.lfo?.stop();
    } catch {
      // Oscillators may already be stopped.
    }
    this.oscA = null;
    this.oscB = null;
    this.lfo = null;
    this.masterGain = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      void ctx.close().catch(() => undefined);
    }
  }

  private async ensureStarted(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    if (!this.ctx) {
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 260;
      filter.Q.value = 0.8;
      filter.connect(master);

      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.16;
      droneGain.connect(filter);

      const oscA = ctx.createOscillator();
      oscA.type = "sine";
      oscA.frequency.value = 65.41; // C2
      oscA.connect(droneGain);

      const oscB = ctx.createOscillator();
      oscB.type = "triangle";
      oscB.frequency.value = 98.0; // G2
      const oscBGain = ctx.createGain();
      oscBGain.gain.value = 0.35;
      oscB.connect(oscBGain);
      oscBGain.connect(droneGain);

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.08;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 70;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      oscA.start();
      oscB.start();
      lfo.start();

      this.ctx = ctx;
      this.masterGain = master;
      this.oscA = oscA;
      this.oscB = oscB;
      this.lfo = lfo;
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    return this.ctx.state === "running";
  }

  private updateGain() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this.enabled ? (this.paused ? 0.12 : 0.38) : 0.0001;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.25);
  }

  private fadeOutAndSuspend() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.0001, now, 0.15);
    const ctx = this.ctx;
    setTimeout(() => {
      if (!this.enabled && this.ctx === ctx && ctx.state === "running") {
        void ctx.suspend().catch(() => undefined);
      }
    }, 550);
  }
}
