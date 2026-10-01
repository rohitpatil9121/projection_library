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
 * Composite: scene (× ambient occlusion) + bloom mips, exposure, ACES tone map, vignette, grain, optional chromatic aberration,
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
uniform sampler2D u_ao;        // ambient occlusion (white = open)
uniform float u_aoStrength;    // 0 = off
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
    if (u_aoStrength > 0.0) {
        // occlusion dims surfaces, not light sources: anything already brighter than white is left alone
        float ao = mix(1.0, texture2D(u_ao, v_uv).r, u_aoStrength);
        col *= mix(ao, 1.0, smoothstep(1.0, 2.0, luma(col)));
    }
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


/**
 * Ambient occlusion from the depth buffer (SSAO): creases, corners and the ground under things receive a
 * little less ambient light, which is what makes objects look like they sit on a surface.
 *
 * For each pixel: rebuild its position in camera space from depth, estimate the surface normal from the
 * neighbouring pixels, then test a handful of points in the hemisphere above the surface. A test point
 * that lies behind what the depth buffer shows at its screen position is inside something, so it counts
 * as blocked. The blocked fraction is the darkening. The sample pattern is rotated per pixel (so few
 * samples are enough) and the result is blurred afterwards to hide that noise.
 *
 * Positions come from the engine's own projection (shaders/chunks/projection.js): camera-space depth is
 * recovered from the stored value, and x and y by undoing the multiply by u_proj.
 */
export const SSAO_SAMPLES = 10;

export const ssaoFragment = /* glsl */ `
uniform sampler2D u_depth;
uniform vec4 u_proj;        // x: focal / aspect, y: focal, z: near, w: far
uniform vec2 u_texel;       // 1 / depth texture size
uniform float u_radius;     // world units
uniform float u_bias;
varying vec2 v_uv;

float viewZ(vec2 uv) {
    float d = texture2D(u_depth, uv).r * 2.0 - 1.0;
    return 2.0 * u_proj.w * u_proj.z / ((u_proj.w + u_proj.z) - d * (u_proj.w - u_proj.z));
}
vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) / u_proj.xy * z, z); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    float z = viewZ(v_uv);
    if (z > u_proj.w * 0.9) { gl_FragColor = vec4(1.0); return; }     // sky
    vec3 p = viewPos(v_uv, z);
    // surface normal from neighbours; on each axis use the neighbour closer in depth, so the normal
    // doesn't smear across the silhouette of something in front
    vec2 dx = vec2(u_texel.x, 0.0), dy = vec2(0.0, u_texel.y);
    float zl = viewZ(v_uv - dx), zr = viewZ(v_uv + dx), zd = viewZ(v_uv - dy), zu = viewZ(v_uv + dy);
    vec3 ddx = abs(zr - z) < abs(z - zl) ? viewPos(v_uv + dx, zr) - p : p - viewPos(v_uv - dx, zl);
    vec3 ddy = abs(zu - z) < abs(z - zd) ? viewPos(v_uv + dy, zu) - p : p - viewPos(v_uv - dy, zd);
    vec3 n = normalize(cross(ddy, ddx));                               // points back toward the camera
    vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);

    float spin = hash(gl_FragCoord.xy) * 6.2831853;
    float blocked = 0.0;
    for (int i = 0; i < ${SSAO_SAMPLES}; i++) {
        float fi = float(i);
        float h = (fi + 0.5) / ${SSAO_SAMPLES}.0;                       // height above the surface, 0..1
        float a = fi * 2.3999632 + spin;                               // golden-angle spiral
        float r = sqrt(1.0 - h * h);
        float reach = u_radius * (0.25 + 0.75 * fract(fi * 0.618 + spin));
        vec3 q = p + (t * (cos(a) * r) + b * (sin(a) * r) + n * h) * reach;
        vec2 uv = (q.xy * u_proj.xy / q.z) * 0.5 + 0.5;
        float seen = viewZ(uv);
        // ignore blockers far in front (a railing shouldn't darken the wall a metre behind it)
        float near = smoothstep(0.0, 1.0, u_radius / (abs(z - seen) + 0.0001));
        blocked += step(seen, q.z - u_bias) * near;
    }
    gl_FragColor = vec4(vec3(1.0 - blocked / ${SSAO_SAMPLES}.0), 1.0);
}
`;

/** 4×4 box blur in four bilinear taps: removes the per-pixel rotation noise of the SSAO pass. */
export const ssaoBlurFragment = /* glsl */ `
uniform sampler2D u_source;
uniform vec2 u_texel;
varying vec2 v_uv;
void main() {
    float a = texture2D(u_source, v_uv + u_texel * vec2(-1.0, -1.0)).r + texture2D(u_source, v_uv + u_texel * vec2(1.0, -1.0)).r
            + texture2D(u_source, v_uv + u_texel * vec2(-1.0, 1.0)).r + texture2D(u_source, v_uv + u_texel * vec2(1.0, 1.0)).r;
    gl_FragColor = vec4(vec3(a * 0.25), 1.0);
}
`;
