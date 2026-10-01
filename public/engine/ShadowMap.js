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
 *   scene.shadow = new ShadowMap({ center: [10, 0, 0], extent: [24, 14], size: 2048 });   // one fixed box
 *   scene.shadow = new ShadowMap({ cascades: 3, distance: 150 });                         // follows the camera
 *
 * Before the main pass the Renderer draws every opaque mesh once more from the sun's point of view into a
 * depth texture: for each texel, how far the nearest surface is from the sun. In the main pass a surface
 * compares its own distance to the sun against that texel (shaders/chunks/lighting.js, labShadow). If
 * something was nearer, the surface is in shadow.
 *
 * The sun is far away, so its rays are parallel and its "camera" has no perspective: a box.
 *
 * ONE FIXED BOX (`cascades: 0`, the default). The box is `extent` wide and tall, `depth` deep, centred on
 * `center`. Only things inside it cast or receive shadows, so keep it as small as the play area allows:
 * the same texture spread over less ground gives sharper shadows. Right for a board, a room, a street.
 *
 * CASCADES (`cascades: 1..3`). For a world too large for one box. The part of the camera's view nearer
 * than `distance` is cut into slices by depth, close ones thin and far ones thick. Each slice gets its own
 * box, fitted around it every frame, and its own tile of the texture (the tiles sit side by side, so the
 * texture is `size × cascades` wide). Near the camera a texel covers centimetres; far away, where a pixel
 * covers more ground anyway, it covers metres. Two details keep it steady:
 *   - each box is fitted to a sphere around its slice, so its size doesn't change as the camera turns;
 *   - its centre moves in whole-texel steps, so shadow edges don't crawl as the camera moves.
 *
 * Static casters (optional, `cache: true`, fixed box only). Most of a scene never moves (buildings,
 * terrain, furniture). Mark those entities `entity.staticShadow = true` and their depth is drawn once into
 * a second texture and kept; each frame that texture is copied into the shadow map and only the moving
 * casters are drawn on top. The kept copy is redrawn by itself when the sun, the box, or a static
 * entity's mesh, geometry or transform changes. If you edit a static mesh in a way that can't be seen from
 * outside (instance matrices, vertices in place without markDirty), call `invalidate()`.
 * This needs WebGL2 (the copy writes gl_FragDepth); on WebGL1 everything is simply drawn every frame.
 * It is off by default because it is not always a win: the copy touches every texel of the shadow map,
 * and drawing depth-only triangles is cheap. Measured on NIGHT MARKET (Intel UHD, 2048² map, a static
 * street of 150,000 triangles): drawing the street cost about 0.5 ms a frame, copying it about 0.9 ms.
 * Turn it on for scenes whose static casters are much heavier than that, and time both ways.
 *
 * Casters whose bounding sphere lies outside a box are skipped for that box.
 *
 * Needs a depth texture: built into WebGL2, an extension on WebGL1. Without one, `supported` is false and
 * the scene renders with no shadows.
 * @module engine/ShadowMap
 */
export class ShadowMap {
    /**
     * @param {{ size?: number, center?: number[], extent?: number[], depth?: number, strength?: number,
     *           bias?: number, normalBias?: number, enabled?: boolean, cache?: boolean,
     *           cascades?: number, distance?: number, lambda?: number }} [options]
     *        size: texels along one side of the box (of each cascade's tile)
     *        extent: half-width and half-height of the fixed box, in world units, as the sun sees it
     *        depth: how far the box reaches along the sun's rays (casters above the view count too)
     *        strength: 0..1, how much sunlight a shadow removes
     *        cache: keep the depth of `staticShadow` entities between frames (default false; see above)
     *        cascades: 0 = one fixed box; 1..3 = that many boxes fitted to the camera's view
     *        distance: how far from the camera cascaded shadows reach, in world units
     *        lambda: where the cuts fall, 0 = evenly spaced, 1 = each slice a fixed multiple of the one before
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
        this.cascades = options.cascades ?? 0;
        this.distance = options.distance ?? 120;
        this.lambda = options.lambda ?? 0.7;
        this.supported = true;
        /** world -> sun clip space, one mat4 per cascade (the fixed box uses the first) */
        this.matrices = new Float32Array(LIGHTS.maxCascades * 16);
        /** the first of `matrices`: the fixed box, or the nearest cascade */
        this.matrix = this.matrices.subarray(0, 16);
        this._tiles = [0, 1, 2].map((i) => this.matrices.subarray(i * 16, i * 16 + 16));
        /** strength, 1 / tile size, depth bias, number of cascades in use */
        this.params = new Float32Array(4);
        /** per cascade: camera depth where it ends, normal offset, depth bias, (unused) */
        this.cascadeData = new Float32Array(LIGHTS.maxCascades * 4);
        /** cascades fitted this frame (0 while the fixed box is in use) */
        this.activeCascades = 0;
        this._view = mat4.create();
        this._proj = mat4.create();
        this._eye = new Float32Array(3);
        this._centre = new Float32Array(3);
        this._gpu = new WeakMap();
        this._tileSize = this.size;
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

