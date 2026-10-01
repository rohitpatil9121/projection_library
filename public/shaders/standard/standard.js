import { projection } from "../chunks/projection.js";
import { lighting } from "../chunks/lighting.js";
import { SKIN } from "../../engine/config.js";

/**
 * Standard material shader: the engine's full lighting (hemisphere ambient, sun with shadows, point lights,
 * fog) on a surface that can be textured, vertex-coloured, instanced and skinned.
 *
 * Variants via defines: UV (any texture), MAP, NORMAL_MAP, EMISSIVE_MAP, PBR, MR_MAP, VERTEX_COLORS, PALETTE,
 * INSTANCED, SKINNED, JOINT_TEXTURE, UNLIT, RIM, ALPHA_TEST.
 *
 * Skinning: each vertex names up to four joints and a weight for each. Its position is the weighted
 * blend of where each joint's matrix would put it, so a vertex near an elbow follows both arm bones and
 * the surface bends smoothly instead of breaking. Small skeletons send their matrices as a uniform array;
 * with JOINT_TEXTURE they are read from a float texture (four texels per joint), which has no such limit.
 *
 * Palette: instead of a colour, a vertex can carry an index (in a_color.r) into a small colour table that
 * is a uniform. Many characters then share one mesh and one program and differ only in that table.
 *
 * Self-illumination: a vertex colour alpha above 1 glows by itself (1 = ordinary surface, 2 = fully
 * self-lit), so signs and lanterns can live in the same mesh as the walls around them.
 *
 * Normal map: a texture whose colour is a direction, which tilts the surface normal per pixel so a flat
 * wall shades as if it had bricks. The directions are relative to the surface (its tangent, bitangent and
 * normal), which is why the mesh needs tangents (Geometry.computeTangents).
 *
 * PBR: lights the surface from metallic and roughness instead of specular and shininess (see
 * shaders/chunks/lighting.js, labLightPBR).
 * @module shaders/standard
 */
export const PALETTE_SIZE = 8;

/** GLSL chunk: labJoint(index) returns one skinning matrix, from the uniform array or the joint texture. */
export const skinning = /* glsl */ `
attribute vec4 a_joints;
attribute vec4 a_weights;
#ifdef JOINT_TEXTURE
uniform highp sampler2D u_jointTexture;
uniform float u_jointTextureWidth;      // in texels: four per joint
mat4 labJoint(float j) {
    float x = j * 4.0 + 0.5;
    return mat4(texture2D(u_jointTexture, vec2(x / u_jointTextureWidth, 0.5)),
                texture2D(u_jointTexture, vec2((x + 1.0) / u_jointTextureWidth, 0.5)),
                texture2D(u_jointTexture, vec2((x + 2.0) / u_jointTextureWidth, 0.5)),
                texture2D(u_jointTexture, vec2((x + 3.0) / u_jointTextureWidth, 0.5)));
}
#else
uniform mat4 u_joints[${SKIN.maxJoints}];
mat4 labJoint(float j) { return u_joints[int(j)]; }
#endif
mat4 labSkin() {
    return a_weights.x * labJoint(a_joints.x) + a_weights.y * labJoint(a_joints.y)
         + a_weights.z * labJoint(a_joints.z) + a_weights.w * labJoint(a_joints.w);
}
`;

