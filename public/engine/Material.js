import * as basic from "../shaders/basic/basic.js";
import * as glow from "../shaders/effects/glow.js";
import * as standard from "../shaders/standard/standard.js";

/**
 * Material: which shader draws a mesh, with which parameters and GPU state.
 *
 * `BasicMaterial`: unlit or Lambert (sun + hemisphere), colour, opacity, emissive, vertex colours. Cheap.
 * `StandardMaterial`: the full light system (sun with shadows, point lights, fog), textures, skinning.
 * `ShaderMaterial`: your own GLSL. `GlowMaterial`: an additive halo.
 * A material type plugs in by providing `shader`, `defines()` and `uniforms()`. A uniform value may be a
 * Texture; the Renderer binds it to a free texture unit.
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
        /** drawn into the sun's shadow map (opaque materials only) */
        this.castShadow = options.castShadow ?? true;
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
     *           rim?: number[] | null, rimPower?: number,
     *           transparent?: boolean, cull?: "back" | "front" | "none", blending?: "normal" | "additive",
     *           depthWrite?: boolean }} [options]
     *        rim: colour of a fresnel rim light (silhouette pop), or null for none
     */
    constructor(options = {}) {
        super({ shader: { name: "basic", vertex: basic.vertex, fragment: basic.fragment }, ...options,
            transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1) });
        this.color = Float32Array.from(options.color || [1, 1, 1]);
        this.opacity = options.opacity ?? 1;
        this.emissive = Float32Array.from(options.emissive || [0, 0, 0]);
        this.lit = options.lit ?? true;
        this.vertexColors = options.vertexColors ?? false;
        this.rim = options.rim ? Float32Array.from(options.rim) : null;
        this.rimPower = options.rimPower ?? 3;
        this._color4 = new Float32Array(4);
        this._uniforms = { u_color: this._color4, u_emissive: this.emissive, u_rimColor: this.rim || new Float32Array(3), u_rimPower: this.rimPower };
    }

    defines() { return { LIT: this.lit, VERTEX_COLORS: this.vertexColors, RIM: !!this.rim }; }

    uniforms() {
        this._color4[0] = this.color[0];
        this._color4[1] = this.color[1];
        this._color4[2] = this.color[2];
        this._color4[3] = this.opacity;
        this._uniforms.u_rimPower = this.rimPower;
        return this._uniforms;
    }
}

/**
 * The engine's fully lit surface. Reads the Scene's sun, shadow map, point lights and fog.
 *
 *   new StandardMaterial({ color: [0.9, 0.5, 0.2] })
 *   new StandardMaterial({ map: texture })            // textured (uses the mesh's UVs)
 *   new StandardMaterial({ vertexColors: true })      // per-vertex colour; alpha above 1 glows by itself
 *   new StandardMaterial({ palette: colours })        // a_color.r is an index into the palette
 *
 * Works on Mesh, InstancedMesh and SkinnedMesh; the Renderer picks the matching shader variant.
 */
