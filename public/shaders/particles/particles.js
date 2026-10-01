import { projection } from "../chunks/projection.js";

/**
 * Particle point sprites. Per-vertex: position, colour (rgba), uv.x = size in world units.
 * Point size is converted from world units to pixels with the same focal length the projection uses,
 * so particles shrink with distance like real objects.
 * @module shaders/particles
 */
export const vertex = /* glsl */ `
${projection}
attribute vec3 a_position;
attribute vec4 a_color;
attribute vec2 a_uv;
uniform vec2 u_viewport;    // drawing buffer size in pixels
varying vec4 v_color;
void main() {
    gl_Position = projectLab(a_position);
    // world size -> pixels: size · focal / depth · (half the viewport height)
    gl_PointSize = max(a_uv.x * u_proj.y / max(gl_Position.w, 0.001) * 0.5 * u_viewport.y, 1.0);
    v_color = a_color;
}
`;

export const fragment = /* glsl */ `
varying vec4 v_color;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = 1.0 - d;
    a *= a;                          // soft round falloff
    gl_FragColor = vec4(v_color.rgb, v_color.a * a);
}
`;
