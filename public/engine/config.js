/**
 * Central engine configuration. Every "magic number" the engine relies on lives here.
 * @module engine/config
 */

/** Fixed vertex attribute locations, bound before linking every program.
 *  Because every program agrees on these slots, one VAO works with any material. */
export const ATTRIB = Object.freeze({
    position: 0,
    normal: 1,
    uv: 2,
    color: 3,
    instanceMatrix: 4,   // a mat4 attribute occupies 4 consecutive slots: 4, 5, 6, 7
    instanceColor: 8,
});

/** Attribute names as they appear in GLSL, mapped to their fixed location. */
export const ATTRIB_NAMES = Object.freeze({
    a_position: ATTRIB.position,
    a_normal: ATTRIB.normal,
    a_uv: ATTRIB.uv,
    a_color: ATTRIB.color,
    a_instanceMatrix: ATTRIB.instanceMatrix,
    a_instanceColor: ATTRIB.instanceColor,
});

/** Quality presets. P1 uses `dprCap` and `resolutionScale`; later phases add particles, post-FX, shadows. */
export const QUALITY = Object.freeze({
    low: { dprCap: 1, resolutionScale: 0.75 },
    medium: { dprCap: 1.5, resolutionScale: 1 },
    high: { dprCap: 2, resolutionScale: 1 },
    ultra: { dprCap: 3, resolutionScale: 1 },
});

export const LOOP = Object.freeze({
    /** fixed simulation step in seconds (60 Hz) */
    step: 1 / 60,
    /** longest real frame we accept before clamping (prevents a spiral of death after a stall) */
    maxFrameDelta: 0.25,
    /** most simulation steps allowed in one rendered frame */
    maxStepsPerFrame: 5,
});

export const CAMERA = Object.freeze({
    fovDeg: 50,
    near: 0.1,
    far: 2000,
    /** pitch is clamped away from ±90° where "up" is undefined in the view basis */
    maxPitch: 1.55,
    minDistance: 0.5,
});

export const RENDER = Object.freeze({
    clearColor: [0.02, 0.02, 0.04, 1],
    /** default "sun" and hemisphere colours until the Light system lands (P2) */
    sunDirection: [0.35, -0.45, 0.82],
    sunColor: [0.9, 0.88, 0.82],
    skyColor: [0.35, 0.38, 0.55],
    groundColor: [0.07, 0.06, 0.09],
});