export class StandardMaterial extends Material {
    /**
     * @param {{ color?: number[], opacity?: number, emissive?: number[], map?: import("./Texture.js").Texture | null,
     *           vertexColors?: boolean, palette?: Float32Array | number[] | null, lit?: boolean,
     *           specular?: number, shininess?: number, rim?: number[] | null, rimPower?: number, alphaTest?: number,
     *           transparent?: boolean, cull?: "back" | "front" | "none", blending?: "normal" | "additive",
     *           depthWrite?: boolean, castShadow?: boolean }} [options]
     *        palette: PALETTE_SIZE rgb colours as one flat array. A mesh can use its own table with
     *        `mesh.uniforms = { u_palette }`, so many characters share one material.
     */
    constructor(options = {}) {
        super({ shader: { name: "standard", vertex: standard.vertex, fragment: standard.fragment }, ...options,
            transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1) });
        this.color = Float32Array.from(options.color || [1, 1, 1]);
        this.opacity = options.opacity ?? 1;
        this.emissive = Float32Array.from(options.emissive || [0, 0, 0]);
        this.map = options.map || null;
        this.vertexColors = options.vertexColors ?? false;
        this.palette = options.palette ? Float32Array.from(options.palette) : null;
        this.lit = options.lit ?? true;
        this.specular = options.specular ?? 0;
        this.shininess = options.shininess ?? 24;
        this.rim = options.rim ? Float32Array.from(options.rim) : null;
        this.rimPower = options.rimPower ?? 3;
        this.alphaTest = options.alphaTest ?? 0;
        this._color4 = new Float32Array(4);
        this._uniforms = { u_color: this._color4, u_emissive: this.emissive };
    }

    defines() {
        return { MAP: !!this.map, VERTEX_COLORS: this.vertexColors && !this.palette, PALETTE: !!this.palette,
            UNLIT: !this.lit, RIM: !!this.rim, ALPHA_TEST: this.alphaTest > 0 };
    }

    uniforms() {
        const u = this._uniforms, c = this._color4;
        c[0] = this.color[0]; c[1] = this.color[1]; c[2] = this.color[2]; c[3] = this.opacity;
        u.u_specular = this.specular; u.u_shininess = this.shininess;
        u.u_map = this.map; u.u_palette = this.palette;
        u.u_rimColor = this.rim; u.u_rimPower = this.rimPower; u.u_alphaTest = this.alphaTest;
        return u;
    }
}
StandardMaterial.PALETTE_SIZE = standard.PALETTE_SIZE;

/**
 * Custom GLSL. Include the projection chunk in the vertex shader and call projectLab():
 *
 *   import { projection } from "../shaders/chunks/projection.js";
 *   new ShaderMaterial({ name: "wobble", vertex: projection + `...`, fragment: `...`, uniforms: { u_amount: 1 } });
 *
 * Engine-provided uniforms (set automatically when declared): u_model, u_normalMatrix, u_camPos, u_camRight,
 * u_camUp, u_camForward, u_proj, u_time, u_viewport, u_sunDirection, u_sunColor, u_skyColor, u_groundColor,
 * and everything the lighting chunk declares (shaders/chunks/lighting.js: point lights, fog, shadow map).
 * `name` must be unique per shader source (it keys the program cache).
 */
export class ShaderMaterial extends Material {
    /**
     * @param {{ name: string, vertex: string, fragment: string, uniforms?: Record<string, any>,
     *           defines?: Record<string, string | number | boolean>, transparent?: boolean, depthTest?: boolean,
     *           depthWrite?: boolean, cull?: "back" | "front" | "none", blending?: "normal" | "additive" }} options
     */
    constructor(options) {
        super({ ...options, shader: { name: options.name, vertex: options.vertex, fragment: options.fragment } });
        /** uniform values; mutate in place (typed arrays) or reassign numbers */
        this.values = options.uniforms || {};
        this._defines = options.defines || {};
    }
    defines() { return { ...this._defines }; }
    uniforms() { return this.values; }
}

/**
 * Glow halo: an additive fresnel shell. Put it on a slightly larger copy of a mesh (or a sphere) to give
 * planets, stars and pickups a soft atmosphere that bloom picks up.
 */
export class GlowMaterial extends Material {
    /** @param {{ color?: number[], intensity?: number, power?: number, inner?: boolean }} [options]
     *  inner: glow toward the centre (a sun core) instead of the rim (an atmosphere) */
    constructor(options = {}) {
        super({ shader: { name: "glow", vertex: glow.vertex, fragment: glow.fragment },
            transparent: true, blending: "additive", depthWrite: false, cull: options.inner ? "back" : "front" });
        this.color = Float32Array.from(options.color || [0.4, 0.8, 1]);
        this.intensity = options.intensity ?? 1.5;
        this.power = options.power ?? 2.5;
        this.inner = options.inner ?? false;
        this._u = { u_glowColor: this.color, u_glowIntensity: this.intensity, u_glowPower: this.power };
    }
    defines() { return { INNER: this.inner }; }
    uniforms() { this._u.u_glowIntensity = this.intensity; this._u.u_glowPower = this.power; return this._u; }
}
