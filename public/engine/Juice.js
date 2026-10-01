/**
 * Juice: game-feel effects that respect reduced motion.
 *
 * Camera shake is trauma-based (Squirrel Eiserloh, "Juicing Your Cameras With Math", GDC 2016 — an idea,
 * reimplemented): events add trauma (0..1); shake strength is trauma², so small hits are subtle and big ones
 * heavy; trauma decays linearly. Motion comes from smooth layered sines, not random jitter, so it never
 * looks like noise on a broken screen.
 *
 *   juice.shake(0.6);          // on impact
 *   juice.update(dt);          // every frame, writes camera.shakeOffset
 * @module engine/Juice
 */
export class Juice {
    /**
     * @param {{ camera?: import("./Camera.js").Camera, maxOffset?: number, decay?: number, reducedMotion?: boolean }} [options]
     */
    constructor(options = {}) {
        this.camera = options.camera || null;
        this.maxOffset = options.maxOffset ?? 0.6;
        this.decay = options.decay ?? 1.4;
        this.trauma = 0;
        this.time = 0;
        this.reducedMotion = options.reducedMotion ??
            (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
        /** hit-stop remaining (seconds); games can check `juice.frozen` to skip simulation */
        this.hitStop = 0;
    }

    /** Add trauma (clamped to 1). */
    shake(amount) { if (!this.reducedMotion) this.trauma = Math.min(1, this.trauma + amount); }

    /** Freeze gameplay for a few milliseconds on a heavy impact. */
    freeze(ms) { if (!this.reducedMotion) this.hitStop = Math.max(this.hitStop, ms / 1000); }
    get frozen() { return this.hitStop > 0; }

    /** @param {number} dt real seconds */
    update(dt) {
        this.time += dt;
        this.hitStop = Math.max(0, this.hitStop - dt);
        this.trauma = Math.max(0, this.trauma - this.decay * dt);
        if (!this.camera) return;
        const s = this.trauma * this.trauma * this.maxOffset, t = this.time;
        const o = this.camera.shakeOffset;
        // three incommensurate frequencies per axis ≈ smooth pseudo-random motion
        o[0] = s * (Math.sin(t * 37.1) * 0.5 + Math.sin(t * 23.3 + 1.3) * 0.3 + Math.sin(t * 51.7 + 4.1) * 0.2);
        o[1] = s * (Math.sin(t * 31.7 + 2.2) * 0.5 + Math.sin(t * 19.9 + 0.7) * 0.3 + Math.sin(t * 47.3 + 3.3) * 0.2);
        o[2] = s * (Math.sin(t * 29.3 + 5.1) * 0.5 + Math.sin(t * 43.1 + 2.9) * 0.5) * 0.5;
    }
}
