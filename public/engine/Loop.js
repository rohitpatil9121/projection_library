import { LOOP } from "./config.js";

/**
 * Loop: fixed-timestep simulation + interpolated rendering on one requestAnimationFrame.
 *
 *   real time ──► accumulator += frameDelta · timeScale
 *                  while accumulator ≥ step: update(step); accumulator −= step
 *                  render(alpha = accumulator / step)
 *
 * The simulation always advances in exact 1/60 s steps, so physics and gameplay are deterministic and
 * frame-rate independent. `alpha` lets the renderer blend between the last two simulated states.
 *
 * - `timeScale` slows or speeds simulated time (slow-mo); render still runs every frame.
 * - `paused` stops simulation but keeps rendering (menus over a frozen scene).
 * - When the tab is hidden the loop auto-pauses and, on return, discards the time spent away
 *   (no huge catch-up burst).
 * @module engine/Loop
 */
export class Loop {
    /**
     * @param {{ update: (dt: number) => void, render: (alpha: number, frameDelta: number) => void,
     *           step?: number, maxStepsPerFrame?: number, autoPauseWhenHidden?: boolean,
     *           now?: () => number, requestFrame?: (cb: FrameRequestCallback) => number,
     *           cancelFrame?: (id: number) => void }} options
     *        `now`, `requestFrame` and `cancelFrame` are injectable for tests.
     */
    constructor(options) {
        this.update = options.update;
        this.render = options.render;
        this.step = options.step ?? LOOP.step;
        this.maxStepsPerFrame = options.maxStepsPerFrame ?? LOOP.maxStepsPerFrame;
        this.maxFrameDelta = LOOP.maxFrameDelta;
        this.timeScale = 1;
        this.paused = false;
        /** simulated seconds (affected by timeScale, not by pauses) */
        this.time = 0;
        /** real seconds since start (for UI animation) */
        this.realTime = 0;
        this.frame = 0;
        this.alpha = 0;
        /** smoothed frames per second and frame time in ms */
        this.fps = 60;
        this.frameMs = 16.7;
        /** true when the last frame had to drop simulation time (simulation too slow) */
        this.droppedTime = false;

        this._now = options.now || (() => performance.now());
        this._raf = options.requestFrame || ((cb) => requestAnimationFrame(cb));
        this._caf = options.cancelFrame || ((id) => cancelAnimationFrame(id));
        this._acc = 0;
        this._last = 0;
        this._id = 0;
        this._running = false;
        this._hiddenPause = false;
        this._tick = (t) => this.tick(t);

        if (options.autoPauseWhenHidden !== false && typeof document !== "undefined") {
            this._onVisibility = () => {
                if (document.hidden) { this._hiddenPause = true; }
                else if (this._hiddenPause) { this._hiddenPause = false; this._last = this._now(); }
            };
            document.addEventListener("visibilitychange", this._onVisibility);
        }
    }

    start() {
        if (this._running) return this;
        this._running = true;
        this._last = this._now();
        this._id = this._raf(this._tick);
        return this;
    }

    stop() {
        this._running = false;
        this._caf(this._id);
        return this;
    }

    pause() { this.paused = true; return this; }
    resume() { this.paused = false; this._last = this._now(); return this; }

    /** One animation frame. Public so tests can drive it with fake timestamps. */
    tick(timestamp) {
        if (!this._running) return;
        const now = timestamp ?? this._now();
        let delta = (now - this._last) / 1000;
        this._last = now;
        if (!(delta > 0)) delta = 0;
        if (delta > this.maxFrameDelta) delta = this.maxFrameDelta;

        this.realTime += delta;
        this.frame++;
        if (delta > 0) {
            this.frameMs += (delta * 1000 - this.frameMs) * 0.1;
            this.fps = 1000 / this.frameMs;
        }

        if (!this.paused && !this._hiddenPause) {
            this._acc += delta * this.timeScale;
            let steps = 0;
            while (this._acc >= this.step && steps < this.maxStepsPerFrame) {
                this.update(this.step);
                this.time += this.step;
                this._acc -= this.step;
                steps++;
            }
            this.droppedTime = this._acc >= this.step;
            if (this.droppedTime) this._acc = 0; // too slow to catch up: drop the backlog rather than spiral
            this.alpha = this._acc / this.step;
        }
        this.render(this.paused ? 1 : this.alpha, delta);
        if (this._running) this._id = this._raf(this._tick);
    }

    dispose() {
        this.stop();
        if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
    }
}
