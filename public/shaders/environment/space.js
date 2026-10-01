/**
 * Procedural space sky: two star layers + nebula clouds, computed per pixel from the view ray.
 * Noise is simple hash-based value noise written for this project.
 *
 * The view ray for a pixel comes straight from the camera basis (the inverse of projectLab):
 *   ray = normalize(forward + right · ndc.x / proj.x + up · ndc.y / proj.y)
 * @module shaders/environment/space
 */
export const vertex = /* glsl */ `
attribute vec2 a_position;
varying vec2 v_ndc;
void main() {
    v_ndc = a_position;
    gl_Position = vec4(a_position, 0.9999, 1.0);
}
`;

export const fragment = /* glsl */ `
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec4 u_proj;
uniform float u_time;
uniform vec3 u_base;        // deep space colour
uniform vec3 u_nebulaA;     // nebula colour 1
uniform vec3 u_nebulaB;     // nebula colour 2
uniform float u_nebula;     // nebula strength
uniform float u_stars;      // star density 0..1
uniform vec3 u_seed;        // shifts the whole sky (per level)
varying vec2 v_ndc;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);   // smoothstep interpolation
    float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
    float e = hash13(i + vec3(0, 0, 1)), f1 = hash13(i + vec3(1, 0, 1)), g = hash13(i + vec3(0, 1, 1)), h = hash13(i + vec3(1, 1, 1));
    return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}

float fbm(vec3 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) { v += amp * valueNoise(p); p *= 2.03; amp *= 0.5; }
    return v;
}

// One layer of stars: split the sphere of directions into cells; some cells hold a star at a random offset.
float starLayer(vec3 dir, float scale, float density, float size) {
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 local = fract(p) - 0.5;
    float h = hash13(cell + u_seed);
    if (h > density) return 0.0;
    vec3 offset = vec3(hash13(cell + 11.1), hash13(cell + 23.7), hash13(cell + 37.3)) - 0.5;
    float d = length(local - offset * 0.6);
    float twinkle = 0.75 + 0.25 * sin(u_time * (1.0 + h * 5.0) + h * 40.0);
    return smoothstep(size, 0.0, d) * twinkle * (0.4 + h / density);
}

void main() {
    vec3 ray = normalize(u_camForward + u_camRight * (v_ndc.x / u_proj.x) + u_camUp * (v_ndc.y / u_proj.y));
    vec3 col = u_base;

    // nebula: two warped fbm fields tinted with the two nebula colours
    vec3 q = ray * 1.6 + u_seed * 0.01;
    float n1 = fbm(q + vec3(0.0, 0.0, u_time * 0.004));
    float n2 = fbm(q * 1.7 + vec3(n1 * 1.5) + 4.0);
    float cloud = smoothstep(0.35, 0.85, n1);
    col += u_nebulaA * cloud * u_nebula;
    col += u_nebulaB * smoothstep(0.45, 0.9, n2) * cloud * u_nebula * 0.9;
    col += u_nebulaA * pow(n2, 6.0) * u_nebula * 0.6;

    // stars: a dense faint layer + a sparse bright layer (bright ones exceed 1.0 so bloom catches them)
    col += vec3(0.75, 0.82, 1.0) * starLayer(ray, 180.0, 0.10 * u_stars, 0.18) * 0.6;
    col += vec3(1.0, 0.95, 0.9) * starLayer(ray, 70.0, 0.05 * u_stars, 0.12) * 2.2;

    gl_FragColor = vec4(col, 1.0);
}
`;
