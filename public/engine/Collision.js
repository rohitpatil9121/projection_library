import { mat4 } from "./vendor.js";

/**
 * Collision: ray casts and overlap tests. Plain functions over plain arrays, no state.
 *
 *   // what is under the mouse?
 *   const ray = camera.screenRay(input.pointer.x, input.pointer.y, canvas.clientWidth, canvas.clientHeight);
 *   const hit = raycast(scene.root, ray)[0];           // nearest first; hit.entity, hit.distance, hit.point
 *
 *   // keep a player (a circle on the ground) out of the walls
 *   slideCircle(player.position, 0.4, wallBoxes);
 *
 * Every ray function returns the distance along the ray to the hit, or -1 for a miss. `direction` should
 * be normalized so that distance is in world units. Boxes are axis-aligned: a `min` and a `max` corner.
 * @module engine/Collision
 */

/** @typedef {{ origin: ArrayLike<number>, direction: ArrayLike<number> }} Ray */

/** Distance along the ray to a sphere, or -1. A ray starting inside hits at 0. */
export function raySphere(origin, direction, center, radius) {
    const ox = origin[0] - center[0], oy = origin[1] - center[1], oz = origin[2] - center[2];
    const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    if (c <= 0) return 0;
    const disc = b * b - c;
    if (disc < 0 || b > 0) return -1;
    return -b - Math.sqrt(disc);
}

/** Distance along the ray to an axis-aligned box, or -1 (the "slab" method: clip the ray against each pair of faces). */
export function rayAABB(origin, direction, min, max) {
    let near = 0, far = Infinity;
    for (let k = 0; k < 3; k++) {
        if (Math.abs(direction[k]) < 1e-12) {
            if (origin[k] < min[k] || origin[k] > max[k]) return -1;
            continue;
        }
        let a = (min[k] - origin[k]) / direction[k], b = (max[k] - origin[k]) / direction[k];
        if (a > b) { const t = a; a = b; b = t; }
        if (a > near) near = a;
        if (b < far) far = b;
        if (near > far) return -1;
    }
    return near;
}

/** Distance along the ray to a plane through `point` with normal `normal`, or -1 (parallel, or behind the origin). */
export function rayPlane(origin, direction, point, normal) {
    const denom = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2];
    if (Math.abs(denom) < 1e-12) return -1;
    const t = ((point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1] + (point[2] - origin[2]) * normal[2]) / denom;
    return t >= 0 ? t : -1;
}

/**
 * Distance along the ray to a triangle, or -1 (Möller and Trumbore, 1997: solve for the hit point as a
 * mix of the triangle's corners and reject it if any share is negative).
 */
export function rayTriangle(origin, direction, a, b, c, ao = 0, bo = 0, co = 0) {
    const e1x = b[bo] - a[ao], e1y = b[bo + 1] - a[ao + 1], e1z = b[bo + 2] - a[ao + 2];
    const e2x = c[co] - a[ao], e2y = c[co + 1] - a[ao + 1], e2z = c[co + 2] - a[ao + 2];
    const px = direction[1] * e2z - direction[2] * e2y, py = direction[2] * e2x - direction[0] * e2z, pz = direction[0] * e2y - direction[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det, tx = origin[0] - a[ao], ty = origin[1] - a[ao + 1], tz = origin[2] - a[ao + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t >= 0 ? t : -1;
}

export function sphereSphere(centerA, radiusA, centerB, radiusB) {
    const r = radiusA + radiusB;
    return (centerA[0] - centerB[0]) ** 2 + (centerA[1] - centerB[1]) ** 2 + (centerA[2] - centerB[2]) ** 2 <= r * r;
}

export function aabbAABB(minA, maxA, minB, maxB) {
    return minA[0] <= maxB[0] && maxA[0] >= minB[0] && minA[1] <= maxB[1] && maxA[1] >= minB[1] && minA[2] <= maxB[2] && maxA[2] >= minB[2];
}

/**
 * Does a sphere touch a box? If so, returns how to move the sphere out: a unit direction and a depth.
 * @returns {{ x: number, y: number, z: number, depth: number } | null}
 */
export function sphereAABB(center, radius, min, max, out = { x: 0, y: 0, z: 0, depth: 0 }) {
    // closest point on the box to the sphere's centre
    const cx = Math.max(min[0], Math.min(max[0], center[0])), cy = Math.max(min[1], Math.min(max[1], center[1])), cz = Math.max(min[2], Math.min(max[2], center[2]));
    const dx = center[0] - cx, dy = center[1] - cy, dz = center[2] - cz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > radius * radius) return null;
    if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        out.x = dx / d; out.y = dy / d; out.z = dz / d; out.depth = radius - d;
        return out;
    }
    // the centre is inside the box: leave through the nearest face
    let best = Infinity;
    for (let k = 0; k < 3; k++) for (const sign of [-1, 1]) {
        const d = sign < 0 ? center[k] - min[k] : max[k] - center[k];
        if (d < best) { best = d; out.x = k === 0 ? sign : 0; out.y = k === 1 ? sign : 0; out.z = k === 2 ? sign : 0; }
    }
    out.depth = best + radius;
    return out;
}

