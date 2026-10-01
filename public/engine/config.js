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
    joints: 9,           // four joint indices per vertex (skinning)
    weights: 10,         // their four weights
});

/** Attribute names as they appear in GLSL, mapped to their fixed location. */
export const ATTRIB_NAMES = Object.freeze({
    a_position: ATTRIB.position,
    a_normal: ATTRIB.normal,
    a_uv: ATTRIB.uv,
    a_color: ATTRIB.color,
    a_instanceMatrix: ATTRIB.instanceMatrix,
    a_instanceColor: ATTRIB.instanceColor,
    a_joints: ATTRIB.joints,
    a_weights: ATTRIB.weights,
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

/** Limits baked into the lighting and skinning shaders (uniform array sizes). */
export const LIGHTS = Object.freeze({
    /** point lights evaluated per fragment */
    maxPoint: 16,
    /** texture unit reserved for the shadow map, clear of material textures */
    shadowUnit: 7,
});

export const SKIN = Object.freeze({
    /** joints per skeleton: a mat4 uniform array of this size */
    maxJoints: 32,
});

export const RENDER = Object.freeze({
    clearColor: [0.02, 0.02, 0.04, 1],
    /** default sun and hemisphere colours; a Scene copies these and games edit their copy */
    sunDirection: [0.35, -0.45, 0.82],
    sunColor: [0.9, 0.88, 0.82],
    skyColor: [0.35, 0.38, 0.55],
    groundColor: [0.07, 0.06, 0.09],
    /** distance fog: colour, and density (0 = off); surface colour fades by exp(-distance · density) */
    fogColor: [0.02, 0.02, 0.04],
    fogDensity: 0,
});