    /**
     * Recompute the sun's matrices. Called by the Renderer every frame.
     * @param {ArrayLike<number>} sunDirection
     * @param {import("./Camera.js").Camera} [camera] needed for cascades
     * @param {number} [aspect]
     */
    update(sunDirection, camera, aspect = 1) {
        const n = camera ? Math.max(0, Math.min(LIGHTS.maxCascades, this.cascades | 0)) : 0;
        this.activeCascades = n;
        const data = this.cascadeData;
        if (n === 0) {
            this._box(this.matrix, this.center, this.extent[0], this.extent[1], this.depth, sunDirection, 0);
            data[0] = 0; data[1] = this.normalBias; data[2] = this.bias;
        } else {
            // slice boundaries: a blend of evenly spaced and geometrically spaced cuts
            const near = camera.near, far = Math.max(near + 1, Math.min(this.distance, camera.far));
            const focal = camera.focal, k2 = (aspect * aspect + 1) / (focal * focal);     // tan² of the half-angle to a corner
            let from = near;
            for (let i = 0; i < n; i++) {
                const u = (i + 1) / n;
                const to = i === n - 1 ? far : this.lambda * near * Math.pow(far / near, u) + (1 - this.lambda) * (near + (far - near) * u);
                // smallest sphere around the slice: centred on the view axis, through its far corners
                // (and its near corners too, unless that would put the centre beyond the far plane)
                const c = Math.min(to, 0.5 * (to + from) * (1 + k2));
                const r = Math.ceil(Math.sqrt((c - to) * (c - to) + to * to * k2) * 8) / 8;
                for (let k = 0; k < 3; k++) this._centre[k] = camera.eye[k] + camera.forward[k] * c;
                const depth = this.depth + 2 * r;
                this._box(this._tiles[i], this._centre, r, r, depth, sunDirection, (2 * r) / this._tileSize);
                data[i * 4] = to;
                data[i * 4 + 1] = Math.max(this.normalBias, 2.5 * (2 * r) / this._tileSize);
                data[i * 4 + 2] = (this.bias * this.depth) / depth;       // the same bias in world units for every cascade
                from = to;
            }
        }
        this.params[0] = this.enabled && this.supported ? this.strength : 0;
        this.params[1] = 1 / this._tileSize;
        this.params[2] = this.bias;
        this.params[3] = n;
    }

