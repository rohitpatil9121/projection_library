/**
 * Helpers shared by the example pages (not part of the engine).
 * @module examples/shared
 */

/**
 * Orbit camera controls from the Game's Input: drag to turn, wheel or pinch to zoom.
 * @param {import("../engine/Game.js").Game} game
 * @param {{ spin?: number, minDistance?: number, maxDistance?: number, minPitch?: number }} [options]
 *        spin: radians per second the camera drifts while nobody is dragging
 */
export function orbit(game, options = {}) {
    const { camera, input } = game, min = options.minDistance ?? 2, max = options.maxDistance ?? 400;
    let idle = 0;
    game.onUpdate((dt) => {
        const p = input.pointer;
        if (p.dragging) { camera.orbit(-p.dx * 0.006, p.dy * 0.006); idle = 0; }
        else if (options.spin && (idle += dt) > 2) camera.yaw += options.spin * dt;
        if (p.wheel) camera.zoom(Math.exp(p.wheel * 0.001));
        if (p.pinch !== 1) camera.zoom(1 / p.pinch);
        camera.distance = Math.max(min, Math.min(max, camera.distance));
        if (options.minPitch !== undefined) camera.pitch = Math.max(options.minPitch, camera.pitch);
    });
}

/** Expose the game on `window.lab` for the console, and tell the screenshot tool when a few frames have drawn. */
export function ready(game, extra = {}) {
    window.lab = { game, ...extra };
    let frames = 0;
    game.onRender(() => { if (++frames === 4) window.__ready = true; });
}

/** A small seeded random number generator (mulberry32), so an example looks the same on every visit. */
export function random(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
