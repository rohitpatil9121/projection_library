import { ATTRIB } from "./config.js";

/**
 * Mesh: geometry + material, with one vertex array object (VAO) per GL context.
 * InstancedMesh: draws the same geometry many times in one draw call with per-instance matrix + colour.
 * @module engine/Mesh
 */
export class Mesh {
    /**
     * @param {import("./Geometry.js").Geometry} geometry
     * @param {import("./Material.js").Material} material
     */
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.isInstanced = false;
        this._vaos = new WeakMap();
    }

    /**
     * Bind (creating if needed) the VAO for this context. VAOs record which buffers feed which attribute
     * slots, so after the first frame drawing a mesh is just "bind VAO, draw".
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     */
    bindVAO(gl) {
        let entry = this._vaos.get(gl);
        const version = this.geometry.version;
        if (!entry || entry.version !== version) {
            if (!entry) entry = { vao: gl.createVertexArray(), version: -1 };
            gl.bindVertexArray(entry.vao);
            this.geometry.bind(gl);
            this.bindExtra(gl);
            entry.version = version;
            this._vaos.set(gl, entry);
        } else {
            gl.bindVertexArray(entry.vao);
        }
        this.beforeDraw(gl);
    }

    /** Hook for subclasses to add attributes to the VAO. */
    bindExtra(gl) { void gl; }
    /** Hook for subclasses to update per-frame GPU data. */
    beforeDraw(gl) { void gl; }

    dispose(gl) {
        const e = this._vaos.get(gl);
        if (e) gl.deleteVertexArray(e.vao);
        this._vaos.delete(gl);
    }
}

export class InstancedMesh extends Mesh {
    /**
     * @param {import("./Geometry.js").Geometry} geometry
     * @param {import("./Material.js").Material} material
     * @param {number} capacity maximum number of instances (buffers are allocated once)
     */
    constructor(geometry, material, capacity) {
        super(geometry, material);
        this.isInstanced = true;
        this.capacity = capacity;
        /** number of instances to draw (≤ capacity) */
        this.count = capacity;
        /** column-major mat4 per instance */
        this.matrices = new Float32Array(capacity * 16);
        /** rgba per instance */
        this.colors = new Float32Array(capacity * 4).fill(1);
        for (let i = 0; i < capacity; i++) this.matrices[i * 16] = this.matrices[i * 16 + 5] = this.matrices[i * 16 + 10] = this.matrices[i * 16 + 15] = 1;
        // dirty ranges in instances; only this slice is sent with bufferSubData
        this._dirtyMin = 0;
        this._dirtyMax = capacity;
        this._gpu = new WeakMap();
    }

    /**
     * Fast path: translation + uniform/axis scale + rotation around Z (no allocation).
     * @param {number} i instance index
     */
    setTransform(i, x, y, z, sx = 1, sy = sx, sz = sx, yaw = 0) {
        const m = this.matrices, o = i * 16, c = Math.cos(yaw), s = Math.sin(yaw);
        m[o] = c * sx; m[o + 1] = s * sx; m[o + 2] = 0; m[o + 3] = 0;
        m[o + 4] = -s * sy; m[o + 5] = c * sy; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = sz; m[o + 11] = 0;
        m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
        this.markDirty(i);
    }

    /** Copy a full mat4 (e.g. from Transform.worldMatrix). */
    setMatrix(i, mat4) {
        this.matrices.set(mat4, i * 16);
        this.markDirty(i);
    }

    setColor(i, r, g, b, a = 1) {
        const c = this.colors, o = i * 4;
        c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = a;
        this.markDirty(i);
    }

    /** Mark instance i (or the whole range) for upload. */
    markDirty(i) {
        if (i === undefined) { this._dirtyMin = 0; this._dirtyMax = this.capacity; return; }
        if (i < this._dirtyMin) this._dirtyMin = i;
        if (i + 1 > this._dirtyMax) this._dirtyMax = i + 1;
    }

    bindExtra(gl) {
        let g = this._gpu.get(gl);
        if (!g) {
            g = { matrix: gl.createBuffer(), color: gl.createBuffer() };
            this._gpu.set(gl, g);
            gl.bindBuffer(gl.ARRAY_BUFFER, g.matrix);
            gl.bufferData(gl.ARRAY_BUFFER, this.matrices.byteLength, gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, g.color);
            gl.bufferData(gl.ARRAY_BUFFER, this.colors.byteLength, gl.DYNAMIC_DRAW);
            this.markDirty();
        }
        // a mat4 attribute uses 4 consecutive vec4 slots; each advances once per instance (divisor 1)
        gl.bindBuffer(gl.ARRAY_BUFFER, g.matrix);
        for (let c = 0; c < 4; c++) {
            const loc = ATTRIB.instanceMatrix + c;
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, c * 16);
            gl.vertexAttribDivisor(loc, 1);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, g.color);
        gl.enableVertexAttribArray(ATTRIB.instanceColor);
        gl.vertexAttribPointer(ATTRIB.instanceColor, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(ATTRIB.instanceColor, 1);
    }

    beforeDraw(gl) {
        if (this._dirtyMax <= this._dirtyMin) return;
        const g = this._gpu.get(gl), a = this._dirtyMin, b = this._dirtyMax;
        gl.bindBuffer(gl.ARRAY_BUFFER, g.matrix);
        gl.bufferSubData(gl.ARRAY_BUFFER, a * 64, this.matrices.subarray(a * 16, b * 16));
        gl.bindBuffer(gl.ARRAY_BUFFER, g.color);
        gl.bufferSubData(gl.ARRAY_BUFFER, a * 16, this.colors.subarray(a * 4, b * 4));
        this._dirtyMin = this.capacity;
        this._dirtyMax = 0;
    }

    dispose(gl) {
        super.dispose(gl);
        const g = this._gpu.get(gl);
        if (g) { gl.deleteBuffer(g.matrix); gl.deleteBuffer(g.color); this._gpu.delete(gl); }
    }
}