    /** One orthographic box looking along the sun's rays. `snap` > 0 moves its centre in steps of that size. */
    _box(out, center, halfWidth, halfHeight, depth, d, snap) {
        const half = depth / 2, eye = this._eye, view = this._view;
        // world up (Z) unless the sun is straight overhead, where "up" would be undefined
        const up = Math.abs(d[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
        let cx = center[0], cy = center[1], cz = center[2];
        if (snap > 0) {
            // the box's own right and up axes are the first two rows of a view matrix looking along the rays
            mat4.lookAt(view, [d[0], d[1], d[2]], [0, 0, 0], up);
            const rx = view[0], ry = view[4], rz = view[8], ux = view[1], uy = view[5], uz = view[9];
            const x = cx * rx + cy * ry + cz * rz, y = cx * ux + cy * uy + cz * uz;
            const dx = Math.floor(x / snap) * snap - x, dy = Math.floor(y / snap) * snap - y;
            cx += rx * dx + ux * dy; cy += ry * dx + uy * dy; cz += rz * dx + uz * dy;
        }
        eye[0] = cx + d[0] * half; eye[1] = cy + d[1] * half; eye[2] = cz + d[2] * half;
        mat4.lookAt(view, eye, [cx, cy, cz], up);
        mat4.ortho(this._proj, -halfWidth, halfWidth, -halfHeight, halfHeight, 0.1, depth);
        mat4.multiply(out, this._proj, view);
    }

    _resources(gl) {
        let g = this._gpu.get(gl);
        const tiles = Math.max(1, this.activeCascades);
        if (g && g.tiles !== tiles) {
            // the number of cascades changed: the atlas needs a different width
            for (const k of ["texture", "color", "keptTexture"]) if (g[k]) gl.deleteTexture(g[k]);
            for (const k of ["framebuffer", "keptFramebuffer"]) if (g[k]) gl.deleteFramebuffer(g[k]);
            g.texture = g.color = g.keptTexture = g.framebuffer = g.keptFramebuffer = null;
            this._kept = false;
        } else if (g) return g;
        const webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        const ext = webgl2 ? true : gl.getExtension("WEBGL_depth_texture");
        if (!g) {
            g = { texture: null, framebuffer: null, color: null, programs: new Map(), ok: false, webgl2, keptTexture: null, keptFramebuffer: null, copy: null, copyVAO: null, tiles, size: this.size };
            this._gpu.set(gl, g);
        }
        g.tiles = tiles;
        g.size = Math.min(this.size, Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE) / tiles));
        this._tileSize = g.size;
        this.params[1] = 1 / g.size;
        if (!ext) { this.supported = false; return g; }
        const width = g.size * tiles, height = g.size;
        g.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, g.texture);
        if (webgl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
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
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, g.size, g.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
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

    _program(gl, g, instanced, skinned, jointTexture) {
        const key = (instanced ? 1 : 0) + (skinned ? 2 : 0) + (jointTexture ? 4 : 0);
        let p = g.programs.get(key);
        if (!p) {
            p = new ShaderProgram(gl, standard.depthVertex, standard.depthFragment, { name: "shadow-depth-" + key, defines: { INSTANCED: instanced, SKINNED: skinned, JOINT_TEXTURE: jointTexture } });
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
        gl.viewport(0, 0, g.size * g.tiles, g.size);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.colorMask(false, false, false, false);
        // a little slope-scaled offset keeps lit surfaces from shadowing themselves at grazing angles
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 2.0);

        if (this.activeCascades > 0) {
            // one tile per cascade, side by side
            this._kept = false;
            gl.clear(gl.DEPTH_BUFFER_BIT);
            for (let i = 0; i < this.activeCascades; i++) {
                gl.viewport(i * g.size, 0, g.size, g.size);
                this._draw(gl, g, casters, this._tiles[i]);
            }
        } else {
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
                    this._draw(gl, g, statics, this.matrix);
                    this.staticRedraws++;
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer);
                if (!this._copyKept(gl, g)) { gl.clear(gl.DEPTH_BUFFER_BIT); this._draw(gl, g, statics, this.matrix); }
            } else {
                this._kept = false;
                gl.clear(gl.DEPTH_BUFFER_BIT);
            }
            this._draw(gl, g, movers, this.matrix);
        }

        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** Draw a list of casters into whichever depth target and viewport are bound, through one box. */
    _draw(gl, g, casters, matrix) {
        let current = null;
        // how much of the box one world unit covers, sideways and upward
        const sx = Math.hypot(matrix[0], matrix[4], matrix[8]), sy = Math.hypot(matrix[1], matrix[5], matrix[9]);
        for (const e of casters) {
            const mesh = e.mesh, geo = mesh.geometry, n = geo.drawCount;
            if (n <= 0 || geo.mode !== "triangles") continue;
            const b = e._bounds;
            if (b && b[3] >= 0) {
                // bounding sphere against the sides of the box (not its ends: something above the box still casts into it)
                const x = matrix[0] * b[0] + matrix[4] * b[1] + matrix[8] * b[2] + matrix[12];
                const y = matrix[1] * b[0] + matrix[5] * b[1] + matrix[9] * b[2] + matrix[13];
                if (Math.abs(x) > 1 + b[3] * sx || Math.abs(y) > 1 + b[3] * sy) continue;
            }
            const program = this._program(gl, g, mesh.isInstanced, !!mesh.isSkinned, !!mesh.usesJointTexture);
            if (program !== current) { program.use(); program.set("u_shadowMatrix", matrix); current = program; }
            program.set("u_model", e.worldMatrix);
            const cull = mesh.material.cull;
            if (cull === "none") gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(cull === "front" ? gl.FRONT : gl.BACK); }
            mesh.bindVAO(gl);
            if (mesh.isSkinned) mesh.bindJoints(gl, program);
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