export const vertex = /* glsl */ `
${projection}
attribute vec3 a_position;
attribute vec3 a_normal;
#ifdef UV
attribute vec2 a_uv;
varying vec2 v_uv;
#endif
#ifdef NORMAL_MAP
attribute vec4 a_tangent;
varying vec4 v_tangent;
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
${skinning}
#endif

uniform mat4 u_model;
uniform mat3 u_normalMatrix;
varying vec3 v_normal;
varying vec3 v_world;
varying vec4 v_tint;        // rgb multiplies the base colour, a: 1 = ordinary, up to 2 = self-lit

void main() {
    vec4 local = vec4(a_position, 1.0);
    vec3 normal = a_normal;
#ifdef NORMAL_MAP
    vec3 tangent = a_tangent.xyz;
#endif
#ifdef SKINNED
    mat4 skin = labSkin();
    local = skin * local;
    normal = (skin * vec4(normal, 0.0)).xyz;
#ifdef NORMAL_MAP
    tangent = (skin * vec4(tangent, 0.0)).xyz;
#endif
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
    // Normals need the inverse-transpose. For a matrix that only rotates and scales (no shear) that is each
    // axis divided by its squared length, so stretched instances shade correctly without a matrix inverse.
    vec3 ax = model[0].xyz, ay = model[1].xyz, az = model[2].xyz;
    v_normal = ax * (normal.x / max(dot(ax, ax), 1e-12)) + ay * (normal.y / max(dot(ay, ay), 1e-12)) + az * (normal.z / max(dot(az, az), 1e-12));
#else
    mat4 model = u_model;
    v_normal = u_normalMatrix * normal;     // inverse-transpose: correct under non-uniform scale
#endif
    vec4 world = model * local;
    v_world = world.xyz;
#ifdef UV
    v_uv = a_uv;
#endif
#ifdef NORMAL_MAP
    v_tangent = vec4((model * vec4(tangent, 0.0)).xyz, a_tangent.w);
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
#ifdef UV
varying vec2 v_uv;
#endif
#ifdef MAP
uniform sampler2D u_map;
#endif
#ifdef NORMAL_MAP
uniform sampler2D u_normalMap;
uniform float u_normalScale;
varying vec4 v_tangent;
#endif
#ifdef EMISSIVE_MAP
uniform sampler2D u_emissiveMap;
#endif
#ifdef PBR
uniform float u_metallic;
uniform float u_roughness;
uniform float u_envIntensity;
#ifdef MR_MAP
uniform sampler2D u_metallicRoughnessMap;   // green: roughness, blue: metallic (the glTF layout)
#endif
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
#ifdef NORMAL_MAP
    // tangent made perpendicular to the (interpolated) normal, bitangent from the two, then the map's
    // direction is read in that frame
    vec3 t = v_tangent.xyz - n * dot(n, v_tangent.xyz);
    if (dot(t, t) > 1e-10) {
        t = normalize(t);
        vec3 b = cross(n, t) * v_tangent.w;
        vec3 bump = texture2D(u_normalMap, v_uv).xyz * 2.0 - 1.0;
        bump.xy *= u_normalScale;
        n = normalize(t * bump.x + b * bump.y + n * bump.z);
    }
#endif
#ifdef UNLIT
    vec3 rgb = base.rgb;
#else
#ifdef PBR
    float metallic = u_metallic, roughness = u_roughness;
#ifdef MR_MAP
    vec4 mr = texture2D(u_metallicRoughnessMap, v_uv);
    roughness *= mr.g; metallic *= mr.b;
#endif
    vec3 rgb = labLightPBR(v_world, n, base.rgb, metallic, roughness, u_envIntensity);
#else
    vec3 rgb = base.rgb * labLight(v_world, n);
    if (u_specular > 0.0) {
        vec3 view = normalize(u_camPos - v_world);
        vec3 halfway = normalize(view + u_sunDirection);
        rgb += u_sunColor * pow(max(dot(n, halfway), 0.0), u_shininess) * u_specular * labShadow(v_world, n);
    }
#endif
#endif
#ifdef RIM
    float fres = pow(1.0 - max(dot(n, normalize(u_camPos - v_world)), 0.0), u_rimPower);
    rgb += u_rimColor * fres;
#endif
    rgb = labFog(rgb, v_world);
    vec3 emissive = u_emissive;
#ifdef EMISSIVE_MAP
    emissive *= texture2D(u_emissiveMap, v_uv).rgb;
#endif
    // self-lit parts ignore lighting and fog, and may exceed 1 so bloom picks them up
    rgb = mix(rgb, base.rgb, glow) + emissive;
    gl_FragColor = vec4(rgb, base.a);
}
`;

/**
 * Depth-only shader for the shadow pass: where is each surface as seen from the sun?
 * It uses an ordinary matrix (the sun has no perspective), not the dot-product projection.
 * Variants: INSTANCED, SKINNED, JOINT_TEXTURE.
 */
export const depthVertex = /* glsl */ `
attribute vec3 a_position;
#ifdef INSTANCED
attribute mat4 a_instanceMatrix;
#endif
#ifdef SKINNED
${skinning}
#endif
uniform mat4 u_model;
uniform mat4 u_shadowMatrix;
void main() {
    vec4 local = vec4(a_position, 1.0);
#ifdef SKINNED
    local = labSkin() * local;
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
