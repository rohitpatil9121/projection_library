import { ShaderProgram } from "./gl/ShaderProgram.js";
import * as space from "../shaders/environment/space.js";

/**
 * Sky: a full-screen background drawn before the scene (depth test and writes off).
 * The default is the procedural space sky; pass another { vertex, fragment } for other skies.
 *
 *   scene.sky = new Sky({ uniforms: { u_nebulaA: [0.3, 0.1, 0.5] } });
 * @module engine/Sky
 */
export const SPACE_DEFAULTS = Object.freeze({
    u_base: [0.006, 0.008, 0.02],
    u_nebulaA: [0.22, 0.08, 0.42],
    u_nebulaB: [0.04, 0.22, 0.38],
    u_nebula: 0.55,
    u_stars: 1,
    u_seed: [0, 0, 0],
});

export class Sky {
    /** @param {{ name?: string, vertex?: string, fragment?: string, uniforms?: Record<string, any> }} [options] */
    constructor(options = {}) {
        this.name = options.name || "sky-space";
        this.vertex = options.vertex || space.vertex;
        this.fragment = options.fragment || space.fragment;
        /** uniform values; edit freely (e.g. per level) */
        this.uniforms = {};
        const src = { ...(options.fragment ? {} : SPACE_DEFAULTS), ...(options.uniforms || {}) };
        for (const k in src) {
            const v = src[k];
            this.uniforms[k] = Array.isArray(v) || ArrayBuffer.isView(v) ? Float32Array.from(v) : v;
        }
        this._gpu = new WeakMap();
    }

    /**
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @param {Record<string, Float32Array>} cameraUniforms from Camera.writeUniforms
     * @param {number} time seconds
     */
    draw(gl, cameraUniforms, time) {
        let g = this._gpu.get(gl);
        if (!g) {
            const program = new ShaderProgram(gl, this.vertex, this.fragment, { name: this.name });
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            g = { program, vao, buf };
            this._gpu.set(gl, g);
        }
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        g.program.use().setAll(cameraUniforms).setAll(this.uniforms).set("u_time", time);
        gl.bindVertexArray(g.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
    }
}
