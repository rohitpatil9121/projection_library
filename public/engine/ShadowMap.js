import { mat4 } from "./vendor.js";
import { ShaderProgram } from "./gl/ShaderProgram.js";
import * as standard from "../shaders/standard/standard.js";
import { LIGHTS } from "./config.js";

// Copies one depth texture into the bound depth target by drawing a single triangle that covers it and
// writing each texel's depth. (A framebuffer blit would do the same, but is far slower for depth on the
// Direct3D back end most Windows browsers use.) GLSL ES 3.00: gl_FragDepth and texelFetch need it.
const COPY_VERTEX = `#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const COPY_FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D u_depth;
void main() { gl_FragDepth = texelFetch(u_depth, ivec2(gl_FragCoord.xy), 0).r; }`;

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
 * Static casters (optional, `cache: true`). Most of a scene never moves (buildings, terrain, furniture).
 * Mark those entities `entity.staticShadow = true` and their depth is drawn once into a second texture
 * and kept; each frame that texture is copied into the shadow map and only the moving casters are drawn
 * on top. The kept copy is redrawn by itself when the sun, the box, or a static
 * entity's mesh, geometry or transform changes. If you edit a static mesh in a way that can't be seen from
 * outside (instance matrices, vertices in place without markDirty), call `invalidate()`.
 * This needs WebGL2 (the copy writes gl_FragDepth); on WebGL1 everything is simply drawn every frame.
 * It is off by default because it is not always a win: the copy touches every texel of the shadow map,
 * and drawing depth-only triangles is cheap. Measured on NIGHT MARKET (Intel UHD, 2048² map, a static
 * street of 150,000 triangles): drawing the street cost about 0.5 ms a frame, copying it about 0.9 ms.
 * Turn it on for scenes whose static casters are much heavier than that, and time both ways.
 *
 * Needs a depth texture: built into WebGL2, an extension on WebGL1. Without one, `supported` is false and
 * the scene renders with no shadows.
 * @module engine/ShadowMap
 */
export class ShadowMap {
    /**
     * @param {{ size?: number, center?: number[], extent?: number[], depth?: number, strength?: number,
     *           bias?: number, normalBias?: number, enabled?: boolean, cache?: boolean }} [options]
     *        extent: half-width and half-height of the lit box, in world units, as the sun sees it
     *        strength: 0..1, how much sunlight a shadow removes
     *        cache: keep the depth of `staticShadow` entities between frames (default false; see above)
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
        this.cache = options.cache ?? false;
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
        /** how many times the kept depth of the static casters has been redrawn */
        this.staticRedraws = 0;
        this._statics = [];
        this._movers = [];
        // what the kept copy was drawn from: if any of it differs this frame, the copy is stale
        this._keptRefs = [];
        this._keptNumbers = new Float32Array(16);
        this._kept = false;
    }

    /** Throw away the kept depth of the static casters; it is redrawn on the next frame. */
    invalidate() { this._kept = false; }

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
        g = { texture: null, framebuffer: null, color: null, programs: new Map(), ok: false, webgl2, keptTexture: null, keptFramebuffer: null, copy: null, copyVAO: null };
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

    /** The second depth texture, holding the static casters. Made the first time it is needed. */
    _keptTarget(gl, g) {
        if (g.keptFramebuffer) return g.keptFramebuffer;
        g.keptTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, g.keptTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.size, this.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        g.keptFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, g.keptFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, g.keptTexture, 0);
        return g.keptFramebuffer;
    }

    /** Write the kept depth into the bound depth target, replacing whatever was there. */
    _copyKept(gl, g) {
        if (!g.copy) {
            const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
            const p = gl.createProgram(), vs = compile(gl.VERTEX_SHADER, COPY_VERTEX), fs = compile(gl.FRAGMENT_SHADER, COPY_FRAGMENT);
            gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
            gl.deleteShader(vs); gl.deleteShader(fs);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { this.cache = false; gl.deleteProgram(p); return false; }
            g.copy = p;
            g.copyVAO = gl.createVertexArray();      // no attributes: the triangle comes from gl_VertexID
            gl.useProgram(p);
            gl.uniform1i(gl.getUniformLocation(p, "u_depth"), LIGHTS.shadowUnit);
        }
        gl.useProgram(g.copy);
        gl.activeTexture(gl.TEXTURE0 + LIGHTS.shadowUnit);
        gl.bindTexture(gl.TEXTURE_2D, g.keptTexture);
        gl.bindVertexArray(g.copyVAO);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthFunc(gl.ALWAYS);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        return true;
    }

    /** Is the kept copy still a picture of exactly these static casters under this sun? Records the new state. */
    _keptIsCurrent(statics) {
        const refs = this._keptRefs, need = 16 + statics.length * 18;
        if (this._keptNumbers.length < need) { this._keptNumbers = new Float32Array(need); this._kept = false; }
        const numbers = this._keptNumbers;
        let same = this._kept && refs.length === statics.length * 2, o = 0;
        const put = (v) => { if (numbers[o] !== v) { numbers[o] = v; same = false; } o++; };
        for (let k = 0; k < 16; k++) put(this.matrix[k]);
        for (let i = 0; i < statics.length; i++) {
            const e = statics[i], mesh = e.mesh, geo = mesh.geometry;
            if (refs[i * 2] !== mesh || refs[i * 2 + 1] !== geo) { refs[i * 2] = mesh; refs[i * 2 + 1] = geo; same = false; }
            for (let k = 0; k < 16; k++) put(e.worldMatrix[k]);
            put(geo.version * 4096 + geo.drawCount);
            put(mesh.isInstanced ? mesh.count : -1);
        }
        refs.length = statics.length * 2;
        this._kept = true;
        return same;
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
        // a little slope-scaled offset keeps lit surfaces from shadowing themselves at grazing angles
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 2.0);

        // split off the casters that never move; their depth is kept from frame to frame
        let movers = casters;
        const statics = this._statics;
        statics.length = 0;
        if (this.cache && g.webgl2) {
            movers = this._movers;
            movers.length = 0;
            for (const e of casters) (e.staticShadow ? statics : movers).push(e);
        }
        if (statics.length) {
            const kept = this._keptTarget(gl, g);
            if (!this._keptIsCurrent(statics)) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, kept);
                gl.clear(gl.DEPTH_BUFFER_BIT);
                this._draw(gl, g, statics);
                this.staticRedraws++;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer);
            if (!this._copyKept(gl, g)) { gl.clear(gl.DEPTH_BUFFER_BIT); this._draw(gl, g, statics); }
        } else {
            this._kept = false;
            gl.clear(gl.DEPTH_BUFFER_BIT);
        }
        this._draw(gl, g, movers);

        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** Draw a list of casters into whichever depth target is bound. */
    _draw(gl, g, casters) {
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
    }

    /** @param {WebGLRenderingContext | WebGL2RenderingContext} gl */
    dispose(gl) {
        const g = this._gpu.get(gl);
        if (!g) return;
        if (g.texture) gl.deleteTexture(g.texture);
        if (g.color) gl.deleteTexture(g.color);
        if (g.framebuffer) gl.deleteFramebuffer(g.framebuffer);
        if (g.keptTexture) gl.deleteTexture(g.keptTexture);
        if (g.keptFramebuffer) gl.deleteFramebuffer(g.keptFramebuffer);
        if (g.copy) { gl.deleteProgram(g.copy); gl.deleteVertexArray(g.copyVAO); }
        this._kept = false;
        for (const p of g.programs.values()) p.dispose();
        this._gpu.delete(gl);
    }
}
