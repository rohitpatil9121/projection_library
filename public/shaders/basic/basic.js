import { projection } from "../chunks/projection.js";

/**
 * Basic material shader (P1): unlit or Lambert with a hemisphere ambient + one directional light.
 * Variants via defines: LIT, VERTEX_COLORS, INSTANCED, RIM (fresnel rim light for silhouettes).
 * P2 replaces the lighting with the full Light system; the projection stays the same.
 * @module shaders/basic
 */

export const vertex = /* glsl */ `
${projection}
attribute vec3 a_position;
attribute vec3 a_normal;
#ifdef VERTEX_COLORS
attribute vec4 a_color;
varying vec4 v_color;
#endif
#ifdef INSTANCED
attribute mat4 a_instanceMatrix;
attribute vec4 a_instanceColor;
varying vec4 v_instanceColor;
#endif

uniform mat4 u_model;
varying vec3 v_normal;
varying vec3 v_world;

void main() {
    mat4 model = u_model;
#ifdef INSTANCED
    model = u_model * a_instanceMatrix;
    v_instanceColor = a_instanceColor;
#endif
#ifdef VERTEX_COLORS
    v_color = a_color;
#endif
    vec4 world = model * vec4(a_position, 1.0);
    v_world = world.xyz;
    // w = 0 transforms a direction (ignores translation); fine for uniform scale.
    // Non-uniform scale needs the inverse-transpose; the Light system in P2 handles that case.
    v_normal = (model * vec4(a_normal, 0.0)).xyz;
    gl_Position = projectLab(world.xyz);
}
`;

export const fragment = /* glsl */ `
uniform vec4 u_color;         // rgb + opacity
uniform vec3 u_emissive;
uniform vec3 u_sunDirection;  // normalized, pointing toward the light
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
#ifdef RIM
uniform vec3 u_camPos;
uniform vec3 u_rimColor;
uniform float u_rimPower;
#endif

varying vec3 v_normal;
varying vec3 v_world;
#ifdef VERTEX_COLORS
varying vec4 v_color;
#endif
#ifdef INSTANCED
varying vec4 v_instanceColor;
#endif

void main() {
    vec4 base = u_color;
#ifdef VERTEX_COLORS
    base *= v_color;
#endif
#ifdef INSTANCED
    base *= v_instanceColor;
#endif
    vec3 rgb = base.rgb;
#ifdef LIT
    vec3 n = normalize(v_normal);
    // hemisphere ambient: blend ground -> sky by how much the normal faces up (world Z)
    vec3 ambient = mix(u_groundColor, u_skyColor, n.z * 0.5 + 0.5);
    float diffuse = max(dot(n, u_sunDirection), 0.0);
    rgb = rgb * (ambient + u_sunColor * diffuse);
#endif
#ifdef RIM
    // fresnel: strongest where the surface turns away from the viewer (the silhouette)
    vec3 viewDir = normalize(u_camPos - v_world);
    float fres = pow(1.0 - max(dot(normalize(v_normal), viewDir), 0.0), u_rimPower);
    rgb += u_rimColor * fres;
#endif
    gl_FragColor = vec4(rgb + u_emissive, base.a);
}
`;
