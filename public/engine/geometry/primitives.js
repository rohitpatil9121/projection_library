import { Geometry, indexArray } from "../Geometry.js";

/**
 * Primitive shapes. World is Z-up, so "height" is along Z and planes lie in XY facing +Z.
 * All return indexed triangle geometry with normals and UVs, except grid/lines (line lists).
 * @module engine/geometry/primitives
 */

const TAU = Math.PI * 2;

function build(name, pos, nrm, uv, idx, mode = "triangles") {
    return new Geometry({
        name,
        positions: new Float32Array(pos),
        normals: nrm ? new Float32Array(nrm) : null,
        uvs: uv ? new Float32Array(uv) : null,
        indices: idx ? indexArray(idx, pos.length / 3) : null,
        mode,
    });
}

/** Axis-aligned box centred on the origin. 24 vertices (flat normals per face). */
export function box(width = 1, depth = 1, height = 1) {
    const hx = width / 2, hy = depth / 2, hz = height / 2;
    const pos = [], nrm = [], uv = [], idx = [];
    // each face: normal, then two in-plane axes (u, v) chosen so u × v = normal (counter-clockwise front)
    const faces = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
        [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, -1, 0]],
    ];
    const h = [hx, hy, hz];
    for (const [n, u, v] of faces) {
        const base = pos.length / 3;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            for (let k = 0; k < 3; k++) pos.push((n[k] + u[k] * a + v[k] * b) * h[k]);
            nrm.push(...n);
            uv.push((a + 1) / 2, (b + 1) / 2);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return build("box", pos, nrm, uv, idx);
}

/** UV sphere. */
export function sphere(radius = 0.5, widthSegments = 24, heightSegments = 16) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let y = 0; y <= heightSegments; y++) {
        const v = y / heightSegments, theta = v * Math.PI; // 0 at +Z (north pole)
        for (let x = 0; x <= widthSegments; x++) {
            const u = x / widthSegments, phi = u * TAU;
            const nx = Math.sin(theta) * Math.cos(phi), ny = Math.sin(theta) * Math.sin(phi), nz = Math.cos(theta);
            pos.push(nx * radius, ny * radius, nz * radius);
            nrm.push(nx, ny, nz);
            uv.push(u, 1 - v);
        }
    }
    const row = widthSegments + 1;
    for (let y = 0; y < heightSegments; y++) for (let x = 0; x < widthSegments; x++) {
        const a = y * row + x, b = a + row;
        if (y !== 0) idx.push(a, b, a + 1);
        if (y !== heightSegments - 1) idx.push(a + 1, b, b + 1);
    }
    return build("sphere", pos, nrm, uv, idx);
}

/** Flat plane in XY facing +Z. */
export function plane(width = 1, depth = 1, segX = 1, segY = 1) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let j = 0; j <= segY; j++) for (let i = 0; i <= segX; i++) {
        pos.push((i / segX - 0.5) * width, (j / segY - 0.5) * depth, 0);
        nrm.push(0, 0, 1);
        uv.push(i / segX, j / segY);
    }
    const row = segX + 1;
    for (let j = 0; j < segY; j++) for (let i = 0; i < segX; i++) {
        const a = j * row + i;
        idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
    return build("plane", pos, nrm, uv, idx);
}

/**
 * Cylinder / frustum along Z, base at z = -height/2. radiusTop = 0 makes a cone.
 * Side normals account for the slope so cones shade correctly.
 */
export function cylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, segments = 24, caps = true) {
    const pos = [], nrm = [], uv = [], idx = [];
    const hz = height / 2, slope = (radiusBottom - radiusTop) / height;
    for (let j = 0; j <= 1; j++) {
        const r = j ? radiusTop : radiusBottom, z = j ? hz : -hz;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * TAU, c = Math.cos(a), s = Math.sin(a);
            const nl = Math.hypot(1, slope);
            pos.push(c * r, s * r, z);
            nrm.push(c / nl, s / nl, slope / nl);
            uv.push(i / segments, j);
        }
    }
    const row = segments + 1;
    for (let i = 0; i < segments; i++) idx.push(i, i + 1, i + row + 1, i, i + row + 1, i + row);
    if (caps) for (const [r, z, nz] of [[radiusTop, hz, 1], [radiusBottom, -hz, -1]]) {
        if (r <= 0) continue;
        const centre = pos.length / 3;
        pos.push(0, 0, z); nrm.push(0, 0, nz); uv.push(0.5, 0.5);
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * TAU;
            pos.push(Math.cos(a) * r, Math.sin(a) * r, z); nrm.push(0, 0, nz); uv.push(0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2);
        }
        for (let i = 0; i < segments; i++) {
            if (nz > 0) idx.push(centre, centre + 1 + i, centre + 2 + i);
            else idx.push(centre, centre + 2 + i, centre + 1 + i);
        }
    }
    return build("cylinder", pos, nrm, uv, idx);
}

