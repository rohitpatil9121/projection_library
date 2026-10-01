/**
 * RenderTarget: an offscreen framebuffer with a colour texture (and optional depth).
 *
 * `float: true` asks for an HDR target (half-float RGBA16F) so bright values above 1.0 survive until bloom
 * and tone mapping. If the GPU can't render to half floats it silently falls back to RGBA8 (LDR);
 * `isFloat` tells you which you got.
 * @module engine/gl/RenderTarget
 */

/** Work out once per context which HDR format (if any) is renderable. */
function floatFormat(gl) {
    if (gl._labFloatFormat !== undefined) return gl._labFloatFormat;
    let fmt = null;
    const isGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    if (isGL2 && gl.getExtension("EXT_color_buffer_float")) {
        fmt = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    } else if (!isGL2) {
        const half = gl.getExtension("OES_texture_half_float");
        const cb = gl.getExtension("EXT_color_buffer_half_float");
        const lin = gl.getExtension("OES_texture_half_float_linear");
        if (half && cb && lin) fmt = { internal: gl.RGBA, format: gl.RGBA, type: half.HALF_FLOAT_OES };
    }
    gl._labFloatFormat = fmt;
    return fmt;
}

export class RenderTarget {
    /**
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @param {{ float?: boolean, depth?: boolean, depthTexture?: boolean }} [options]
     *        depthTexture: keep depth in a texture a later pass can read (ambient occlusion needs this).
     *        Falls back to an ordinary depth buffer where depth textures aren't available.
     */
    constructor(gl, options = {}) {
        this.gl = gl;
        this.wantFloat = options.float ?? false;
        this.depth = options.depth ?? false;
        this.wantDepthTexture = options.depthTexture ?? false;
        /** the readable depth texture, when one was asked for and the GPU has them */
        this.depthTexture = null;
        this.width = 0;
        this.height = 0;
        this.isFloat = false;
        this.texture = null;
        this.framebuffer = null;
        this.depthBuffer = null;
    }

    /** (Re)allocate if the size changed. Cheap no-op otherwise. */
    resize(width, height) {
        width = Math.max(1, width | 0);
        height = Math.max(1, height | 0);
        if (width === this.width && height === this.height && this.framebuffer) return this;
        this.dispose();
        this.width = width;
        this.height = height;
        const gl = this.gl;
        let fmt = this.wantFloat ? floatFormat(gl) : null;
        for (let attempt = 0; attempt < 2; attempt++) {
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            if (fmt) gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, width, height, 0, fmt.format, fmt.type, null);
            else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
            const isGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
            if (this.depth && this.wantDepthTexture && (isGL2 || gl.getExtension("WEBGL_depth_texture"))) {
                this.depthTexture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, isGL2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
            } else if (this.depth) {
                this.depthBuffer = gl.createRenderbuffer();
                gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);
            }
            const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            if (ok) { this.isFloat = !!fmt; break; }
            // the driver refused this format: retry once as plain RGBA8
            this.dispose(true);
            fmt = null;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return this;
    }

    bind() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        return this;
    }

    dispose(keepSize = false) {
        const gl = this.gl;
        if (this.texture) gl.deleteTexture(this.texture);
        if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
        if (this.depthBuffer) gl.deleteRenderbuffer(this.depthBuffer);
        if (this.depthTexture) gl.deleteTexture(this.depthTexture);
        this.texture = this.framebuffer = this.depthBuffer = this.depthTexture = null;
        if (!keepSize) { this.width = 0; this.height = 0; }
    }
}
