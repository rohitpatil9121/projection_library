/**
 * Tween: animate numeric properties over time with easing.
 *
 *   tweens.to(camera, { distance: 30, pitch: 1.1 }, { duration: 1.2, ease: Ease.inOutCubic });
 *   // each frame: tweens.update(frameDelta)
 *
 * Easing formulas are the standard Robert Penner equations (published curves, reimplemented here).
 * @module engine/Tween
 */
export const Ease = Object.freeze({
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
});

export class Tweens {
    constructor() {
        /** @type {Array<any>} */
        this.active = [];
    }

    /**
     * @param {object} target
     * @param {Record<string, number>} props end values
     * @param {{ duration?: number, delay?: number, ease?: (t: number) => number,
     *           onUpdate?: (target: object, t: number) => void, onComplete?: (target: object) => void }} [options]
     * @returns {{ cancel: () => void, done: boolean }}
     */
    to(target, props, options = {}) {
        const tw = {
            target, props, from: {}, started: false,
            duration: Math.max(1e-4, options.duration ?? 0.5), delay: options.delay ?? 0, elapsed: 0,
            ease: options.ease || Ease.outCubic, onUpdate: options.onUpdate, onComplete: options.onComplete, done: false,
            cancel() { this.done = true; },
        };
        this.active.push(tw);
        return tw;
    }

    /** Cancel every tween on a target (e.g. before starting a new camera move). */
    cancelTarget(target) { for (const t of this.active) if (t.target === target) t.done = true; }

    /** @param {number} dt seconds */
    update(dt) {
        for (let i = 0; i < this.active.length; i++) {
            const tw = this.active[i];
            if (tw.done) continue;
            if (tw.delay > 0) { tw.delay -= dt; continue; }
            if (!tw.started) { tw.started = true; for (const k in tw.props) tw.from[k] = tw.target[k]; }
            tw.elapsed += dt;
            const t = Math.min(1, tw.elapsed / tw.duration), e = tw.ease(t);
            for (const k in tw.props) tw.target[k] = tw.from[k] + (tw.props[k] - tw.from[k]) * e;
            tw.onUpdate?.(tw.target, t);
            if (t >= 1) { tw.done = true; tw.onComplete?.(tw.target); }
        }
        // compact finished tweens (in place, no new array)
        let w = 0;
        for (let r = 0; r < this.active.length; r++) if (!this.active[r].done) this.active[w++] = this.active[r];
        this.active.length = w;
    }

    /** Promise that resolves when the tween completes. */
    wait(target, props, options = {}) {
        return new Promise((resolve) => this.to(target, props, { ...options, onComplete: (t) => { options.onComplete?.(t); resolve(t); } }));
    }
}
