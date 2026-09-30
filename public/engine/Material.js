import * as basic from "../shaders/basic/basic.js";

/**
 * Material: which shader draws a mesh, with which parameters and GPU state.
 *
 * P1 ships `BasicMaterial` (unlit or Lambert, colour, opacity, emissive, vertex colours). P2 adds the
 * Light system and more material types; they plug in by providing `shader`, `defines()` and `uniforms()`.
 * @module engine/Material
 */

/** @typedef {{ vertex: string, fragment: string, name: string }} ShaderSource */

export class Material {
    /**
     * @param {{ shader: ShaderSource, transparent?: boolean, depthTest?: boolean, depthWrite?: boolean,
     *           cull?: "back" | "front" | "none", blending?: "normal" | "additive" }} options
     */
    constructor(options) {
        this.shader = options.shader;
        this.transparent = options.transparent ?? false;
        this.depthTest = options.depthTest ?? true;
        this.depthWrite = options.depthWrite ?? !this.transparent;
        /** @type {"back" | "front" | "none"} */
        this.cull = options.cull ?? "back";
        /** @type {"normal" | "additive"} */
        this.blending = options.blending ?? "normal";
        /** bumped by invalidateProgram(); meshes rebuild their cached program when it changes */
        this.variantVersion = 0;
    }

    /** Call after changing anything that affects defines() (e.g. lit, vertexColors). */
    invalidateProgram() { this.variantVersion++; }

    /** Shader variant switches. The Renderer adds INSTANCED itself. */
    defines() { return {}; }

    /** Uniform values owned by this material (reused objects, no per-frame allocation). */
    uniforms() { return {}; }
}

export class BasicMaterial extends Material {
    /**
     * @param {{ color?: number[], opacity?: number, emissive?: number[], lit?: boolean, vertexColors?: boolean,
     *           transparent?: boolean, cull?: "back" | "front" | "none", blending?: "normal" | "additive",
     *           depthWrite?: boolean }} [options]
     */
    constructor(options = {}) {
        super({ shader: { name: "basic", vertex: basic.vertex, fragment: basic.fragment }, ...options,
            transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1) });
        this.color = Float32Array.from(options.color || [1, 1, 1]);
        this.opacity = options.opacity ?? 1;
        this.emissive = Float32Array.from(options.emissive || [0, 0, 0]);
        this.lit = options.lit ?? true;
        this.vertexColors = options.vertexColors ?? false;
        this._color4 = new Float32Array(4);
        this._uniforms = { u_color: this._color4, u_emissive: this.emissive };
    }

    defines() { return { LIT: this.lit, VERTEX_COLORS: this.vertexColors }; }

    uniforms() {
        this._color4[0] = this.color[0];
        this._color4[1] = this.color[1];
        this._color4[2] = this.color[2];
        this._color4[3] = this.opacity;
        return this._uniforms;
    }
}
