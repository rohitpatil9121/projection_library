import { createContext } from "./gl/GLContext.js";
import { ShaderProgram } from "./gl/ShaderProgram.js";
import { QUALITY } from "./config.js";

/**
 * Renderer: draws a Scene through a Camera.
 *
 * Per frame:
 *   1. resize the drawing buffer if the canvas CSS size / DPR / quality changed (ResizeObserver)
 *   2. update world matrices (interpolated by the loop's alpha)
 *   3. collect visible meshes into reused opaque / transparent lists
 *   4. opaque: sorted by program to minimise state changes; transparent: back to front
 *   5. per program, per frame: camera + light uniforms are set once (frame stamp)
 *   6. per draw: material uniforms, model matrix, bind VAO, draw (instanced when needed)
 *
 * Optional stages:
 *   scene.sky        drawn first as a full-screen background (engine/Sky)
 *   renderer.postfx  when set and enabled, the scene renders into its HDR target and PostFX finishes
 *                    the frame (bloom, tone mapping...) on the screen
 *
 * Engine uniforms every material may declare: u_camPos, u_camRight, u_camUp, u_camForward, u_proj,
 * u_time (seconds, set via renderer.time), u_viewport (drawing buffer px), u_model, u_normalMatrix,
 * u_sunDirection, u_sunColor, u_skyColor, u_groundColor.
 *
 * `stats` counts draw calls, vertices, triangles and instances for the Performance HUD (P3).
 * @module engine/Renderer
 */

const byProgram = (a, b) => (a._pk < b._pk ? -1 : a._pk > b._pk ? 1 : 0);

export class RendererError extends Error {
    /** @param {"WEBGL_UNAVAILABLE"} code */
    constructor(code, message) { super(message); this.name = "RendererError"; this.code = code; }
}

