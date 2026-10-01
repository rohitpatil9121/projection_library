import { RenderTarget } from "./gl/RenderTarget.js";
import { ShaderProgram } from "./gl/ShaderProgram.js";
import * as post from "../shaders/postprocessing/post.js";

/**
 * PostFX: renders the scene into an HDR target, then applies bloom and a final composite to the screen.
 *
 *   scene ──► [HDR target + depth texture]
 *               ├─► ambient occlusion ½ (from depth) ─► blur ─► ao      (optional, settings.ao)
 *               ├─► bright pass ½ ─► blur ─► mip0 ─► ¼ ─► blur ─► mip1 ─► ⅛ ─► blur ─► mip2
 *               └──────────────────────────────── composite (+ mips, exposure, ACES, vignette, grain, AA) ─► screen
 *
 * Bloom is "selective" by brightness: only values above `threshold` bleed. With an HDR target, emissive
 * colours brighter than 1.0 (e.g. emissive × 3) glow while ordinary lit surfaces don't.
 *
 *   renderer.postfx = new PostFX(renderer, { bloom: { intensity: 1.2 } });
 *   renderer.postfx.settings.vignette = 0.4;   // tweak live
 * @module engine/PostFX
 */

/** @typedef {{ enabled: boolean, threshold: number, knee: number, intensity: number, radius: number }} BloomSettings */
/** @typedef {{ enabled: boolean, radius: number, intensity: number, bias: number }} AOSettings radius and bias in world units */

export const POSTFX_DEFAULTS = Object.freeze({
    enabled: true,
    bloom: { enabled: true, threshold: 0.9, knee: 0.4, intensity: 1.0, radius: 1.0 },
    /** ambient occlusion: off by default, so existing scenes look as they did */
    ao: { enabled: false, radius: 0.7, intensity: 0.85, bias: 0.04 },
    exposure: 1.0,
    tonemap: true,
    vignette: 0.25,
    grain: 0.025,
    aberration: 0,
    antialias: true,
});

export class PostFX {
    /**
     * @param {import("./Renderer.js").Renderer} renderer
     * @param {Partial<typeof POSTFX_DEFAULTS> & { bloom?: Partial<BloomSettings>, ao?: Partial<AOSettings> }} [settings]
     */
    constructor(renderer, settings = {}) {
        this.renderer = renderer;
        const gl = (this.gl = renderer.gl);
        this.settings = { ...POSTFX_DEFAULTS, ...settings, bloom: { ...POSTFX_DEFAULTS.bloom, ...(settings.bloom || {}) }, ao: { ...POSTFX_DEFAULTS.ao, ...(settings.ao || {}) } };

        this.scene = new RenderTarget(gl, { float: true, depth: true, depthTexture: true });
        this.ao = new RenderTarget(gl);
        this.aoTemp = new RenderTarget(gl);
        this.mips = [0, 1, 2].map(() => new RenderTarget(gl, { float: true }));
        this.temps = [0, 1, 2].map(() => new RenderTarget(gl, { float: true }));

        const P = (name, frag) => new ShaderProgram(gl, post.fullscreenVertex, frag, { name: "post-" + name });
        this.programs = {
            bright: P("bright", post.brightFragment),
            down: P("down", post.downsampleFragment),
            blur: P("blur", post.blurFragment),
            composite: P("composite", post.compositeFragment),
            ssao: P("ssao", post.ssaoFragment),
            ssaoBlur: P("ssao-blur", post.ssaoBlurFragment),
        };

        // full-screen triangle in its own VAO (attribute slot 0)
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        this._texel = new Float32Array(2);
        this._dir = new Float32Array(2);
        /** number of full-screen passes last frame (for the perf HUD) */
        this.passes = 0;
    }

    /** true when ambient occlusion can run here (it needs a readable depth texture) */
    get aoSupported() { return !!this.scene.depthTexture; }

    /** true when the scene target is HDR (half-float) */
    get hdr() { return this.scene.isFloat; }

    /** Bind the scene target. Called by the Renderer before drawing the scene. */
    begin(width, height) {
        this.scene.resize(width, height);
        let w = width, h = height;
        for (let i = 0; i < 3; i++) {
            w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
            this.mips[i].resize(w, h);
            this.temps[i].resize(w, h);
        }
        if (this.settings.ao.enabled) { this.ao.resize(width >> 1, height >> 1); this.aoTemp.resize(width >> 1, height >> 1); }
        this.scene.bind();
    }

