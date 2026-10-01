import * as basic from "../shaders/basic/basic.js";
import * as glow from "../shaders/effects/glow.js";
import * as standard from "../shaders/standard/standard.js";

/**
 * Material: which shader draws a mesh, with which parameters and GPU state.
 *
 * `BasicMaterial`: unlit or Lambert (sun + hemisphere), colour, opacity, emissive, vertex colours. Cheap.
 * `StandardMaterial`: the full light system (sun with shadows, point lights, fog), textures, skinning.
 * `PBRMaterial`: the same, lit from metallic and roughness (the model glTF files and most asset packs use).
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
     *           normalMap?: import("./Texture.js").Texture | null, normalScale?: number,
     *           emissiveMap?: import("./Texture.js").Texture | null,
     *           vertexColors?: boolean, palette?: Float32Array | number[] | null, lit?: boolean,
     *           specular?: number, shininess?: number, rim?: number[] | null, rimPower?: number, alphaTest?: number,
     *           transparent?: boolean, cull?: "back" | "front" | "none", blending?: "normal" | "additive",
     *           depthWrite?: boolean, castShadow?: boolean }} [options]
     *        palette: PALETTE_SIZE rgb colours as one flat array. A mesh can use its own table with
     *        `mesh.uniforms = { u_palette }`, so many characters share one material.
     *        normalMap: per-pixel surface direction (tangent space, the usual blue-ish image); the mesh
     *        needs UVs, and tangents are computed for it if missing. normalScale: bump strength.
     *        emissiveMap: multiplies `emissive` (which defaults to white when a map is given).
     */
    constructor(options = {}) {
        super({ shader: { name: "standard", vertex: standard.vertex, fragment: standard.fragment }, ...options,
            transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1) });
        this.color = Float32Array.from(options.color || [1, 1, 1]);
        this.opacity = options.opacity ?? 1;
        this.emissive = Float32Array.from(options.emissive || (options.emissiveMap ? [1, 1, 1] : [0, 0, 0]));
        this.map = options.map || null;
        this.normalMap = options.normalMap || null;
        this.normalScale = options.normalScale ?? 1;
        this.emissiveMap = options.emissiveMap || null;
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
        return { UV: !!(this.map || this.normalMap || this.emissiveMap), MAP: !!this.map, NORMAL_MAP: !!this.normalMap,
            EMISSIVE_MAP: !!this.emissiveMap, VERTEX_COLORS: this.vertexColors && !this.palette, PALETTE: !!this.palette,
            UNLIT: !this.lit, RIM: !!this.rim, ALPHA_TEST: this.alphaTest > 0 };
    }

    uniforms() {
        const u = this._uniforms, c = this._color4;
        c[0] = this.color[0]; c[1] = this.color[1]; c[2] = this.color[2]; c[3] = this.opacity;
        u.u_specular = this.specular; u.u_shininess = this.shininess;
        u.u_map = this.map; u.u_palette = this.palette;
        u.u_normalMap = this.normalMap; u.u_normalScale = this.normalScale; u.u_emissiveMap = this.emissiveMap;
        u.u_rimColor = this.rim; u.u_rimPower = this.rimPower; u.u_alphaTest = this.alphaTest;
        return u;
    }
}
StandardMaterial.PALETTE_SIZE = standard.PALETTE_SIZE;

/**
 * A physically based surface: instead of "how strong and how tight is the highlight", say what the
 * surface is made of.
 *
 *   new PBRMaterial({ color: [1, 0.77, 0.34], metallic: 1, roughness: 0.25 })     // polished gold
 *   new PBRMaterial({ color: [0.8, 0.1, 0.1], metallic: 0, roughness: 0.5 })      // red plastic
 *   new PBRMaterial({ map, normalMap, metallicRoughnessMap })                      // a textured asset
 *
 * metallic: 0 = plastic, wood, stone, skin; 1 = bare metal. Metals have no colour of their own, only
 * tinted reflections. roughness: 0 = mirror, 1 = chalk. Rough surfaces spread the highlight wide and dim.
 * Reflections of the surroundings come from the Scene's sky and ground colours; `envIntensity` scales them.
 * Everything a StandardMaterial takes works here too (textures, vertex colours, palette, skinning,
 * instancing, alpha test), except `specular` and `shininess`, which metallic and roughness replace.
 */
export class PBRMaterial extends StandardMaterial {
    /**
     * @param {ConstructorParameters<typeof StandardMaterial>[0] & { metallic?: number, roughness?: number,
     *           metallicRoughnessMap?: import("./Texture.js").Texture | null, envIntensity?: number }} [options]
     *        metallicRoughnessMap: green = roughness, blue = metallic (the glTF layout); multiplies the two numbers
     */
    constructor(options = {}) {
        super(options);
        this.metallic = options.metallic ?? 0;
        this.roughness = options.roughness ?? 0.6;
        this.metallicRoughnessMap = options.metallicRoughnessMap || null;
        this.envIntensity = options.envIntensity ?? 1;
    }

    defines() {
        const d = super.defines();
        d.PBR = true;
        d.MR_MAP = !!this.metallicRoughnessMap;
        d.UV = d.UV || d.MR_MAP;
        return d;
    }

    uniforms() {
        const u = super.uniforms();
        u.u_metallic = this.metallic; u.u_roughness = this.roughness; u.u_envIntensity = this.envIntensity;
        u.u_metallicRoughnessMap = this.metallicRoughnessMap;
        return u;
    }
}

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
        /** the vertex shader may move things anywhere, so the Renderer never culls these by the mesh's bounds */
        this.isShaderMaterial = true;
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
