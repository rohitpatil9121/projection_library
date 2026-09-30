/**
 * GLSL chunk: projection_library's dot-product projection.
 * Include in any vertex shader and call projectLab(worldPosition).
 * Uniforms are filled by Camera.writeUniforms().
 * @module shaders/chunks/projection
 */
export const projection = /* glsl */ `
uniform vec3 u_camPos;      // eye
uniform vec3 u_camRight;    // screen-right (= -Space.getXaxisUnitVector)
uniform vec3 u_camUp;       // screen-up
uniform vec3 u_camForward;  // view direction
uniform vec4 u_proj;        // x: focal / aspect, y: focal, z: near, w: far

// Move a world point into camera space with three dot products, then let the GPU divide by depth
// through w. Depth is mapped to [-1, 1] between near and far like a standard perspective matrix,
// so the depth buffer and clipping behave normally (points behind the eye are clipped).
vec4 projectLab(vec3 world) {
    vec3 v = world - u_camPos;
    float x = dot(v, u_camRight);
    float y = dot(v, u_camUp);
    float z = dot(v, u_camForward);
    float n = u_proj.z;
    float f = u_proj.w;
    return vec4(x * u_proj.x, y * u_proj.y, z * (f + n) / (f - n) - 2.0 * f * n / (f - n), z);
}
`;
