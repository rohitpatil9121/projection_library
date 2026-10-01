import { LIGHTS } from "../../engine/config.js";

/**
 * GLSL chunk: the engine's lighting, for fragment shaders. Include it in any ShaderMaterial and the
 * Renderer fills every uniform from the Scene:
 *
 *   vec3 light = labLight(world, normal);          // ambient + sun (with shadow) + point lights
 *   vec3 color = labFog(albedo * light, world);    // distance fog
 *
 * The parts are also available on their own: labAmbient, labSun, labShadow, labPoints.
 * For a metallic / roughness surface use labLightPBR instead (it returns the finished colour):
 *
 *   vec3 color = labFog(labLightPBR(world, normal, albedo, metallic, roughness, 1.0), world);
 *
 * Shadows: the sun's view of the scene is rendered to a depth texture first (engine/ShadowMap). A point is
 * in shadow if something nearer to the sun was drawn at the same place in that texture. Nine neighbouring
 * texels are compared and averaged (percentage-closer filtering), which turns the hard stair-stepped edge
 * into a soft one. The lookup point is pushed along the surface normal so a surface doesn't shadow itself.
 *
 * Cascades: one box around a whole level spreads the texture thin. With cascades the camera's view is cut
 * into up to three slices by distance; each slice gets its own box and its own tile of the texture, so the
 * ground at your feet gets as many texels as the hills far away. The fragment picks its tile by how far it
 * is from the camera along the view direction.
 *
 * Physically based shading (labLightPBR): a surface is described by how metallic and how rough it is.
 * The highlight is the GGX microfacet model (Walter et al. 2007) with the height-correlated Smith
 * visibility term and Schlick's Fresnel approximation. Reflections of the surroundings use the scene's
 * sky and ground colours as a two-tone environment, weighted by the analytic environment-BRDF fit from
 * Brian Karis, "Physically Based Shading on Mobile" (2014). Published formulas; no code copied.
 * @module shaders/chunks/lighting
 */
