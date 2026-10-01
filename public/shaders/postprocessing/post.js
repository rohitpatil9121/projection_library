/**
 * Post-processing shaders used by engine/PostFX. All written for this project unless noted.
 * @module shaders/postprocessing/post
 */

/** Full-screen triangle: three vertices at (-1,-1), (3,-1), (-1,3) cover the viewport with no seam. */
export const fullscreenVertex = /* glsl */ `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Bright pass + 2x downsample. A soft "knee" around the threshold avoids a hard cut, so bloom fades in
 * smoothly as values approach the threshold instead of popping.
 */
export const brightFragment = /* glsl */ `
uniform sampler2D u_source;
uniform vec2 u_texel;       // 1 / source size
uniform float u_threshold;
uniform float u_knee;
varying vec2 v_uv;
void main() {
    // 4 bilinear taps = a 4x4 box average: cheap, stable downsample
    vec3 c = texture2D(u_source, v_uv + u_texel * vec2(-1.0, -1.0)).rgb
           + texture2D(u_source, v_uv + u_texel * vec2( 1.0, -1.0)).rgb
           + texture2D(u_source, v_uv + u_texel * vec2(-1.0,  1.0)).rgb
           + texture2D(u_source, v_uv + u_texel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;
    float brightness = max(c.r, max(c.g, c.b));
    float soft = clamp(brightness - u_threshold + u_knee, 0.0, 2.0 * u_knee);
    soft = soft * soft / (4.0 * u_knee + 1e-4);
    float contribution = max(soft, brightness - u_threshold) / max(brightness, 1e-4);
    gl_FragColor = vec4(c * contribution, 1.0);
}
`;

/** Plain 2x downsample (4 bilinear taps). */
export const downsampleFragment = /* glsl */ `
uniform sampler2D u_source;
uniform vec2 u_texel;
varying vec2 v_uv;
void main() {
    vec3 c = texture2D(u_source, v_uv + u_texel * vec2(-1.0, -1.0)).rgb
           + texture2D(u_source, v_uv + u_texel * vec2( 1.0, -1.0)).rgb
           + texture2D(u_source, v_uv + u_texel * vec2(-1.0,  1.0)).rgb
           + texture2D(u_source, v_uv + u_texel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

/**
 * Separable Gaussian blur, 9 taps done as 5 bilinear fetches (weights of a sigma≈2 kernel folded pairwise:
 * sampling between two texels with linear filtering returns their weighted average for free).
 */
export const blurFragment = /* glsl */ `
uniform sampler2D u_source;
uniform vec2 u_direction;   // texel step along x or y, scaled by radius
varying vec2 v_uv;
void main() {
    vec3 c = texture2D(u_source, v_uv).rgb * 0.2270270;
    c += texture2D(u_source, v_uv + u_direction * 1.3846154).rgb * 0.3162162;
    c += texture2D(u_source, v_uv - u_direction * 1.3846154).rgb * 0.3162162;
    c += texture2D(u_source, v_uv + u_direction * 3.2307692).rgb * 0.0702703;
    c += texture2D(u_source, v_uv - u_direction * 3.2307692).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Composite: scene + bloom mips, exposure, ACES tone map, vignette, grain, optional chromatic aberration,
 * and a small edge-aware anti-aliasing step (framebuffers have no MSAA in WebGL1).
 *
 * ACES filmic curve: the analytic fit by Krzysztof Narkowicz ("ACES Filmic Tone Mapping Curve", 2016,
 * https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/). A published formula; no code copied.
 */
export const compositeFragment = /* glsl */ `
uniform sampler2D u_scene;
uniform sampler2D u_bloom0;
uniform sampler2D u_bloom1;
uniform sampler2D u_bloom2;
uniform vec2 u_texel;          // 1 / scene size
uniform float u_bloomIntensity;
uniform float u_exposure;
uniform float u_vignette;
uniform float u_grain;
uniform float u_aberration;
uniform float u_time;
uniform float u_tonemap;       // 1 = ACES, 0 = clamp
uniform float u_antialias;     // 1 = on
varying vec2 v_uv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 sampleScene(vec2 uv) {
    if (u_aberration > 0.0) {
        vec2 d = (uv - 0.5) * u_aberration * 0.01;
        return vec3(texture2D(u_scene, uv + d).r, texture2D(u_scene, uv).g, texture2D(u_scene, uv - d).b);
    }
    return texture2D(u_scene, uv).rgb;
}

// Edge-aware AA: find how strongly luminance changes across x and y, then average along the edge
// (perpendicular to the gradient). Flat areas are untouched, so text-like detail stays sharp.
vec3 antialiased(vec2 uv) {
    vec3 c = sampleScene(uv);
    if (u_antialias < 0.5) return c;
    float lN = luma(texture2D(u_scene, uv + vec2(0.0, u_texel.y)).rgb);
    float lS = luma(texture2D(u_scene, uv - vec2(0.0, u_texel.y)).rgb);
    float lE = luma(texture2D(u_scene, uv + vec2(u_texel.x, 0.0)).rgb);
    float lW = luma(texture2D(u_scene, uv - vec2(u_texel.x, 0.0)).rgb);
    vec2 grad = vec2(lE - lW, lN - lS);
    float edge = length(grad);
    if (edge < 0.06) return c;
    vec2 along = normalize(vec2(-grad.y, grad.x)) * u_texel;
    vec3 blur = (texture2D(u_scene, uv + along * 0.75).rgb + texture2D(u_scene, uv - along * 0.75).rgb) * 0.5;
    return mix(c, blur, clamp(edge * 2.0, 0.0, 0.75));
}

vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec3 col = antialiased(v_uv);
    vec3 bloom = texture2D(u_bloom0, v_uv).rgb * 0.5 + texture2D(u_bloom1, v_uv).rgb * 0.35 + texture2D(u_bloom2, v_uv).rgb * 0.35;
    col += bloom * u_bloomIntensity;
    col *= u_exposure;
    col = u_tonemap > 0.5 ? aces(col) : clamp(col, 0.0, 1.0);
    vec2 q = v_uv - 0.5;
    col *= 1.0 - dot(q, q) * u_vignette * 2.0;
    col += (hash(v_uv * 913.0 + fract(u_time) * 71.0) - 0.5) * u_grain;
    gl_FragColor = vec4(col, 1.0);
}
`;
