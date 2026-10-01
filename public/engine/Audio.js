/**
 * Audio: procedural sound effects (ZzFX, MIT) + an ambient drone, behind our own mixer.
 *
 * Nothing is created until `unlock()` runs inside a user gesture (browsers block audio before that, and
 * creating an AudioContext early prints a console warning). ZzFX is imported lazily at that moment and only
 * its sample generator is used; playback goes through our graph:
 *
 *   source ─► panner ─► channel gain (sfx | music) ─► master gain ─► speakers
 *
 *   audio.define("pop", [1.2, .05, 520, .01, .02, .1, , 1.8]);   // ZzFX parameters
 *   button.onclick = async () => { await audio.unlock(); audio.play("pop", { pitch: 1.1 }); };
 *
 * ZzFX by Frank Force, MIT: https://github.com/KilledByAPixel/ZzFX (vendored at vendor/zzfx@1.3.2)
 * @module engine/Audio
 */
const ZZFX_URL = "../vendor/zzfx@1.3.2/ZzFX.js";

export class Audio {
    /** @param {{ volume?: number, sfx?: number, music?: number, muted?: boolean }} [options] */
    constructor(options = {}) {
        this.ctx = null;
        this.volumes = { master: options.volume ?? 0.8, sfx: options.sfx ?? 1, music: options.music ?? 0.6 };
        this.muted = options.muted ?? false;
        /** @type {Map<string, number[]>} */
        this.defs = new Map();
        /** @type {Map<string, AudioBuffer>} */
        this.buffers = new Map();
        this._zzfx = null;
        this._unlocking = null;
        this._drone = null;
    }

    get ready() { return !!this.ctx && !!this._zzfx; }

    /** Register a named sound from ZzFX parameters (build the array at https://killedbyapixel.github.io/ZzFX/). */
    define(name, params) { this.defs.set(name, params); this.buffers.delete(name); return this; }

    /** Create the audio graph. Call from a click / key / touch handler. Safe to call repeatedly. */
    unlock() {
        if (this._unlocking) return this._unlocking;
        this._unlocking = (async () => {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.connect(this.ctx.destination);
            this.channels = { sfx: this.ctx.createGain(), music: this.ctx.createGain() };
            for (const k in this.channels) this.channels[k].connect(this.master);
            this._applyVolumes();
            const mod = await import(ZZFX_URL);
            // ZzFX makes its own AudioContext on import; we only need its sample generator
            try { mod.ZZFX.audioContext?.close?.(); } catch (e) { /* already closed */ }
            this._zzfx = mod.ZZFX;
            if (this.ctx.state === "suspended") await this.ctx.resume();
        })();
        return this._unlocking;
    }

    _applyVolumes() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.02);
        for (const k in this.channels) this.channels[k].gain.setTargetAtTime(this.volumes[k], t, 0.02);
    }

    /** @param {"master" | "sfx" | "music"} channel @param {number} value 0..1 */
    setVolume(channel, value) { this.volumes[channel] = value; this._applyVolumes(); }
    setMuted(muted) { this.muted = muted; this._applyVolumes(); }

    /**
     * Play a defined sound. Silently does nothing before unlock().
     * @param {string} name
     * @param {{ volume?: number, pitch?: number, pan?: number }} [opts] pitch = playback rate (1 = original)
     */
    play(name, opts = {}) {
        if (!this.ready || this.muted) return null;
        let buffer = this.buffers.get(name);
        if (!buffer) {
            const params = this.defs.get(name);
            if (!params) return null;
            const samples = this._zzfx.buildSamples(...params);
            buffer = this.ctx.createBuffer(1, samples.length, this._zzfx.sampleRate);
            buffer.getChannelData(0).set(samples);
            this.buffers.set(name, buffer);
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = opts.pitch ?? 1;
        const gain = this.ctx.createGain();
        gain.gain.value = opts.volume ?? 1;
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        if (pan) { pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0)); src.connect(pan).connect(gain); }
        else src.connect(gain);
        gain.connect(this.channels.sfx);
        src.start();
        return src;
    }

    /**
     * Start a soft ambient pad on the music channel: detuned oscillators through a slowly sweeping filter.
     * @param {{ root?: number, chord?: number[], level?: number }} [opts] root Hz, chord as ratios
     */
    drone(opts = {}) {
        if (!this.ctx || this._drone) return;
        const ctx = this.ctx, root = opts.root ?? 55, chord = opts.chord || [1, 1.5, 2, 2.9966, 4];
        const out = ctx.createGain();
        out.gain.value = 0;
        out.gain.setTargetAtTime(opts.level ?? 0.12, ctx.currentTime, 2.5);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass"; filter.frequency.value = 600; filter.Q.value = 0.7;
        const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
        lfo.frequency.value = 0.05; lfoGain.gain.value = 350;
        lfo.connect(lfoGain).connect(filter.frequency);
        filter.connect(out).connect(this.channels.music);
        const oscs = [lfo];
        chord.forEach((ratio, i) => {
            for (const detune of [-6, 6]) {
                const o = ctx.createOscillator();
                o.type = i === 0 ? "sine" : "triangle";
                o.frequency.value = root * ratio;
                o.detune.value = detune + i * 1.5;
                const g = ctx.createGain();
                g.gain.value = 0.18 / (i + 1);
                o.connect(g).connect(filter);
                oscs.push(o);
            }
        });
        oscs.forEach((o) => o.start());
        this._drone = { out, oscs };
    }

    stopDrone(fade = 1.5) {
        if (!this._drone || !this.ctx) return;
        const d = this._drone, t = this.ctx.currentTime;
        d.out.gain.setTargetAtTime(0, t, fade / 3);
        d.oscs.forEach((o) => o.stop(t + fade + 0.1));
        this._drone = null;
    }
}
