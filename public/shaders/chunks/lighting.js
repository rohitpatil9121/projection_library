import { LIGHTS } from "../../engine/config.js";

/**
 * GLSL chunk: the engine's lighting, for fragment shaders. Include it in any ShaderMaterial and the
 * Renderer fills every uniform from the Scene:
 *
 *   vec3 light = labLight(world, normal);          // ambient + sun (with shadow) + point lights
 *   vec3 color = labFog(albedo * light, world);    // distance fog
 *
 * The parts are also available on their own: labAmbient, labSun, labShadow, labPoints.
 *
 * Shadows: the sun's view of the scene is rendered to a depth texture first (engine/ShadowMap). A point is
 * in shadow if something nearer to the sun was drawn at the same place in that texture. Nine neighbouring
 * texels are compared and averaged (percentage-closer filtering), which turns the hard stair-stepped edge
 * into a soft one. The lookup point is pushed along the surface normal so a surface doesn't shadow itself.
 * @module shaders/chunks/lighting
 */
export const lighting = /* glsl */ `
uniform vec3 u_camPos;
uniform vec3 u_sunDirection;    // normalized, pointing toward the sun
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;        // ambient from above
uniform vec3 u_groundColor;     // ambient from below
uniform vec4 u_pointPos[${LIGHTS.maxPoint}];    // xyz, radius
uniform vec3 u_pointColor[${LIGHTS.maxPoint}];
uniform float u_pointCount;
uniform vec4 u_fog;             // rgb, density
uniform sampler2D u_shadowMap;
uniform mat4 u_shadowMatrix;    // world -> the sun's clip space
uniform vec4 u_shadowParams;    // x: strength (0 = off), y: 1 / map size, z: depth bias, w: normal offset

vec3 labAmbient(vec3 n) {
    return mix(u_groundColor, u_skyColor, n.z * 0.5 + 0.5);
}

// 1 = fully lit by the sun, 0 = fully shadowed (before strength is applied)
float labShadow(vec3 world, vec3 n) {
    if (u_shadowParams.x <= 0.0) return 1.0;
    vec4 s = u_shadowMatrix * vec4(world + n * u_shadowParams.w, 1.0);
    vec3 p = s.xyz * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float lit = 0.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            float nearest = texture2D(u_shadowMap, p.xy + vec2(float(x), float(y)) * u_shadowParams.y * 1.4).r;
            lit += step(p.z - u_shadowParams.z, nearest);
        }
    }
    lit /= 9.0;
    // fade out toward the edge of the shadowed area instead of ending in a line
    vec2 edge = abs(p.xy - 0.5) * 2.0;
    float fade = smoothstep(0.88, 1.0, max(edge.x, edge.y));
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
`;