/** Cone along Z (apex at +height/2). */
export function cone(radius = 0.5, height = 1, segments = 24) {
    const g = cylinder(0, radius, height, segments, true);
    g.name = "cone";
    return g;
}

/** Torus in the XY plane: major radius R, tube radius r. */
export function torus(radius = 0.5, tube = 0.2, radialSegments = 16, tubularSegments = 48) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let j = 0; j <= radialSegments; j++) for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * TAU, v = (j / radialSegments) * TAU;
        const cx = Math.cos(u) * radius, cy = Math.sin(u) * radius;
        const x = (radius + tube * Math.cos(v)) * Math.cos(u), y = (radius + tube * Math.cos(v)) * Math.sin(u), z = tube * Math.sin(v);
        pos.push(x, y, z);
        const nl = Math.hypot(x - cx, y - cy, z) || 1;
        nrm.push((x - cx) / nl, (y - cy) / nl, z / nl);
        uv.push(i / tubularSegments, j / radialSegments);
    }
    const row = tubularSegments + 1;
    for (let j = 0; j < radialSegments; j++) for (let i = 0; i < tubularSegments; i++) {
        const a = j * row + i, b = a + row;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    return build("torus", pos, nrm, uv, idx);
}

/** Capsule along Z: a cylinder of `length` with hemispherical ends of `radius`. */
export function capsule(radius = 0.3, length = 1, capSegments = 8, radialSegments = 20) {
    const pos = [], nrm = [], uv = [], idx = [];
    const half = length / 2;
    // rows 0..capSegments: top hemisphere, latitude 90° -> 0° (centred at z = +half)
    // rows capSegments+1 .. 2·capSegments+1: bottom hemisphere, 0° -> -90° (centred at z = -half)
    // the duplicated equator ring between them forms the cylindrical middle
    const rows = 2 * (capSegments + 1);
    for (let j = 0; j < rows; j++) {
        const top = j <= capSegments;
        const k = top ? j : j - (capSegments + 1);
        const lat = top ? Math.PI / 2 - (k / capSegments) * (Math.PI / 2) : -(k / capSegments) * (Math.PI / 2);
        const zOff = top ? half : -half;
        for (let i = 0; i <= radialSegments; i++) {
            const a = (i / radialSegments) * TAU;
            const nx = Math.cos(lat) * Math.cos(a), ny = Math.cos(lat) * Math.sin(a), nz = Math.sin(lat);
            pos.push(nx * radius, ny * radius, nz * radius + zOff);
            nrm.push(nx, ny, nz);
            uv.push(i / radialSegments, 1 - j / (rows - 1));
        }
    }
    const row = radialSegments + 1;
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < radialSegments; i++) {
        const a = j * row + i, b = a + row;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return build("capsule", pos, nrm, uv, idx);
}

/** Square grid of lines in the XY plane (line list). */
export function grid(size = 10, divisions = 10) {
    const pos = [], h = size / 2, step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
        const t = -h + i * step;
        pos.push(-h, t, 0, h, t, 0, t, -h, 0, t, h, 0);
    }
    return build("grid", pos, null, null, null, "lines");
}

/** Line list from an array of [x, y, z] points; `strip: true` connects them in order. */
export function lines(points, strip = true) {
    const pos = [];
    if (strip) for (let i = 0; i < points.length - 1; i++) pos.push(...points[i], ...points[i + 1]);
    else for (const p of points) pos.push(...p);
    return build("lines", pos, null, null, null, "lines");
}
