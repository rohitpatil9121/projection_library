import { ATTRIB } from "./config.js";

/**
 * Vertex data + its GPU buffers.
 *
 * Attributes are typed arrays (positions and normals: 3 floats, uvs: 2, colors: 4). Indices are optional.
 * Buffers are created lazily on first use by a Renderer, per GL context, and uploaded once. Call
 * `markDirty()` after editing arrays in place to re-upload.
 * @module engine/Geometry
 */
export class Geometry {
    /**
     * @param {{ positions: Float32Array, normals?: Float32Array, uvs?: Float32Array, colors?: Float32Array,
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
        if (this.indices) {
            if (!g.index) g.index = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.index);
            if (upload) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
            this.indexType = this.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        }
        g.version = this.version;
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
