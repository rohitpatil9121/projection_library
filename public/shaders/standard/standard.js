import { projection } from "../chunks/projection.js";
import { lighting } from "../chunks/lighting.js";
import { SKIN } from "../../engine/config.js";

/**
 * Standard material shader: the engine's full lighting (hemisphere ambient, sun with shadows, point lights,
 * fog) on a surface that can be textured, vertex-coloured, instanced and skinned.
 *
 * Variants via defines: MAP, VERTEX_COLORS, PALETTE, INSTANCED, SKINNED, UNLIT, RIM, ALPHA_TEST.
 *
 * Skinning: each vertex names up to four joints and a weight for each. Its position is the weighted
 * blend of where each joint's matrix would put it, so a vertex near an elbow follows both arm bones and
 * the surface bends smoothly instead of breaking.
 *
 * Palette: instead of a colour, a vertex can carry an index (in a_color.r) into a small colour table that
 * is a uniform. Many characters then share one mesh and one program and differ only in that table.
 *
 * Self-illumination: a vertex colour alpha above 1 glows by itself (1 = ordinary surface, 2 = fully
 * self-lit), so signs and lanterns can live in the same mesh as the walls around them.
 * @module shaders/standard
 */
export const PALETTE_SIZE = 8;

export const vertex = /* glsl */ `
${projection}
attribute vec3 a_position;
attribute vec3 a_normal;
#ifdef MAP
attribute vec2 a_uv;
varying vec2 v_uv;
#endif
#if defined(VERTEX_COLORS) || defined(PALETTE)
attribute vec4 a_color;
#endif
#ifdef PALETTE
uniform vec3 u_palette[${PALETTE_SIZE}];
#endif
#ifdef INSTANCED
attribute mat4 a_instanceMatrix;
attribute vec4 a_instanceColor;
#endif
#ifdef SKINNED
attribute vec4 a_joints;
attribute vec4 a_weights;
uniform mat4 u_joints[${SKIN.maxJoints}];
#endif

uniform mat4 u_model;
uniform mat3 u_normalMatrix;
varying vec3 v_normal;
varying vec3 v_world;
varying vec4 v_tint;        // rgb multiplies the base colour, a: 1 = ordinary, up to 2 = self-lit

void main() {
    vec4 local = vec4(a_position, 1.0);
    vec3 normal = a_normal;
#ifdef SKINNED
    mat4 skin = a_weights.x * u_joints[int(a_joints.x)] + a_weights.y * u_joints[int(a_joints.y)]
              + a_weights.z * u_joints[int(a_joints.z)] + a_weights.w * u_joints[int(a_joints.w)];
    local = skin * local;
    normal = (skin * vec4(normal, 0.0)).xyz;
#endif
    v_tint = vec4(1.0);
#ifdef VERTEX_COLORS
    v_tint = a_color;
#endif
#ifdef PALETTE
    v_tint = vec4(u_palette[int(a_color.r + 0.5)], a_color.a);
#endif
#ifdef INSTANCED
    mat4 model = u_model * a_instanceMatrix;
    v_tint *= a_instanceColor;
    v_normal = (model * vec4(normal, 0.0)).xyz;
#else
    mat4 model = u_model;
    v_normal = u_normalMatrix * normal;     // inverse-transpose: correct under non-uniform scale
#endif
    vec4 world = model * local;
    v_world = world.xyz;
#ifdef MAP
    v_uv = a_uv;
#endif
    gl_Position = projectLab(world.xyz);
}
`;

export const fragment = /* glsl */ `
${lighting}
uniform vec4 u_color;           // rgb + opacity
uniform vec3 u_emissive;
uniform float u_specular;       // strength of the sun's highlight
uniform float u_shininess;
#ifdef MAP
uniform sampler2D u_map;
varying vec2 v_uv;
#endif
#ifdef RIM
uniform vec3 u_rimColor;
uniform float u_rimPower;
#endif
#ifdef ALPHA_TEST
uniform float u_alphaTest;
#endif
varying vec3 v_normal;
varying vec3 v_world;
varying vec4 v_tint;

void main() {
    vec4 base = u_color;
#ifdef MAP
    base *= texture2D(u_map, v_uv);
#endif
    base.rgb *= v_tint.rgb;
#ifdef ALPHA_TEST
    if (base.a < u_alphaTest) discard;
#endif
    float glow = clamp(v_tint.a - 1.0, 0.0, 1.0);
    vec3 n = normalize(v_normal);
    if (!gl_FrontFacing) n = -n;
#ifdef UNLIT
    vec3 rgb = base.rgb;
#else
    vec3 rgb = base.rgb * labLight(v_world, n);
    if (u_specular > 0.0) {
        vec3 view = normalize(u_camPos - v_world);
        vec3 halfway = normalize(view + u_sunDirection);
        rgb += u_sunColor * pow(max(dot(n, halfway), 0.0), u_shininess) * u_specular * labShadow(v_world, n);
    }
#endif
#ifdef RIM
    float fres = pow(1.0 - max(dot(n, normalize(u_camPos - v_world)), 0.0), u_rimPower);
    rgb += u_rimColor * fres;
#endif
    rgb = labFog(rgb, v_world);
    // self-lit parts ignore lighting and fog, and may exceed 1 so bloom picks them up
    rgb = mix(rgb, base.rgb, glow) + u_emissive;
    gl_FragColor = vec4(rgb, base.a);
}
`;

/**
 * Depth-only shader for the shadow pass: where is each surface as seen from the sun?
 * It uses an ordinary matrix (the sun has no perspective), not the dot-product projection.
 * Variants: INSTANCED, SKINNED.
 */
export const depthVertex = /* glsl */ `
attribute vec3 a_position;
#ifdef INSTANCED
attribute mat4 a_instanceMatrix;
#endif
#ifdef SKINNED
attribute vec4 a_joints;
attribute vec4 a_weights;
uniform mat4 u_joints[${SKIN.maxJoints}];
#endif
uniform mat4 u_model;
uniform mat4 u_shadowMatrix;
void main() {
    vec4 local = vec4(a_position, 1.0);
#ifdef SKINNED
    mat4 skin = a_weights.x * u_joints[int(a_joints.x)] + a_weights.y * u_joints[int(a_joints.y)]
              + a_weights.z * u_joints[int(a_joints.z)] + a_weights.w * u_joints[int(a_joints.w)];
    local = skin * local;
#endif
#ifdef INSTANCED
    gl_Position = u_shadowMatrix * u_model * a_instanceMatrix * local;
#else
    gl_Position = u_shadowMatrix * u_model * local;
#endif
}
`;

export const depthFragment = /* glsl */ `
void main() { gl_FragColor = vec4(1.0); }
`;
