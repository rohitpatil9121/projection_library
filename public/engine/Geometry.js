import { ATTRIB } from "./config.js";

/**
 * Vertex data + its GPU buffers.
 *
 * Attributes are typed arrays (positions and normals: 3 floats, uvs: 2, colors: 4). Indices are optional.
 * Skinned geometry also carries joints and weights (4 floats each: which joints move a vertex, and how much).
 * Buffers are created lazily on first use by a Renderer, per GL context, and uploaded once. Call
 * `markDirty()` after editing arrays in place to re-upload.
 * @module engine/Geometry
 */
export class Geometry {
    /**
     * @param {{ positions: Float32Array, normals?: Float32Array, uvs?: Float32Array, colors?: Float32Array,
     *           joints?: Float32Array, weights?: Float32Array,
     *           indices?: Uint16Array | Uint32Array, mode?: "triangles" | "lines" | "lineStrip" | "points",
     *           dynamic?: boolean, name?: string }} data
     *        dynamic: the arrays are rewritten often (particles, trails); uses DYNAMIC_DRAW and bufferSubData.
     */
    constructor(data) {
        this.name = data.name || "geometry";
        this.positions = data.positions;
        this.normals = data.normals || null;
        this.uvs = data.uvs || null;
        this.colors = data.colors || null;
        this.joints = data.joints || null;
        this.weights = data.weights || null;
        this.indices = data.indices || null;
        /** @type {"triangles" | "lines" | "lineStrip" | "points"} */
        this.mode = data.mode || "triangles";
        this.dynamic = data.dynamic ?? false;
        this.vertexCount = this.positions.length / 3;
        /** how many vertices (or indices) to draw; lower it to draw only the live part of a dynamic buffer */
        this.drawCount = this.indices ? this.indices.length : this.vertexCount;
        this.version = 0;
        /** per-context GPU state */
        this._gpu = new WeakMap();
        this.computeBounds();
    }

    computeBounds() {
        const p = this.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
            if (p[i + k] < min[k]) min[k] = p[i + k];
            if (p[i + k] > max[k]) max[k] = p[i + k];
        }
        this.boundsMin = min;
        this.boundsMax = max;
        this.boundingRadius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    }

    /** Re-upload all attribute data on next draw (after editing arrays in place). */
    markDirty() { this.version++; }

    /**
     * Create/refresh GPU buffers for a context and point the fixed attribute slots at them.
     * Called by Mesh while its VAO is bound.
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     */
    bind(gl) {
        let g = this._gpu.get(gl);
        if (!g) {
            g = { buffers: {}, index: null, version: -1 };
            this._gpu.set(gl, g);
        }
        const upload = g.version !== this.version;
        const usage = this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
        const attr = (key, data, size, loc) => {
            if (!data) { gl.disableVertexAttribArray(loc); return; }
            const fresh = !g.buffers[key];
            if (fresh) g.buffers[key] = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, g.buffers[key]);
            // dynamic buffers keep their allocation and only rewrite contents
            if (upload) {
                if (this.dynamic && !fresh) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
                else gl.bufferData(gl.ARRAY_BUFFER, data, usage);
            }
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        };
        attr("position", this.positions, 3, ATTRIB.position);
        attr("normal", this.normals, 3, ATTRIB.normal);
        attr("uv", this.uvs, 2, ATTRIB.uv);
        attr("color", this.colors, 4, ATTRIB.color);
        if (this.joints || this.weights) {
            attr("joints", this.joints, 4, ATTRIB.joints);
            attr("weights", this.weights, 4, ATTRIB.weights);
        }
        if (this.indices) {
            if (!g.index) g.index = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.index);
            if (upload) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
            this.indexType = this.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        }
        g.version = this.version;
    }

    /**
     * Join several geometries into one, so a whole static scene is a single draw call (and a single shadow
     * draw). Each part may carry a model matrix and a colour: the colour multiplies the part's own vertex
     * colours (or becomes its colour if it has none; alpha defaults to 1).
     * Parts must be triangle lists. Normals are transformed with the matrix (uniform scale assumed).
     * @param {Array<{ geometry: Geometry, matrix?: ArrayLike<number>, color?: ArrayLike<number> }>} parts
     * @param {{ name?: string, uvs?: boolean, skin?: boolean }} [options] skin: keep joints and weights
     */
    static merge(parts, options = {}) {
        let vertices = 0, indexCount = 0;
        for (const p of parts) { vertices += p.geometry.vertexCount; indexCount += p.geometry.indices ? p.geometry.indices.length : p.geometry.vertexCount; }
        const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 4);
        const wantUV = options.uvs ?? parts.some((p) => p.geometry.uvs), uvs = wantUV ? new Float32Array(vertices * 2) : null;
        const joints = options.skin ? new Float32Array(vertices * 4) : null, weights = options.skin ? new Float32Array(vertices * 4) : null;
        const indices = indexArray(new Array(indexCount), vertices);
        let v = 0, k = 0;
        for (const part of parts) {
            const g = part.geometry, m = part.matrix, c = part.color, n = g.vertexCount;
            const P = g.positions, N = g.normals;
            for (let i = 0; i < n; i++) {
                const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], o = (v + i) * 3;
                if (m) {
                    positions[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
                    positions[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
                    positions[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
                } else { positions[o] = x; positions[o + 1] = y; positions[o + 2] = z; }
                if (N) {
                    let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
                    if (m) {
                        const a = m[0] * nx + m[4] * ny + m[8] * nz, b = m[1] * nx + m[5] * ny + m[9] * nz, d = m[2] * nx + m[6] * ny + m[10] * nz;
                        const l = Math.hypot(a, b, d) || 1;
                        nx = a / l; ny = b / l; nz = d / l;
                    }
                    normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;
                }
                const q = (v + i) * 4;
                if (g.colors) { colors[q] = g.colors[i * 4]; colors[q + 1] = g.colors[i * 4 + 1]; colors[q + 2] = g.colors[i * 4 + 2]; colors[q + 3] = g.colors[i * 4 + 3]; }
                else { colors[q] = colors[q + 1] = colors[q + 2] = 1; colors[q + 3] = 1; }
                if (c) { colors[q] *= c[0]; colors[q + 1] *= c[1]; colors[q + 2] *= c[2]; if (c.length > 3) colors[q + 3] *= c[3]; }
            }
            if (uvs && g.uvs) uvs.set(g.uvs, v * 2);
            if (joints && g.joints) { joints.set(g.joints, v * 4); weights.set(g.weights, v * 4); }
            if (g.indices) for (let i = 0; i < g.indices.length; i++) indices[k++] = g.indices[i] + v;
            else for (let i = 0; i < n; i++) indices[k++] = v + i;
            v += n;
        }
        return new Geometry({ name: options.name || "merged", positions, normals, colors, uvs, joints, weights, indices });
    }

    /** @param {WebGLRenderingContext | WebGL2RenderingContext} gl */
    dispose(gl) {
        const g = this._gpu.get(gl);
        if (!g) return;
        for (const k in g.buffers) gl.deleteBuffer(g.buffers[k]);
        if (g.index) gl.deleteBuffer(g.index);
        this._gpu.delete(gl);
    }
}

/** Pick the smallest index type that fits. */
export function indexArray(list, vertexCount) {
    return vertexCount > 65535 ? new Uint32Array(list) : new Uint16Array(list);
}