    _pass(program, target, source) {
        const gl = this.gl;
        if (target) target.bind(); else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.renderer.canvas.width, this.renderer.canvas.height); }
        program.use();
        if (source) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, source.texture);
            program.set("u_source", 0);
            this._texel[0] = 1 / source.width; this._texel[1] = 1 / source.height;
            program.set("u_texel", this._texel);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.passes++;
    }

    _blur(rt, tmp) {
        const r = this.settings.bloom.radius;
        const p = this.programs.blur;
        p.use();
        this._dir[0] = r / rt.width; this._dir[1] = 0; p.set("u_direction", this._dir);
        this._pass(p, tmp, rt);
        p.use();
        this._dir[0] = 0; this._dir[1] = r / tmp.height; p.set("u_direction", this._dir);
        this._pass(p, rt, tmp);
    }

    /**
     * Run ambient occlusion, bloom and the composite to the screen. Called by the Renderer after the scene.
     * @param {number} [time]
     * @param {Record<string, Float32Array> | null} [cam] camera uniforms (ambient occlusion needs u_proj)
     */
    end(time = 0, cam = null) {
        const gl = this.gl, s = this.settings, b = s.bloom;
        this.passes = 0;
        gl.bindVertexArray(this.vao);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.depthMask(false);

        const ao = s.ao.enabled && cam && this.scene.depthTexture && this.ao.framebuffer;
        if (ao) {
            const p = this.programs.ssao;
            this.ao.bind();
            p.use();
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.scene.depthTexture);
            p.set("u_depth", 0);
            p.set("u_proj", cam.u_proj);
            this._texel[0] = 1 / this.scene.width; this._texel[1] = 1 / this.scene.height;
            p.set("u_texel", this._texel);
            p.set("u_radius", s.ao.radius);
            p.set("u_bias", s.ao.bias);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            this.passes++;
            this._pass(this.programs.ssaoBlur, this.aoTemp, this.ao);
        }

        if (b.enabled) {
            const bp = this.programs.bright;
            bp.use(); bp.set("u_threshold", b.threshold); bp.set("u_knee", Math.max(1e-3, b.knee));
            this._pass(bp, this.mips[0], this.scene);
            this._blur(this.mips[0], this.temps[0]);
            this._pass(this.programs.down, this.mips[1], this.mips[0]);
            this._blur(this.mips[1], this.temps[1]);
            this._pass(this.programs.down, this.mips[2], this.mips[1]);
            this._blur(this.mips[2], this.temps[2]);
        }

        const c = this.programs.composite;
        c.use();
        const bind = (unit, rt, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, rt.texture); c.set(name, unit); };
        bind(0, this.scene, "u_scene");
        bind(1, this.mips[0], "u_bloom0");
        bind(2, this.mips[1], "u_bloom1");
        bind(3, this.mips[2], "u_bloom2");
        // the sampler needs a texture even when occlusion is off; the scene itself will do
        bind(4, ao ? this.aoTemp : this.scene, "u_ao");
        c.set("u_aoStrength", ao ? s.ao.intensity : 0);
        this._texel[0] = 1 / this.scene.width; this._texel[1] = 1 / this.scene.height;
        c.set("u_texel", this._texel);
        c.set("u_bloomIntensity", b.enabled ? b.intensity : 0);
        c.set("u_exposure", s.exposure);
        c.set("u_tonemap", s.tonemap ? 1 : 0);
        c.set("u_vignette", s.vignette);
        c.set("u_grain", s.grain);
        c.set("u_aberration", s.aberration);
        c.set("u_antialias", s.antialias ? 1 : 0);
        c.set("u_time", time);
        this._pass(c, null, null);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
    }

    dispose() {
        const gl = this.gl;
        this.scene.dispose();
        this.ao.dispose(); this.aoTemp.dispose();
        for (const rt of [...this.mips, ...this.temps]) rt.dispose();
        for (const p of Object.values(this.programs)) p.dispose();
        gl.deleteBuffer(this.quad);
        gl.deleteVertexArray(this.vao);
    }
}