export class Renderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{ quality?: keyof QUALITY, preferWebGL2?: boolean, antialias?: boolean,
     *           preserveDrawingBuffer?: boolean, autoResize?: boolean }} [options]
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        const ctx = createContext(canvas, options);
        if (!ctx) throw new RendererError("WEBGL_UNAVAILABLE", "WebGL is not available in this browser.");
        this.gl = ctx.gl;
        this.caps = ctx.caps;
        this.quality = options.quality || "high";
        /** extra multiplier on top of the quality preset (auto-downgrade uses this) */
        this.resolutionScale = 1;
        /** @type {Map<string, ShaderProgram>} */
        this.programs = new Map();
        this.stats = { drawCalls: 0, vertices: 0, triangles: 0, instances: 0, programs: 0, width: 0, height: 0, dpr: 1, postPasses: 0 };
        this.frameId = 0;
        /** seconds, passed to shaders as u_time (Game sets it from the loop) */
        this.time = 0;
        /** @type {import("./PostFX.js").PostFX | null} */
        this.postfx = null;
        this._viewport = new Float32Array(2);

        this._opaque = [];
        this._transparent = [];
        this._depth = new Map();
        this._byDepth = (a, b) => this._depth.get(b) - this._depth.get(a);
        this._state = { program: null, cull: null, blend: null, depthTest: null, depthWrite: null };

        const gl = this.gl;
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.frontFace(gl.CCW);

        if (options.autoResize !== false && typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(() => this.resize());
            this._resizeObserver.observe(canvas);
        }
        this.resize();
    }

    /** @param {keyof QUALITY} level */
    setQuality(level) { this.quality = level; this.resize(); }

    /** Match the drawing buffer to CSS size × capped DPR × resolution scale. Cheap to call every frame. */
    resize() {
        const q = QUALITY[this.quality] || QUALITY.high;
        const dpr = Math.min(window.devicePixelRatio || 1, q.dprCap) * q.resolutionScale * this.resolutionScale;
        const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        this.stats.width = w; this.stats.height = h; this.stats.dpr = dpr;
    }

    /** width / height of the drawing buffer */
    get aspect() { return this.canvas.width / Math.max(1, this.canvas.height); }

    /**
     * Get or build the program variant for a material.
     * @param {import("./Material.js").Material} material
     * @param {boolean} instanced
     */
    programFor(material, instanced) {
        const defines = material.defines();
        if (instanced) defines.INSTANCED = true;
        let key = material.shader.name;
        for (const k in defines) if (defines[k]) key += "|" + k + (defines[k] === true ? "" : "=" + defines[k]);
        let p = this.programs.get(key);
        if (!p) {
            p = new ShaderProgram(this.gl, material.shader.vertex, material.shader.fragment, { name: key, defines });
            this.programs.set(key, p);
            this.stats.programs = this.programs.size;
        }
        return p;
    }

    /**
     * Draw one frame.
     * @param {import("./Scene.js").Scene} scene
     * @param {import("./Camera.js").Camera} camera
     * @param {number} [alpha=1] interpolation factor from the Loop
     */
    render(scene, camera, alpha = 1) {
        const gl = this.gl, s = this.stats;
        this.frameId++;
        s.drawCalls = s.vertices = s.triangles = s.instances = 0;

        const post = this.postfx && this.postfx.settings.enabled ? this.postfx : null;
        if (post) post.begin(this.canvas.width, this.canvas.height);
        else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
        this._viewport[0] = this.canvas.width; this._viewport[1] = this.canvas.height;
        const c = scene.clearColor;
        gl.clearColor(c[0], c[1], c[2], c[3]);
        this._resetState();
        this._setDepthWrite(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        scene.root.updateWorldMatrix(alpha);
        const cam = camera.writeUniforms(this.aspect);
        if (scene.sky) { scene.sky.draw(gl, cam, this.time); this._resetState(); }

        // collect
        const opaque = this._opaque, transparent = this._transparent;
        opaque.length = 0; transparent.length = 0;
        this._collect(scene.root, opaque, transparent);

        // opaque: group by program key to avoid switching programs back and forth
        opaque.sort(byProgram);
        // transparent: farthest first
        const depth = this._depth;
        depth.clear();
        for (const e of transparent) {
            const m = e.worldMatrix;
            depth.set(e, (m[12] - cam.u_camPos[0]) * cam.u_camForward[0] + (m[13] - cam.u_camPos[1]) * cam.u_camForward[1] + (m[14] - cam.u_camPos[2]) * cam.u_camForward[2]);
        }
        transparent.sort(this._byDepth);

        for (const e of opaque) this._draw(e, scene, cam);
        for (const e of transparent) this._draw(e, scene, cam);

        gl.bindVertexArray(null);
        if (post) { post.end(this.time); this.stats.postPasses = post.passes; }
        else this.stats.postPasses = 0;
        this._resetState();
    }

    /** Forget cached GL state (after anything else touched the context). */
    _resetState() {
        const st = this._state;
        st.program = st.cull = st.blend = st.depthTest = st.depthWrite = null;
    }

    _collect(node, opaque, transparent) {
        if (!node.visible) return;
        const mesh = node.mesh;
        if (mesh && !(mesh.isInstanced && mesh.count === 0)) {
            // program lookup is cached on the mesh; rebuilt only when the material changes variant
            const mat = mesh.material;
            if (mesh._program === undefined || mesh._programRenderer !== this || mesh._programMaterial !== mat || mesh._programVersion !== mat.variantVersion) {
                mesh._program = this.programFor(mat, mesh.isInstanced);
                mesh._programRenderer = this;
                mesh._programMaterial = mat;
                mesh._programVersion = mat.variantVersion;
            }
            node._program = mesh._program;
            node._pk = node._program.name;
            (mesh.material.transparent ? transparent : opaque).push(node);
        }
        for (let i = 0; i < node.children.length; i++) this._collect(node.children[i], opaque, transparent);
    }

    _draw(entity, scene, cam) {
        const gl = this.gl, mesh = entity.mesh, mat = mesh.material, geo = mesh.geometry;
        const program = entity._program;

        if (this._state.program !== program) {
            program.use();
            this._state.program = program;
        }
        if (program.frameStamp !== this.frameId) {
            program.frameStamp = this.frameId;
            program.setAll(cam);
            program.set("u_sunDirection", scene.sunDirection);
            program.set("u_sunColor", scene.sunColor);
            program.set("u_skyColor", scene.skyColor);
            program.set("u_groundColor", scene.groundColor);
            program.set("u_time", this.time);
            program.set("u_viewport", this._viewport);
        }
        program.setAll(mat.uniforms());
        program.set("u_model", entity.worldMatrix);
        program.set("u_normalMatrix", entity.normalMatrix);

        this._setCull(mat.cull);
        this._setBlend(mat.transparent ? mat.blending : null);
        this._setDepthTest(mat.depthTest);
        this._setDepthWrite(mat.depthWrite);

        const n = geo.drawCount;
        mesh.bindVAO(gl);
        const mode = geo.mode === "triangles" ? gl.TRIANGLES : geo.mode === "lines" ? gl.LINES : geo.mode === "lineStrip" ? gl.LINE_STRIP : gl.POINTS;
        if (n <= 0) return;
        if (mesh.isInstanced) {
            if (geo.indices) gl.drawElementsInstanced(mode, n, geo.indexType, 0, mesh.count);
            else gl.drawArraysInstanced(mode, 0, n, mesh.count);
            this.stats.instances += mesh.count;
            this.stats.vertices += geo.vertexCount * mesh.count;
            if (mode === gl.TRIANGLES) this.stats.triangles += (n / 3) * mesh.count;
        } else {
            if (geo.indices) gl.drawElements(mode, n, geo.indexType, 0);
            else gl.drawArrays(mode, 0, n);
            this.stats.vertices += geo.vertexCount;
            if (mode === gl.TRIANGLES) this.stats.triangles += n / 3;
        }
        this.stats.drawCalls++;
    }

    _setCull(cull) {
        if (this._state.cull === cull) return;
        const gl = this.gl;
        this._state.cull = cull;
        if (cull === "none") gl.disable(gl.CULL_FACE);
        else { gl.enable(gl.CULL_FACE); gl.cullFace(cull === "front" ? gl.FRONT : gl.BACK); }
    }

    _setBlend(mode) {
        if (this._state.blend === mode) return;
        const gl = this.gl;
        this._state.blend = mode;
        if (!mode) { gl.disable(gl.BLEND); return; }
        gl.enable(gl.BLEND);
        if (mode === "additive") gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    _setDepthTest(on) {
        if (this._state.depthTest === on) return;
        this._state.depthTest = on;
        if (on) this.gl.enable(this.gl.DEPTH_TEST); else this.gl.disable(this.gl.DEPTH_TEST);
    }

    _setDepthWrite(on) {
        if (this._state.depthWrite === on) return;
        this._state.depthWrite = on;
        this.gl.depthMask(on);
    }

    dispose() {
        this._resizeObserver?.disconnect();
        this.postfx?.dispose();
        for (const p of this.programs.values()) p.dispose();
        this.programs.clear();
    }
}
