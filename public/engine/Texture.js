/**
 * Texture: an image on the GPU. The source can be an <img>, a <canvas>, an ImageBitmap, or raw RGBA bytes.
 * Like Geometry, nothing is uploaded until a Renderer first needs it, and the GPU object is kept per context.
 *
 *   const wood = await Texture.load("assets/wood.png");
 *   new StandardMaterial({ map: wood });
 *
 *   const sign = new Texture({ source: canvas });      // draw on a 2D canvas, use it as a texture
 *   sign.update();                                     // after drawing on the canvas again
 *
 * UV origin: (0, 0) is the first row of the source, which for an image is its top-left. That is the glTF
 * convention, so loaded models need no flipping. Pass `flipY: true` for bottom-left-origin UVs.
 * @module engine/Texture
 */
const isPowerOfTwo = (n) => (n & (n - 1)) === 0;

export class Texture {
    /**
     * @param {{ source?: TexImageSource, data?: Uint8Array, width?: number, height?: number,
     *           wrap?: "repeat" | "clamp" | "mirror", filter?: "linear" | "nearest", mipmaps?: boolean,
     *           flipY?: boolean, name?: string }} options
     */
    constructor(options = {}) {
        this.isTexture = true;
        this.name = options.name || "texture";
        this.source = options.source || null;
        this.data = options.data || null;
        this.width = options.width || (this.source ? this.source.width : 1);
        this.height = options.height || (this.source ? this.source.height : 1);
        this.wrap = options.wrap || "repeat";
        this.filter = options.filter || "linear";
        this.mipmaps = options.mipmaps ?? true;
        this.flipY = options.flipY ?? false;
        this.version = 0;
        this._gpu = new WeakMap();
    }

    /** A 1×1 texture of one colour (components 0..1). Handy as a default or a placeholder while loading. */
    static solid(rgba = [1, 1, 1, 1]) {
        const data = new Uint8Array(4);
        for (let i = 0; i < 4; i++) data[i] = Math.round(Math.max(0, Math.min(1, rgba[i] ?? 1)) * 255);
        return new Texture({ data, width: 1, height: 1, mipmaps: false, filter: "nearest", name: "solid" });
    }

    /** Load an image file. Rejects if it can't be fetched or decoded. */
    static async load(url, options = {}) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Texture: could not load ${url} (${res.status})`);
        return Texture.fromBlob(await res.blob(), { name: url, ...options });
    }

    /** Decode image bytes (PNG, JPEG, WebP…) held in a Blob. */
    static async fromBlob(blob, options = {}) {
        let source;
        if (typeof createImageBitmap === "function") {
            source = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        } else {
            source = await new Promise((resolve, reject) => {
                const img = new Image(), url = URL.createObjectURL(blob);
                img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
                img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Texture: image failed to decode")); };
                img.src = url;
            });
        }
        return new Texture({ source, ...options });
    }

    /** Re-upload on next use (after drawing on a canvas source or editing `data`). */
    update() {
        if (this.source) { this.width = this.source.width; this.height = this.source.height; }
        this.version++;
    }

    /**
     * Bind to a texture unit, uploading first if needed. Called by the Renderer.
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @param {number} unit
     */
    bind(gl, unit) {
        let g = this._gpu.get(gl);
        gl.activeTexture(gl.TEXTURE0 + unit);
        if (g && g.version === this.version) { gl.bindTexture(gl.TEXTURE_2D, g.texture); return; }
        if (!g) { g = { texture: gl.createTexture(), version: -1 }; this._gpu.set(gl, g); }
        gl.bindTexture(gl.TEXTURE_2D, g.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.flipY);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (this.source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

        // WebGL1 can only repeat or mipmap power-of-two textures
        const webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        const full = webgl2 || (isPowerOfTwo(this.width) && isPowerOfTwo(this.height));
        const mip = this.mipmaps && full;
        const wrap = !full ? gl.CLAMP_TO_EDGE : this.wrap === "clamp" ? gl.CLAMP_TO_EDGE : this.wrap === "mirror" ? gl.MIRRORED_REPEAT : gl.REPEAT;
        const linear = this.filter === "linear";
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? (linear ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST) : linear ? gl.LINEAR : gl.NEAREST);
        if (mip) gl.generateMipmap(gl.TEXTURE_2D);
        g.version = this.version;
    }

    /** @param {WebGLRenderingContext | WebGL2RenderingContext} gl */
    dispose(gl) {
        const g = this._gpu.get(gl);
        if (g) { gl.deleteTexture(g.texture); this._gpu.delete(gl); }
    }
}