/**
 * Push a circle on the ground (XY) out of a list of boxes, in place, so it slides along walls instead of
 * stopping dead. Boxes are `{ min, max }`; only their X and Y are used. Returns true if it touched any.
 * @param {{ 0: number, 1: number }} position edited in place
 * @param {number} radius
 * @param {Array<{ min: ArrayLike<number>, max: ArrayLike<number> }>} boxes
 */
export function slideCircle(position, radius, boxes) {
    let touched = false;
    // two rounds: leaving one wall can push into the next at a corner
    for (let pass = 0; pass < 2; pass++) for (const b of boxes) {
        const cx = Math.max(b.min[0], Math.min(b.max[0], position[0])), cy = Math.max(b.min[1], Math.min(b.max[1], position[1]));
        const dx = position[0] - cx, dy = position[1] - cy, d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        touched = true;
        if (d2 > 1e-12) {
            const d = Math.sqrt(d2), push = (radius - d) / d;
            position[0] += dx * push; position[1] += dy * push;
        } else {
            // inside the box: leave through the nearest side
            const left = position[0] - b.min[0], right = b.max[0] - position[0], down = position[1] - b.min[1], up = b.max[1] - position[1];
            const m = Math.min(left, right, down, up);
            if (m === left) position[0] = b.min[0] - radius; else if (m === right) position[0] = b.max[0] + radius;
            else if (m === down) position[1] = b.min[1] - radius; else position[1] = b.max[1] + radius;
        }
    }
    return touched;
}

const inverse = mat4.create(), localOrigin = [0, 0, 0], localDirection = [0, 0, 0], centre = [0, 0, 0];

/**
 * Cast a ray through an entity tree. Each mesh is tested by its bounding sphere first, then triangle by
 * triangle (set `precise: false` to stop at the sphere). Instanced and skinned meshes are skipped: test
 * those against your own shapes.
 * Call after the scene has rendered once (it uses the entities' world matrices).
 * @param {import("./Entity.js").Entity} root for a Scene, pass `scene.root` (or use `scene.raycast`)
 * @param {Ray} ray
 * @param {{ precise?: boolean, maxDistance?: number, filter?: (e: import("./Entity.js").Entity) => boolean }} [options]
 * @returns {Array<{ entity: import("./Entity.js").Entity, distance: number, point: number[] }>} nearest first
 */
export function raycast(root, ray, options = {}) {
    const hits = [], o = ray.origin, d = ray.direction, max = options.maxDistance ?? Infinity, precise = options.precise ?? true;
    const visit = (node) => {
        if (node.visible === false) return;
        const mesh = node.mesh;
        if (mesh && !mesh.isInstanced && !mesh.isSkinned && mesh.geometry.mode === "triangles" && (!options.filter || options.filter(node))) {
            const geo = mesh.geometry.freshBounds(), m = node.worldMatrix, c = geo.boundsCenter;
            centre[0] = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
            centre[1] = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
            centre[2] = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
            const scale = Math.sqrt(Math.max(m[0] * m[0] + m[1] * m[1] + m[2] * m[2], m[4] * m[4] + m[5] * m[5] + m[6] * m[6], m[8] * m[8] + m[9] * m[9] + m[10] * m[10]));
            let t = raySphere(o, d, centre, geo.boundingRadius * scale);
            if (t >= 0 && t <= max && precise) {
                // move the ray into the mesh's own space instead of moving every triangle into the world;
                // the direction is not re-normalized, so distances along it stay in world units
                t = -1;
                if (mat4.invert(inverse, m)) {
                    const i = inverse;
                    localOrigin[0] = i[0] * o[0] + i[4] * o[1] + i[8] * o[2] + i[12];
                    localOrigin[1] = i[1] * o[0] + i[5] * o[1] + i[9] * o[2] + i[13];
                    localOrigin[2] = i[2] * o[0] + i[6] * o[1] + i[10] * o[2] + i[14];
                    localDirection[0] = i[0] * d[0] + i[4] * d[1] + i[8] * d[2];
                    localDirection[1] = i[1] * d[0] + i[5] * d[1] + i[9] * d[2];
                    localDirection[2] = i[2] * d[0] + i[6] * d[1] + i[10] * d[2];
                    const P = geo.positions, I = geo.indices, n = geo.drawCount;
                    for (let k = 0; k + 2 < n; k += 3) {
                        const a = (I ? I[k] : k) * 3, b = (I ? I[k + 1] : k + 1) * 3, cc = (I ? I[k + 2] : k + 2) * 3;
                        const hit = rayTriangle(localOrigin, localDirection, P, P, P, a, b, cc);
                        if (hit >= 0 && (t < 0 || hit < t)) t = hit;
                    }
                }
            }
            if (t >= 0 && t <= max) hits.push({ entity: node, distance: t, point: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] });
        }
        for (const child of node.children) visit(child);
    };
    visit(root);
    return hits.sort((a, b) => a.distance - b.distance);
}