export const lighting = /* glsl */ `
uniform vec3 u_camPos;
uniform vec3 u_camForward;
uniform vec3 u_sunDirection;    // normalized, pointing toward the sun
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;        // ambient from above
uniform vec3 u_groundColor;     // ambient from below
uniform vec4 u_pointPos[${LIGHTS.maxPoint}];    // xyz, radius
uniform vec3 u_pointColor[${LIGHTS.maxPoint}];
uniform float u_pointCount;
uniform vec4 u_fog;             // rgb, density
uniform sampler2D u_shadowMap;
uniform mat4 u_shadowMatrix[${LIGHTS.maxCascades}];   // world -> the sun's clip space, one per cascade
uniform vec4 u_shadowParams;    // x: strength (0 = off), y: 1 / tile size, w: cascades (0 = one fixed box)
// per cascade: x: camera depth where it ends, y: how far the lookup is pushed along the normal (world units), z: depth bias
uniform vec4 u_shadowCascade[${LIGHTS.maxCascades}];

vec3 labAmbient(vec3 n) {
    return mix(u_groundColor, u_skyColor, n.z * 0.5 + 0.5);
}

// 1 = fully lit by the sun, 0 = fully shadowed (before strength is applied)
float labShadow(vec3 world, vec3 n) {
    if (u_shadowParams.x <= 0.0) return 1.0;
    float cascades = u_shadowParams.w, tile = 0.0, fade = 0.0;
    mat4 m = u_shadowMatrix[0];
    vec4 c = u_shadowCascade[0];
    if (cascades > 0.5) {
        // which slice of the camera's view is this fragment in?
        float depth = dot(world - u_camPos, u_camForward);
        if (cascades > 1.5 && depth > u_shadowCascade[0].x) { tile = 1.0; m = u_shadowMatrix[1]; c = u_shadowCascade[1]; }
        if (cascades > 2.5 && depth > u_shadowCascade[1].x) { tile = 2.0; m = u_shadowMatrix[2]; c = u_shadowCascade[2]; }
        float last = cascades > 2.5 ? u_shadowCascade[2].x : (cascades > 1.5 ? u_shadowCascade[1].x : u_shadowCascade[0].x);
        fade = smoothstep(last * 0.85, last, depth);      // shadows thin out toward the end of the last cascade
        if (fade >= 1.0) return 1.0;
    }
    vec4 s = m * vec4(world + n * c.y, 1.0);
    vec3 p = s.xyz * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float texel = u_shadowParams.y, tiles = max(cascades, 1.0);
    if (cascades < 0.5) {
        // one fixed box: fade out toward its edge instead of ending in a line
        vec2 edge = abs(p.xy - 0.5) * 2.0;
        fade = smoothstep(0.88, 1.0, max(edge.x, edge.y));
    }
    // tiles sit side by side along x; keep the taps inside this fragment's own tile
    vec2 uv = vec2((clamp(p.x, 2.0 * texel, 1.0 - 2.0 * texel) + tile) / tiles, p.y);
    vec2 reach = vec2(texel / tiles, texel) * 1.4;
    float lit = 0.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            float nearest = texture2D(u_shadowMap, uv + vec2(float(x), float(y)) * reach).r;
            lit += step(p.z - c.z, nearest);
        }
    }
    lit /= 9.0;
    return mix(mix(1.0 - u_shadowParams.x, 1.0, lit), 1.0, fade);
}

vec3 labSun(vec3 world, vec3 n) {
    float facing = max(dot(n, u_sunDirection), 0.0);
    if (facing <= 0.0) return vec3(0.0);
    return u_sunColor * facing * labShadow(world, n);
}

// Point lights fall to zero at their radius, so far ones cost nothing visually.
vec3 labPoints(vec3 world, vec3 n) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${LIGHTS.maxPoint}; i++) {
        if (float(i) >= u_pointCount) break;
        vec3 d = u_pointPos[i].xyz - world;
        float d2 = dot(d, d), r = u_pointPos[i].w;
        float a = max(0.0, 1.0 - d2 / (r * r));
        float facing = max(dot(n, d * inversesqrt(d2 + 0.0001)), 0.0) * 0.8 + 0.2;   // wrapped, so backs aren't black
        sum += u_pointColor[i] * (a * a * facing);
    }
    return sum;
}

vec3 labLight(vec3 world, vec3 n) {
    return labAmbient(n) + labSun(world, n) + labPoints(world, n);
}

vec3 labFog(vec3 color, vec3 world) {
    if (u_fog.w <= 0.0) return color;
    return mix(u_fog.rgb, color, exp(-length(u_camPos - world) * u_fog.w));
}

// ---------------------------------------------------------------- physically based shading

// What one light contributes to a metallic / roughness surface: diffuse + GGX highlight, times N·L.
// Light colours in this engine are "what a white diffuse surface facing the light shows", so the diffuse
// term has no 1/π and the highlight is multiplied by π to stay in proportion.
vec3 labBRDF(vec3 n, vec3 v, vec3 l, vec3 diffuse, vec3 f0, float a2) {
    float nl = max(dot(n, l), 0.0);
    if (nl <= 0.0) return vec3(0.0);
    vec3 h = normalize(v + l);
    float nv = max(dot(n, v), 0.0001), nh = max(dot(n, h), 0.0), vh = max(dot(v, h), 0.0);
    float d = nh * nh * (a2 - 1.0) + 1.0;
    float distribution = a2 / (d * d);                                        // GGX, with its 1/π folded away
    float visibility = 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2) + 0.0001);
    vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
    // a mirror-smooth highlight is unboundedly bright; cap it so one pixel can't flood the bloom
    return (diffuse + fresnel * min(distribution * visibility, 24.0)) * nl;
}

// The surroundings as two tones: sky above, ground below. Rough surfaces see a blurrier horizon.
vec3 labEnvironment(vec3 dir, float roughness) {
    return mix(u_groundColor, u_skyColor, smoothstep(-0.04 - roughness, 0.04 + roughness, dir.z));
}

// How much of the environment a surface reflects at this angle and roughness (Karis 2014, analytic fit).
vec3 labEnvBRDF(vec3 f0, float roughness, float nv) {
    vec4 r = roughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
    float a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + ab.y;
}

// Finished surface colour (before fog) for a metallic / roughness material.
vec3 labLightPBR(vec3 world, vec3 n, vec3 albedo, float metallic, float roughness, float envIntensity) {
    vec3 v = normalize(u_camPos - world);
    float rough = clamp(roughness, 0.045, 1.0), a = rough * rough, a2 = a * a;
    // metals have no diffuse colour and tint their reflections; everything else reflects about 4 % white
    vec3 f0 = mix(vec3(0.04), albedo, metallic), diffuse = albedo * (1.0 - metallic);
    vec3 sum = diffuse * labAmbient(n);
    sum += labEnvironment(reflect(-v, n), rough) * labEnvBRDF(f0, rough, max(dot(n, v), 0.0)) * envIntensity;
    if (dot(n, u_sunDirection) > 0.0) sum += u_sunColor * labShadow(world, n) * labBRDF(n, v, u_sunDirection, diffuse, f0, a2);
    for (int i = 0; i < ${LIGHTS.maxPoint}; i++) {
        if (float(i) >= u_pointCount) break;
        vec3 d = u_pointPos[i].xyz - world;
        float d2 = dot(d, d), r = u_pointPos[i].w;
        float falloff = max(0.0, 1.0 - d2 / (r * r));
        if (falloff > 0.0) sum += u_pointColor[i] * (falloff * falloff) * labBRDF(n, v, d * inversesqrt(d2 + 0.0001), diffuse, f0, a2);
    }
    return sum;
}
`;
