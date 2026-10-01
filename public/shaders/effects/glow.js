import { projection } from "../chunks/projection.js";

/**
 * Glow shell (additive). Used by GlowMaterial.
 *
 * Default (atmosphere): drawn on the BACK faces of a sphere a bit larger than the object. Where the back
 * face points straight away from the viewer (behind the object's centre) the shell is hidden by the object;
 * toward the shell's outline the facing term falls off, so the light fades smoothly outward: a soft halo.
 *   intensity = pow(max(-n·v, 0), power)
 *
 * INNER (core glow): drawn on FRONT faces, brightest facing the viewer, fading at the edge.
 *   intensity = pow(max(n·v, 0), power)
 * @module shaders/effects/glow
 */
export const vertex = /* glsl */ `
${projection}
attribute vec3 a_position;
attribute vec3 a_normal;
uniform mat4 u_model;
varying vec3 v_normal;
varying vec3 v_world;
void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    v_world = world.xyz;
    v_normal = (u_model * vec4(a_normal, 0.0)).xyz;
    gl_Position = projectLab(world.xyz);
}
`;

export const fragment = /* glsl */ `
uniform vec3 u_camPos;
uniform vec3 u_glowColor;
uniform float u_glowIntensity;
uniform float u_glowPower;
varying vec3 v_normal;
varying vec3 v_world;
void main() {
    vec3 n = normalize(v_normal);
    vec3 v = normalize(u_camPos - v_world);
#ifdef INNER
    float f = pow(max(dot(n, v), 0.0), u_glowPower);
#else
    float f = pow(max(-dot(n, v), 0.0), u_glowPower);
#endif
    gl_FragColor = vec4(u_glowColor * f * u_glowIntensity, f);
}
`;
