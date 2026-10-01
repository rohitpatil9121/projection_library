import { mat4 } from "./vendor.js";
import { ShaderProgram } from "./gl/ShaderProgram.js";
import * as standard from "../shaders/standard/standard.js";

/**
 * ShadowMap: shadows cast by the Scene's sun.
 *
 *   scene.shadow = new ShadowMap({ center: [10, 0, 0], extent: [24, 14], size: 2048 });
 *
 * Before the main pass the Renderer draws every opaque mesh once more from the sun's point of view into a
 * depth texture: for each texel, how far the nearest surface is from the sun. In the main pass a surface
 * compares its own distance to the sun against that texel (shaders/chunks/lighting.js, labShadow). If
 * something was nearer, the surface is in shadow.
 *
 * The sun is far away, so its rays are parallel and its "camera" has no perspective: a box (`extent` wide
 * and tall, `depth` deep) centred on `center`. Only things inside the box cast or receive shadows, so keep
 * it as small as the play area allows: the same texture spread over less ground gives sharper shadows.
 *
 * Needs a depth texture: built into WebGL2, an extension on WebGL1. Without one, `supported` is false and
 * the scene renders with no shadows.
 * @module engine/ShadowMap
 */
export class ShadowMap {
    /**
     * @param {{ size?: number, center?: number[], extent?: number[], depth?: number, strength?: number,
     *           bias?: number, normalBias?: number, enabled?: boolean }} [options]
     *        extent: half-width and half-height of the lit box, in world units, as the sun sees it
     *        strength: 0..1, how much sunlight a shadow removes
     */
    constructor(options = {}) {
        this.size = options.size ?? 2048;
        this.center = Float32Array.from(options.center || [0, 0, 0]);
        this.extent = Float32Array.from(options.extent || [20, 20]);
        this.depth = options.depth ?? 80;
        this.strength = options.strength ?? 0.8;
        this.bias = options.bias ?? 0.0025;
        this.normalBias = options.normalBias ?? 0.05;
        this.enabled = options.enabled ?? true;
        this.supported = true;
        /** world -> sun clip space */
        this.matrix = mat4.create();
        this.params = new Float32Array(4);
        this._view = mat4.create();
        this._proj = mat4.create();
        this._eye = new Float32Array(3);
        this._gpu = new WeakMap();
        /** draw calls spent on the last shadow pass */
        this.drawCalls = 0;
    }

    /** Recompute the sun's matrix. Called by the Renderer every frame. */
    update(sunDirection) {
        const c = this.center, d = sunDirection, half = this.depth / 2;
        this._eye[0] = c[0] + d[0] * half; this._eye[1] = c[1] + d[1] * half; this._eye[2] = c[2] + d[2] * half;
        // world up (Z) unless the sun is straight overhead, where "up" would be undefined
        const up = Math.abs(d[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
        mat4.lookAt(this._view, this._eye, c, up);
        mat4.ortho(this._proj, -this.extent[0], this.extent[0], -this.extent[1], this.extent[1], 0.1, this.depth);
        mat4.multiply(this.matrix, this._proj, this._view);
        this.params[0] = this.enabled && this.supported ? this.strength : 0;
        this.params[1] = 1 / this.size;
        this.params[2] = this.bias;
        this.params[3] = this.normalBias;
    }

    _resources(gl) {
        let g = this._gpu.get(gl);
        if (g) return g;
        const webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        const ext = webgl2 ? true : gl.getExtension("WEBGL_depth_texture");
        g = { texture: null, framebuffer: null, color: null, programs: new Map(), ok: false };
        this._gpu.set(gl, g);
        if (!ext) { this.supported = false; return g; }
        g.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, g.texture);
        if (webgl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.size, this.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.size, this.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        // depth textures can't be filtered; the shader does its own 3×3 averaging
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        g.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, g.texture, 0);
        if (!webgl2) {
            // WebGL1 wants a colour attachment too, even though nothing reads it
            g.color = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, g.color);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.size, this.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.color, 0);
        }
        g.ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        if (!g.ok) this.supported = false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return g;
    }

    /** The depth texture for this context (null when unsupported). */
    texture(gl) { const g = this._resources(gl); return g.ok ? g.texture : null; }

    _program(gl, g, instanced, skinned) {
        const key = (instanced ? 1 : 0) + (skinned ? 2 : 0);
        let p = g.programs.get(key);
        if (!p) {
            p = new ShaderProgram(gl, standard.depthVertex, standard.depthFragment, { name: "shadow-depth-" + key, defines: { INSTANCED: instanced, SKINNED: skinned } });
            g.programs.set(key, p);
        }
        return p;
    }

    /**
     * Draw the casters into the depth texture.
     * @param {import("./Renderer.js").Renderer} renderer
     * @param {Array<import("./Entity.js").Entity>} casters opaque entities, already with world matrices
     */
    render(renderer, casters) {
        const gl = renderer.gl, g = this._resources(gl);
        this.drawCalls = 0;
        if (!g.ok || !this.enabled) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer);
        gl.viewport(0, 0, this.size, this.size);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.colorMask(false, false, false, false);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        // a little slope-scaled offset keeps lit surfaces from shadowing themselves at grazing angles
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 2.0);
        let current = null;
        for (const e of casters) {
            const mesh = e.mesh, geo = mesh.geometry, n = geo.drawCount;
            if (n <= 0 || geo.mode !== "triangles") continue;
            const program = this._program(gl, g, mesh.isInstanced, !!mesh.isSkinned);
            if (program !== current) { program.use(); program.set("u_shadowMatrix", this.matrix); current = program; }
            program.set("u_model", e.worldMatrix);
            if (mesh.isSkinned) program.set("u_joints", mesh.jointMatrices);
            const cull = mesh.material.cull;
            if (cull === "none") gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(cull === "front" ? gl.FRONT : gl.BACK); }
            mesh.bindVAO(gl);
            if (mesh.isInstanced) {
                if (geo.indices) gl.drawElementsInstanced(gl.TRIANGLES, n, geo.indexType, 0, mesh.count);
                else gl.drawArraysInstanced(gl.TRIANGLES, 0, n, mesh.count);
            } else if (geo.indices) gl.drawElements(gl.TRIANGLES, n, geo.indexType, 0);
            else gl.drawArrays(gl.TRIANGLES, 0, n);
            this.drawCalls++;
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** @param {WebGLRenderingContext | WebGL2RenderingContext} gl */
    dispose(gl) {
        const g = this._gpu.get(gl);
        if (!g) return;
        if (g.texture) gl.deleteTexture(g.texture);
        if (g.color) gl.deleteTexture(g.color);
        if (g.framebuffer) gl.deleteFramebuffer(g.framebuffer);
        for (const p of g.programs.values()) p.dispose();
        this._gpu.delete(gl);
    }
}
